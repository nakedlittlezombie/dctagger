import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ByteVector,
  File as TagFile,
  Id3v2Tag,
  Id3v2UniqueFileIdentifierFrame,
  Picture,
  PictureType,
  TagTypes,
} from "node-taglib-sharp";

import type {
  AlbumFolder,
  ApplyResult,
  DiscogsRelease,
  LocalTrack,
  PublicSettings,
  ReleaseTrack,
  TrackAssignment,
} from "../../model/types";
import { cleanArtistName } from "../../model/artist";
import { releaseGenres } from "../../model/genre";
import { renderFileName, renderFolderPath, type NamingContext } from "../../naming";
import { detectDuplicates, duplicatePaths } from "./dedupe";
import { isAudioFile } from "./files";

export interface CoverArt {
  data: Buffer;
  contentType: string;
  extension: string;
}

export interface ApplyAlbumOptions {
  album: AlbumFolder;
  release: DiscogsRelease;
  settings: PublicSettings;
  destinationRoot: string;
  cover: CoverArt | null;
}

function albumArtistFor(release: DiscogsRelease): string {
  const names = release.artists
    .map((artist) => cleanArtistName(artist.name))
    .filter((name) => Boolean(name));
  if (names.length === 0) return "Unknown Artist";
  if (names.length === 1) return names[0] as string;
  const compilation = release.formats.some((format) =>
    format.descriptions.some((description) => /compilation/i.test(description)),
  );
  return compilation ? "Various Artists" : names.join(" & ");
}

function releaseArtistFor(release: DiscogsRelease): string {
  const names = release.artists
    .map((artist) => cleanArtistName(artist.name))
    .filter((name) => Boolean(name));
  if (names.length === 0) return "Unknown Artist";
  return names.join(" & ");
}

function trackNumberOf(track: ReleaseTrack, index: number): number {
  return track.trackNumber > 0 ? track.trackNumber : index + 1;
}

function tagComment(release: DiscogsRelease): string {
  const label = release.labels[0];
  const source = release.source === "deezer" ? "Deezer" : "Discogs";
  const id = release.source === "deezer" ? Math.abs(release.id) : release.id;
  const parts = [`${source} release ${id}`, release.uri];
  if (label) parts.push(`${label.name}${label.catno ? ` ${label.catno}` : ""}`);
  return parts.join(" · ");
}

function contextFor(
  album: AlbumFolder,
  release: DiscogsRelease,
  track: ReleaseTrack | undefined,
  trackTotal: number,
  discTotal: number,
  sourceFile: string,
): NamingContext {
  const albumArtist = albumArtistFor(release);
  const trackArtist = cleanArtistName(track?.artists[0]) || albumArtist;
  return {
    artist: trackArtist,
    albumartist: albumArtist,
    album: release.title,
    year: release.year ?? album.hints.year,
    title: track?.title,
    track: track ? trackNumberOf(track, track.index) : undefined,
    tracktotal: trackTotal,
    disc: track?.disc ?? 1,
    disctotal: discTotal,
    format: path.extname(sourceFile).replace(/^\./, "").toUpperCase(),
    label: release.labels[0]?.name,
    catno: release.labels[0]?.catno,
    releaseid: release.id,
  };
}

async function uniquePath(directory: string, base: string, extension: string, used: Set<string>): Promise<string> {
  let attempt = 1;
  let candidate = `${base}${extension}`;
  while (used.has(candidate.toLowerCase()) || await exists(path.join(directory, candidate))) {
    attempt += 1;
    candidate = `${base} (${attempt})${extension}`;
  }
  used.add(candidate.toLowerCase());
  return path.join(directory, candidate);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function uniqueFolder(root: string, relative: string): Promise<string> {
  let candidate = path.join(root, relative);
  let attempt = 1;
  while (await exists(candidate)) {
    attempt += 1;
    candidate = path.join(root, `${relative} (${attempt})`);
  }
  return candidate;
}

async function transfer(source: string, destination: string, mode: "copy" | "move"): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  if (mode === "copy") {
    await copyFile(source, destination);
    return;
  }
  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw error;
    await copyFile(source, destination);
    await unlink(source);
  }
}

