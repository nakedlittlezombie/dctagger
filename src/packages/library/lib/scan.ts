import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { parseFile } from "music-metadata";

import { cleanArtistName } from "../../model/artist";
import { normalizeGenres } from "../../model/genre";
import type {
  AlbumFolder,
  AlbumHints,
  LocalImage,
  LocalTrack,
} from "../../model/types";
import { detectDuplicates } from "./dedupe";
import {
  isAudioFile,
  isImageFile,
  mimeForImage,
  trackNumberFromFileName,
  trackTitleFromFileName,
} from "./files";
export interface ScanOptions {
  /** Directory where embedded cover art previews are cached. */
  artCacheDir: string;
  /** Container folder name (usually the artist) used as a fallback hint. */
  artistHint?: string;
}

export interface AlbumLocation {
  path: string;
  artistHint?: string;
}

const SKIP_DIRECTORIES = new Set([
  "@eadir",
  "#recycle",
  "node_modules",
  ".git",
  ".dctagger",
  "lost+found",
]);

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

export function albumIdFor(folderPath: string): string {
  return createHash("sha1").update(path.resolve(folderPath)).digest("hex").slice(0, 12);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).replace(/^\./, "").toLowerCase();
}

function imageExtensionForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";
  if (mime.includes("tiff")) return "tiff";
  return "jpg";
}

async function readTrack(filePath: string): Promise<LocalTrack> {
  const fileName = path.basename(filePath);
  const info = await stat(filePath);
  const base: LocalTrack = {
    path: filePath,
    fileName,
    size: info.size,
    format: extensionOf(fileName),
    title: trackTitleFromFileName(fileName) || undefined,
    track: trackNumberFromFileName(fileName),
    hasArt: false,
  };

  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: true });
    const common = metadata.common;
    const format = metadata.format;
    return {
      ...base,
      title: common.title?.trim() || base.title,
      artist: common.artist?.trim() || undefined,
      albumArtist: common.albumartist?.trim() || undefined,
      album: common.album?.trim() || undefined,
      track: common.track.no ?? base.track,
      disc: common.disk.no ?? undefined,
      year: common.year ?? undefined,
      genres: normalizeGenres(common.genre),
      duration: format.duration,
      bitrate: format.bitrate,
      sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample,
      lossless: format.lossless,
    };
  } catch {
    return base;
  }
}

function modeOf(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  if (!best) return undefined;
  const original = values.find((value) => value?.trim().toLowerCase() === best);
  return original?.trim();
}

function modeYear(years: Array<number | undefined>): number | undefined {
  const counts = new Map<number, number>();
  for (const year of years) {
    if (!year || year < 1900 || year > 2100) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [year, count] of counts) {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  }
  return best;
}

interface FolderNameHints {
  artist?: string;
  album?: string;
  year?: number;
}

function cleanName(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .trim();
}

/** Best-effort parse of `Artist - Album (Year)` style folder names. */
export function parseFolderName(folderName: string): FolderNameHints {
  const name = cleanName(folderName);
  const result: FolderNameHints = {};

  const yearArtistAlbum = /^(.*?)\s+-\s+(\d{4})\s+-\s+(.*)$/.exec(name);
  if (yearArtistAlbum?.[1] && yearArtistAlbum[2] && yearArtistAlbum[3]) {
    result.artist = yearArtistAlbum[1].trim();
    result.year = Number.parseInt(yearArtistAlbum[2], 10);
    result.album = yearArtistAlbum[3].trim();
    return result;
  }

  const artistAlbumYear = /^(.*?)\s+-\s+(.*?)\s*[\(\[](\d{4})[\)\]]\s*$/.exec(name);
  if (artistAlbumYear?.[1] && artistAlbumYear[2] && artistAlbumYear[3]) {
    result.artist = artistAlbumYear[1].trim();
    result.album = artistAlbumYear[2].trim();
    result.year = Number.parseInt(artistAlbumYear[3], 10);
    return result;
  }

  const albumYear = /^(.*?)\s*[\(\[](\d{4})[\)\]]\s*$/.exec(name);
  if (albumYear?.[1] && albumYear[2]) {
    result.album = albumYear[1].trim();
    result.year = Number.parseInt(albumYear[2], 10);
    return result;
  }

  const artistAlbum = /^(.*?)\s+-\s+(.*)$/.exec(name);
  if (artistAlbum?.[1] && artistAlbum[2]) {
    result.artist = artistAlbum[1].trim();
    result.album = artistAlbum[2].trim();
    return result;
  }

  if (name) result.album = name;
  return result;
}