function writeTags(
  filePath: string,
  album: AlbumFolder,
  release: DiscogsRelease,
  track: ReleaseTrack | undefined,
  settings: PublicSettings,
  cover: CoverArt | null,
): void {
  const tagFile = TagFile.createFromPath(filePath);
  try {
    const tag = tagFile.tag;
    const albumArtist = albumArtistFor(release);
    const trackArtist = cleanArtistName(track?.artists[0]) || albumArtist;
    const discTracks = release.tracklist.filter(
      (entry) => entry.disc === (track?.disc ?? 1),
    );
    const trackCount = track ? discTracks.length : release.tracklist.length;
    const discTotal = Math.max(1, ...release.tracklist.map((entry) => entry.disc));

    tag.title = track?.title?.trim() || path.basename(filePath, path.extname(filePath));
    tag.album = release.title?.trim() || "Unknown Album";
    tag.performers = [trackArtist || albumArtist || "Unknown Artist"];
    tag.albumArtists = [albumArtist || "Unknown Artist"];
    const deezerGenres =
      album.deezer?.releaseId === release.id ? album.deezer.genres : undefined;
    const musicBrainzGenres =
      album.musicbrainz?.releaseId === release.id
        ? album.musicbrainz.genres
        : undefined;
    tag.genres = releaseGenres(
      release,
      album.hints.genres,
      deezerGenres,
      musicBrainzGenres,
    );
    if (track) {
      tag.track = trackNumberOf(track, track.index);
      tag.trackCount = trackCount;
      tag.disc = track.disc;
      tag.discCount = discTotal;
    }
    const year = release.year ?? album.hints.year;
    if (year) tag.year = year;
    const label = release.labels[0];
    if (label?.name) tag.publisher = label.name;
    tag.comment = tagComment(release);

    if (cover && (settings.coverMode === "embed" || settings.coverMode === "both")) {
      tag.pictures = [
        Picture.fromFullData(
          ByteVector.fromByteArray(cover.data),
          PictureType.FrontCover,
          cover.contentType,
          "Front cover",
        ),
      ];
    }

    // node-taglib-sharp throws "Argument null: text was not provided" when an
    // existing UFID frame was parsed without an owner. That malformed frame is
    // re-rendered on save, so drop UFID frames before writing.
    const id3 = tagFile.getTag(TagTypes.Id3v2, false) as Id3v2Tag | undefined;
    if (id3) {
      for (const frame of [...id3.frames]) {
        if (frame instanceof Id3v2UniqueFileIdentifierFrame && !frame.owner) {
          id3.removeFrame(frame);
        }
      }
    }

    tagFile.save();
  } finally {
    tagFile.dispose();
  }
}

function coverFileName(cover: CoverArt): string {
  return `cover.${cover.extension}`;
}

/**
 * Tag, deduplicate, rename, and transfer one album into the destination.
 * Works on a fresh read of the source folder so files added after scanning are
 * still handled.
 */