async function readImages(
  folderPath: string,
  entries: string[],
  artCacheDir: string,
  audioFiles: string[],
): Promise<LocalImage[]> {
  const images: LocalImage[] = [];
  for (const fileName of entries) {
    if (!isImageFile(fileName)) continue;
    const filePath = path.join(folderPath, fileName);
    try {
      const info = await stat(filePath);
      if (!info.isFile() || info.size === 0) continue;
      images.push({
        path: filePath,
        fileName,
        mimeType: mimeForImage(fileName),
        source: "folder",
        size: info.size,
      });
    } catch {
      // unreadable image; ignore
    }
  }

  images.sort((a, b) => {
    const priority = (name: string) =>
      /^(cover|folder|front|album|art)/i.test(name) ? 0 : 1;
    const byPriority = priority(a.fileName) - priority(b.fileName);
    if (byPriority !== 0) return byPriority;
    return (b.size ?? 0) - (a.size ?? 0);
  });

  if (images.length > 0 || audioFiles.length === 0) return images.slice(0, 12);

  // No loose art: extract the first embedded picture for preview.
  const firstAudio = audioFiles[0];
  if (!firstAudio) return images;
  try {
    const metadata = await parseFile(path.join(folderPath, firstAudio), {
      duration: false,
      skipCovers: false,
    });
    const picture = metadata.common.picture?.[0];
    if (!picture || picture.data.length === 0) return images;
    const extension = imageExtensionForMime(picture.format);
    await mkdir(artCacheDir, { recursive: true });
    const cachePath = path.join(
      artCacheDir,
      `${albumIdFor(folderPath)}-embedded.${extension}`,
    );
    await writeFile(cachePath, picture.data);
    images.push({
      path: cachePath,
      fileName: `Embedded cover.${extension}`,
      mimeType: picture.format || "image/jpeg",
      source: "embedded",
      size: picture.data.length,
    });
  } catch {
    // no embedded art
  }
  return images;
}

export async function folderHasAudio(folderPath: string): Promise<boolean> {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && isAudioFile(entry.name));
  } catch {
    return false;
  }
}

/**
 * Find album folders below `root`. Layouts can be flat (`root/Album`) or
 * grouped by artist (`root/Artist/Album`), including a mix of both. A folder
 * is an album when audio sits directly inside it; the scanner never descends
 * into an album folder. Discovered album folders inherit the enclosing artist
 * folder name as a fallback hint.
 */
export async function enumerateAlbumFolders(
  rootFolder: string,
  options: { maxDepth?: number } = {},
): Promise<AlbumLocation[]> {
  const root = path.resolve(expandHome(rootFolder));
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error("Root folder is not a directory");

  const maxDepth = options.maxDepth ?? 3;
  const results: AlbumLocation[] = [];

  const walk = async (
    directory: string,
    depth: number,
    inheritedArtist: string | undefined,
  ): Promise<void> => {
    if (await folderHasAudio(directory)) {
      results.push({
        path: directory,
        ...(depth > 0 && inheritedArtist ? { artistHint: inheritedArtist } : {}),
      });
      return;
    }
    if (depth >= maxDepth) return;

    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const childArtist =
      depth === 0 ? inheritedArtist : inheritedArtist ?? path.basename(directory);
    const children = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !SKIP_DIRECTORIES.has(entry.name.toLowerCase()),
      )
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => natural.compare(path.basename(a), path.basename(b)));

    for (const child of children) {
      await walk(child, depth + 1, childArtist);
    }
  };

  await walk(root, 0, undefined);
  if (results.length === 0 && await folderHasAudio(root)) {
    return [{ path: root }];
  }
  return results;
}

/** Read one album folder's files, tags, art, and inferred hints. */
export async function scanAlbumFolder(
  folderPath: string,
  options: ScanOptions,
): Promise<AlbumFolder> {
  const absolute = path.resolve(folderPath);
  const folderName = path.basename(absolute);
  const entries = await readdir(absolute, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => natural.compare(a, b));
  const audioNames = fileNames.filter(isAudioFile);

  const tracks = await mapLimit(audioNames, 5, async (fileName) => {
    return readTrack(path.join(absolute, fileName));
  });
  tracks.sort((a, b) => {
    const discA = a.disc ?? 1;
    const discB = b.disc ?? 1;
    if (discA !== discB) return discA - discB;
    const trackA = a.track ?? 9999;
    const trackB = b.track ?? 9999;
    if (trackA !== trackB) return trackA - trackB;
    return natural.compare(a.fileName, b.fileName);
  });

  const images = await readImages(absolute, fileNames, options.artCacheDir, audioNames);
  const duplicates = detectDuplicates(tracks);

  const tagArtist = modeOf(tracks.map((track) => track.albumArtist)) ??
    modeOf(tracks.map((track) => track.artist));
  const tagAlbum = modeOf(tracks.map((track) => track.album));
  const tagYear = modeYear(tracks.map((track) => track.year));
  const folderHints = parseFolderName(folderName);
  const containerArtist = options.artistHint;

  const rawArtist = tagArtist ?? folderHints.artist ?? containerArtist;
  const artist = rawArtist ? cleanArtistName(rawArtist) : undefined;
  const album = tagAlbum ?? folderHints.album;
  const year = tagYear ?? folderHints.year;
  const genres = normalizeGenres(tracks.flatMap((track) => track.genres ?? []));
  const usedFolder =
    (!tagArtist && Boolean(folderHints.artist || containerArtist)) ||
    (!tagAlbum && Boolean(folderHints.album));
  const hints: AlbumHints = {
    artist,
    album,
    year,
    ...(genres.length > 0 ? { genres } : {}),
    source: !tagArtist && !tagAlbum ? "folder" : usedFolder ? "mixed" : "tags",
  };

  return {
    id: albumIdFor(absolute),
    path: absolute,
    folderName,
    tracks,
    images,
    hints,
    status: audioNames.length > 0 ? "scanning" : "error",
    candidates: [],
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: [],
    duplicates,
    autoMatched: false,
    error: audioNames.length === 0 ? "No audio files found" : undefined,
    updatedAt: new Date().toISOString(),
  };
}