export async function applyAlbum(options: ApplyAlbumOptions): Promise<ApplyResult> {
  const { album, release, settings, destinationRoot, cover } = options;
  const errors: string[] = [];
  const source = album.path;
  let tagged = 0;
  let transferred = 0;
  let skipped = 0;

  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isDirectory()) {
    return {
      albumId: album.id,
      folderName: album.folderName,
      ok: false,
      tagged: 0,
      files: 0,
      deduplicated: 0,
      skipped: 0,
      errors: [`Source folder not found: ${source}`],
    };
  }

  const groups = album.duplicates.length > 0
    ? album.duplicates
    : detectDuplicates(album.tracks);
  const losers = duplicatePaths(groups);
  const dedupeActive = settings.dedupeMode !== "off";
  const hidden = dedupeActive ? losers : new Set<string>();
  let deduplicated = 0;

  const assignmentByPath = new Map<string, TrackAssignment>(
    album.mapping.map((assignment) => [assignment.filePath, assignment]),
  );
  const trackByIndex = new Map<number, ReleaseTrack>(
    release.tracklist.map((track) => [track.index, track]),
  );
  const discTotal = Math.max(1, ...release.tracklist.map((track) => track.disc));
  const localByPath = new Map<string, LocalTrack>(
    album.tracks.map((track) => [track.path, track]),
  );

  const relative = renderFolderPath(settings.folderPattern, {
    artist: releaseArtistFor(release),
    albumartist: albumArtistFor(release),
    album: release.title,
    year: release.year ?? album.hints.year,
    label: release.labels[0]?.name,
    catno: release.labels[0]?.catno,
    releaseid: release.id,
  });

  const destinationResolved = path.resolve(destinationRoot);
  const targetCandidate = path.resolve(destinationResolved, relative);
  const relativeCheck = path.relative(destinationResolved, targetCandidate);
  if (
    relativeCheck === ".." ||
    relativeCheck.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCheck)
  ) {
    return {
      albumId: album.id,
      folderName: album.folderName,
      ok: false,
      tagged: 0,
      files: 0,
      deduplicated: 0,
      skipped: 0,
      errors: ["Refusing to write outside the destination folder"],
    };
  }

  const targetFolder = await uniqueFolder(destinationResolved, relative);
  await mkdir(targetFolder, { recursive: true });

  const usedNames = new Set<string>();
  let writtenCoverName: string | undefined;
  if (cover && (settings.coverMode === "copy" || settings.coverMode === "both")) {
    writtenCoverName = coverFileName(cover);
    try {
      await writeFile(path.join(targetFolder, writtenCoverName), cover.data);
      usedNames.add(writtenCoverName.toLowerCase());
    } catch (error) {
      errors.push(`Could not write ${writtenCoverName}: ${(error as Error).message}`);
    }
  }

  const entries = await readdir(source, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const successful = new Set<string>();
  const replacedArtwork: string[] = [];

  for (const fileName of files) {
    const filePath = path.join(source, fileName);
    if (hidden.has(filePath)) {
      deduplicated += 1;
      continue;
    }

    if (isAudioFile(fileName)) {
      const assignment = assignmentByPath.get(filePath);
      const track = assignment?.trackIndex !== null && assignment?.trackIndex !== undefined
        ? trackByIndex.get(assignment.trackIndex)
        : undefined;
      if (!track) {
        // Only mapped files are applied. Unmatched audio stays in the source
        // folder (copy mode) or is left behind (move mode) so it can be
        // reviewed instead of being silently copied/tagged.
        skipped += 1;
        continue;
      }
      const local = localByPath.get(filePath);
      const context = contextFor(
        album,
        release,
        track,
        release.tracklist.filter((entry) => entry.disc === track.disc).length,
        discTotal,
        fileName,
      );

      const baseName = renderFileName(settings.trackPattern, context);
      const extension = path.extname(fileName);
      const destination = await uniquePath(targetFolder, baseName, extension, usedNames);

      try {
        await transfer(filePath, destination, settings.transferMode);
        transferred += 1;
        successful.add(filePath);

        try {
          writeTags(destination, album, release, track, settings, cover);
          tagged += 1;
        } catch (error) {
          const label = local?.title || fileName;
          const rollback =
            settings.transferMode === "move"
              ? transfer(destination, filePath, "move")
              : unlink(destination).catch((unlinkError) => {
                  if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw unlinkError;
                  }
                });
          let restored = true;
          try {
            await rollback;
            transferred -= 1;
            successful.delete(filePath);
          } catch (rollbackError) {
            restored = false;
            errors.push(
              `Rollback failed for ${fileName}: ${(rollbackError as Error).message}`,
            );
          }
          errors.push(
            `Tagging failed for ${label}: ${(error as Error).message}${
              restored
                ? settings.transferMode === "move"
                  ? " (file restored to source)"
                  : " (untagged copy removed; source untouched)"
                : ""
            }`,
          );
        }
      } catch (error) {
        errors.push(`Could not transfer ${fileName}: ${(error as Error).message}`);
      }
      continue;
    }

    // Non-audio extras (cue, log, artwork, …).
    if (writtenCoverName && /^(cover|folder|front|albumart)/i.test(fileName)) {
      // The new cover replaces this one. In copy mode the source stays intact;
      // in move mode it has to go for the source folder to empty out.
      replacedArtwork.push(filePath);
      continue;
    }
    const baseName = path.basename(fileName, path.extname(fileName));
    const destination = await uniquePath(
      targetFolder,
      baseName,
      path.extname(fileName),
      usedNames,
    );
    try {
      await transfer(filePath, destination, settings.transferMode);
      transferred += 1;
      successful.add(filePath);
    } catch (error) {
      errors.push(`Could not transfer ${fileName}: ${(error as Error).message}`);
    }
  }

  if (settings.dedupeMode === "delete" && groups.length > 0) {
    for (const group of groups) {
      if (!successful.has(group.keep)) {
        errors.push(
          `Kept ${path.basename(group.keep)} but it was not transferred; duplicates were left in place`,
        );
        continue;
      }
      for (const member of group.members) {
        if (member.path === group.keep) continue;
        try {
          await unlink(member.path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            errors.push(
              `Could not delete duplicate ${member.fileName}: ${(error as Error).message}`,
            );
          }
        }
      }
    }
  }

  if (settings.transferMode === "move") {
    for (const filePath of replacedArtwork) {
      try {
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          errors.push(
            `Could not remove replaced artwork ${path.basename(filePath)}: ${(error as Error).message}`,
          );
        }
      }
    }
    await rmdir(source).catch(() => undefined);
  }

  return {
    albumId: album.id,
    folderName: album.folderName,
    ok: errors.length === 0,
    targetFolder,
    tagged,
    files: transferred,
    deduplicated,
    skipped,
    errors,
  };
}
