import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DiscogsClient, DiscogsError } from "../../discogs";
import {
  DeezerClient,
  type DeezerAlbumInfo,
  type DeezerTrackInfo,
} from "../../deezer";
import { MusicBrainzClient } from "../../musicbrainz";
import {
  albumIdFor,
  applyAlbum,
  chooseKeeper,
  duplicatePaths,
  enumerateAlbumFolders,
  expandHome,
  scanAlbumFolder,
  uniqueTracks,
  type CoverArt,
} from "../../library";
import { autoMap, isHighConfidence, rankReleases, similarity } from "../../matching";
import type {
  AlbumFolder,
  ApplyResult,
  ApplyState,
  DiscogsIdentity,
  DiscogsRelease,
  FolderListing,
  MatchCandidate,
  PublicSettings,
  ScanState,
  ScanSummary,
  SessionView,
  SettingsUpdate,
  TrackAssignment,
} from "../../model/types";
import { SettingsStore, type StoredSettings, toPublicSettings } from "./settings";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

function messageOf(error: unknown): string {
  if (error instanceof DiscogsError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function emptySummary(): ScanSummary {
  return {
    total: 0,
    autoMatched: 0,
    needsReview: 0,
    confirmed: 0,
    skipped: 0,
    applied: 0,
    errors: 0,
  };
}

function summarize(albums: AlbumFolder[]): ScanSummary {
  const summary = emptySummary();
  summary.total = albums.length;
  for (const album of albums) {
    if (album.status === "auto-matched") summary.autoMatched += 1;
    if (album.status === "needs-review") summary.needsReview += 1;
    if (album.status === "confirmed") summary.confirmed += 1;
    if (album.status === "skipped") summary.skipped += 1;
    if (album.status === "applied") summary.applied += 1;
    if (album.status === "error") summary.errors += 1;
  }
  return summary;
}

function emptyScan(rootFolder: string): ScanState {
  return {
    phase: "idle",
    rootFolder,
    total: 0,
    done: 0,
    summary: emptySummary(),
  };
}

function emptyApply(): ApplyState {
  return {
    phase: "idle",
    total: 0,
    done: 0,
    results: [],
  };
}

function emptySession(rootFolder: string): SessionView {
  return {
    scan: emptyScan(rootFolder),
    apply: emptyApply(),
    albums: [],
  };
}

function emptyAlbum(folderPath: string, error: string): AlbumFolder {
  return {
    id: albumIdFor(folderPath),
    path: folderPath,
    folderName: path.basename(folderPath),
    tracks: [],
    images: [],
    hints: { source: "folder" },
    status: "error",
    candidates: [],
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: [],
    duplicates: [],
    autoMatched: false,
    error,
    updatedAt: new Date().toISOString(),
  };
}

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function deezerRelease(
  info: DeezerAlbumInfo,
  tracks: DeezerTrackInfo[],
): DiscogsRelease {
  const artist = info.artist?.trim() || "Unknown Artist";
  const discCount = Math.max(1, ...tracks.map((track) => track.diskNumber ?? 1));
  const tracklist = tracks.map((track, index) => {
    const disc = track.diskNumber && track.diskNumber > 0 ? track.diskNumber : 1;
    const trackNumber =
      track.trackPosition && track.trackPosition > 0 ? track.trackPosition : index + 1;
    return {
      index,
      position:
        discCount > 1
          ? `${disc}-${String(trackNumber).padStart(2, "0")}`
          : String(trackNumber),
      title: track.title.trim(),
      duration: formatDuration(track.duration),
      artists: track.artist ? [track.artist] : [],
      disc,
      trackNumber,
    };
  });
  const year = info.releaseDate
    ? Number.parseInt(info.releaseDate.slice(0, 4), 10)
    : undefined;

  return {
    id: -info.albumId,
    source: "deezer",
    title: info.title,
    artists: [{ name: artist }],
    year: Number.isFinite(year) ? year : undefined,
    released: info.releaseDate,
    genres: info.genres,
    styles: [],
    labels: info.label ? [{ name: info.label }] : [],
    formats: [{ name: "Digital", descriptions: ["Album"] }],
    tracklist,
    images: info.coverUrl
      ? [{ uri: info.coverUrl, width: 1000, height: 1000, type: "primary" }]
      : [],
    uri: info.url ?? `https://www.deezer.com/album/${info.albumId}`,
    thumb: info.coverUrl,
    coverImage: info.coverUrl,
  };
}

interface MatchOptions {
  allowAuto: boolean;
  query?: string;
}

export class AppState {
  readonly dataDir: string;
  readonly artCacheDir: string;
  readonly cacheDir: string;

  private readonly store: SettingsStore;
  private readonly sessionFile: string;
  private clientCache?: { token: string; client: DiscogsClient };
  private imageClientCache?: { token: string; baseUrl?: string; client: DiscogsClient };
  private deezerClientCache?: { baseUrl?: string; client: DeezerClient };
  private musicBrainzClientCache?: { baseUrl?: string; client: MusicBrainzClient };

  session: SessionView;
  private scanRunning = false;
  private applyRunning = false;
  private scanCancelled = false;
  private applyCancelled = false;

  private constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.artCacheDir = path.join(dataDir, "art");
    this.cacheDir = path.join(dataDir, "cache");
    this.sessionFile = path.join(dataDir, "session.json");
    this.store = new SettingsStore(dataDir);
    this.session = emptySession("");
  }

  static async create(dataDir?: string): Promise<AppState> {
    const resolved = path.resolve(
      dataDir ?? process.env.DCTAGGER_DATA_DIR ?? path.join(process.cwd(), ".dctagger"),
    );
    await mkdir(resolved, { recursive: true });
    const state = new AppState(resolved);
    await state.store.load();
    state.session = await state.loadSession();
    return state;
  }

  get settings(): StoredSettings {
    return this.store.settings;
  }

  publicSettings(): PublicSettings {
    return toPublicSettings(this.store.settings);
  }

  async updateSettings(update: SettingsUpdate): Promise<PublicSettings> {
    const previousToken = this.store.settings.discogsToken;
    await this.store.update(update);
    if (this.store.settings.discogsToken !== previousToken) {
      this.clientCache = undefined;
      this.imageClientCache = undefined;
      if (!this.store.settings.discogsToken) {
        this.store.settings.discogsUser = undefined;
        await this.store.save();
      }
    }
    if (this.session.scan.phase === "idle") {
      this.session.scan.rootFolder = this.store.settings.rootFolder;
    }
    await this.saveSession();
    return this.publicSettings();
  }

  client(token?: string): DiscogsClient {
    const effective = token ?? this.store.settings.discogsToken;
    if (!effective) {
      throw new AppError(400, "A Discogs token is required. Add one in Settings.");
    }
    if (!token && this.clientCache?.token === effective) return this.clientCache.client;
    const baseUrl = process.env.DCTAGGER_DISCOGS_BASE_URL?.trim();
    const client = new DiscogsClient({
      token: effective,
      cacheDir: this.cacheDir,
      ...(baseUrl ? { baseUrl } : {}),
    });
    if (!token) this.clientCache = { token: effective, client };
    return client;
  }

  imageClient(): DiscogsClient {
    const token = this.store.settings.discogsToken;
    const baseUrl = process.env.DCTAGGER_DISCOGS_BASE_URL?.trim() || undefined;
    if (
      this.imageClientCache?.token === token &&
      this.imageClientCache.baseUrl === baseUrl
    ) {
      return this.imageClientCache.client;
    }
    const client = new DiscogsClient({
      token,
      cacheDir: this.cacheDir,
      ...(baseUrl ? { baseUrl } : {}),
    });
    this.imageClientCache = { token, baseUrl, client };
    return client;
  }

  deezerClient(): DeezerClient {
    const baseUrl = process.env.DCTAGGER_DEEZER_BASE_URL?.trim() || undefined;
    const cached = this.deezerClientCache;
    if (cached && cached.baseUrl === baseUrl) {
      return cached.client;
    }
    const client = new DeezerClient({
      cacheDir: path.join(this.cacheDir, "deezer"),
      ...(baseUrl ? { baseUrl } : {}),
    });
    this.deezerClientCache = { baseUrl, client };
    return client;
  }

  musicBrainzClient(): MusicBrainzClient {
    const baseUrl = process.env.DCTAGGER_MUSICBRAINZ_BASE_URL?.trim() || undefined;
    const cached = this.musicBrainzClientCache;
    if (cached && cached.baseUrl === baseUrl) {
      return cached.client;
    }
    const client = new MusicBrainzClient({
      cacheDir: path.join(this.cacheDir, "musicbrainz"),
      ...(baseUrl ? { baseUrl } : {}),
    });
    this.musicBrainzClientCache = { baseUrl, client };
    return client;
  }

  async testDiscogs(token?: string): Promise<DiscogsIdentity> {
    const client = this.client(token);
    const identity = await client.getIdentity();
    if (!token) {
      this.store.settings.discogsUser = identity.username;
      await this.store.save();
    }
    return identity;
  }

  async beginScan(rootFolder?: string): Promise<SessionView> {
    if (this.scanRunning) throw new AppError(409, "A scan is already running");
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    if (!this.store.settings.discogsToken) {
      throw new AppError(400, "Add a Discogs token in Settings before scanning");
    }

    // Fail fast with a clear 401 instead of discovering a bad token after the
    // scan has already burned through folder metadata reads.
    const identity = await this.client().getIdentity();
    if (this.store.settings.discogsUser !== identity.username) {
      this.store.settings.discogsUser = identity.username;
      await this.store.save();
    }

    const requested = (rootFolder ?? this.store.settings.rootFolder).trim();
    if (!requested) throw new AppError(400, "Choose a music folder to scan");
    const root = path.resolve(expandHome(requested));
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
      throw new AppError(400, `Not a folder: ${root}`);
    }

    if (root !== this.store.settings.rootFolder) {
      this.store.settings.rootFolder = root;
      await this.store.save();
    }

    this.scanCancelled = false;
    this.session = emptySession(root);
    this.session.scan.phase = "scanning";
    this.session.scan.rootFolder = root;
    this.session.scan.startedAt = new Date().toISOString();
    this.scanRunning = true;
    await this.saveSession();

    void this.runScan(root);

    return this.session;
  }

  async cancelScan(): Promise<SessionView> {
    if (!this.scanRunning) return this.session;
    this.scanCancelled = true;
    return this.session;
  }

  async resetSession(): Promise<SessionView> {
    if (this.scanRunning || this.applyRunning) {
      throw new AppError(409, "Cannot reset while a job is running");
    }
    this.session = emptySession(this.store.settings.rootFolder);
    await this.saveSession();
    return this.session;
  }

  async lookup(
    albumId: string,
    query?: string,
    source: "discogs" | "deezer" = "discogs",
  ): Promise<AlbumFolder> {
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    const album = this.albumOrThrow(albumId);
    if (source === "deezer") {
      await this.matchDeezer(album, query);
    } else {
      const trimmed = query?.trim();
      const fallbackArtist = album.hints.artist;
      const fallbackAlbum = album.hints.album || album.folderName;
      const useQuery =
        trimmed || (!fallbackArtist && !fallbackAlbum ? album.folderName : undefined);

      await this.matchAlbum(album, {
        allowAuto: false,
        query: useQuery || undefined,
      });
    }
    this.refreshSummary();
    await this.saveSession();
    return album;
  }

  async confirm(
    albumId: string,
    input: {
      releaseId: number;
      mapping?: Array<{ filePath: string; trackIndex: number | null }>;
      coverOverride?: string | null;
    },
  ): Promise<AlbumFolder> {
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    const album = this.albumOrThrow(albumId);
    if (album.status === "applied") throw new AppError(409, "This album has already been applied");

    const candidate = [...album.candidates, ...album.deezerCandidates].find(
      (entry) => entry.release.id === Number(input.releaseId),
    );
    if (!candidate) throw new AppError(400, "Choose one of the available matches");
    const release = candidate.release;

    const provided = new Map<string, number | null>();
    for (const entry of input.mapping ?? []) {
      if (typeof entry.filePath !== "string") continue;
      const value = entry.trackIndex === null ? null : Number(entry.trackIndex);
      if (value !== null && !release.tracklist.some((track) => track.index === value)) {
        throw new AppError(400, "Mapping points at a track that does not exist");
      }
      provided.set(entry.filePath, value);
    }

    const losers = duplicatePaths(album.duplicates);
    const trackIds = new Set(release.tracklist.map((track) => track.index));
    const mapping: TrackAssignment[] = album.tracks.map((track) => {
      if (losers.has(track.path)) {
        return { filePath: track.path, trackIndex: null };
      }
      const value = provided.get(track.path);
      return {
        filePath: track.path,
        trackIndex: value !== undefined && value !== null && trackIds.has(value) ? value : null,
      };
    });

    if (!mapping.some((entry) => entry.trackIndex !== null)) {
      throw new AppError(400, "Map at least one file to a track before confirming");
    }
    const usedTracks = new Set<number>();
    for (const entry of mapping) {
      if (entry.trackIndex === null) continue;
      if (usedTracks.has(entry.trackIndex)) {
        throw new AppError(400, "Two files cannot be mapped to the same track");
      }
      usedTracks.add(entry.trackIndex);
    }

    if (input.coverOverride !== undefined) {
      if (input.coverOverride === null || input.coverOverride === "") {
        album.coverOverride = undefined;
      } else if (album.images.some((image) => image.path === input.coverOverride)) {
        album.coverOverride = input.coverOverride;
      } else {
        throw new AppError(400, "Cover override is not a folder image");
      }
    }

    album.selectedReleaseId = release.id;
    album.mapping = mapping;
    album.status = "confirmed";
    album.autoMatched = false;
    album.error = undefined;
    await this.enrichGenreFallback(album, release);
    album.updatedAt = new Date().toISOString();
    this.refreshSummary();
    await this.saveSession();
    return album;
  }

  async skip(albumId: string): Promise<AlbumFolder> {
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    const album = this.albumOrThrow(albumId);
    if (album.status === "applied") throw new AppError(409, "This album has already been applied");
    album.status = "skipped";
    album.updatedAt = new Date().toISOString();
    this.refreshSummary();
    await this.saveSession();
    return album;
  }

  async reopen(albumId: string): Promise<AlbumFolder> {
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    const album = this.albumOrThrow(albumId);
    if (album.status === "applied") {
      if (!album.applied?.errors.length) {
        throw new AppError(409, "This album was applied cleanly; there is nothing to retry");
      }
      album.status = "confirmed";
      album.autoMatched = false;
      album.applied = undefined;
    } else {
      album.status = "needs-review";
      album.autoMatched = false;
    }
    album.updatedAt = new Date().toISOString();
    this.refreshSummary();
    await this.saveSession();
    return album;
  }

  async setDedupeKeeper(
    albumId: string,
    key: string,
    keepPath: string,
  ): Promise<AlbumFolder> {
    if (this.applyRunning) throw new AppError(409, "Wait for the apply job to finish");
    const album = this.albumOrThrow(albumId);
    if (album.status === "applied") throw new AppError(409, "This album has already been applied");

    const group = album.duplicates.find((entry) => entry.key === key);
    if (!group) throw new AppError(404, "Duplicate group not found");
    if (!group.members.some((member) => member.path === keepPath)) {
      throw new AppError(400, "That file is not part of this duplicate group");
    }

    album.duplicates = chooseKeeper(album.duplicates, key, keepPath);
    const selected = [...album.candidates, ...album.deezerCandidates].find(
      (entry) => entry.release.id === album.selectedReleaseId,
    );
    if (selected) {
      album.mapping = this.mappingFor(album, selected.release);
    } else {
      album.mapping = album.tracks.map((track) => ({
        filePath: track.path,
        trackIndex: null,
      }));
    }
    album.status = "needs-review";
    album.autoMatched = false;
    album.updatedAt = new Date().toISOString();
    this.refreshSummary();
    await this.saveSession();
    return album;
  }

  async beginApply(): Promise<SessionView> {
    if (this.applyRunning) throw new AppError(409, "An apply job is already running");
    if (this.scanRunning) throw new AppError(409, "Wait for the scan to finish");

    const albums = this.session.albums.filter(
      (album) => album.status === "confirmed" || album.status === "auto-matched",
    );
    if (albums.length === 0) {
      throw new AppError(400, "There are no confirmed matches to apply");
    }

    const destination = this.store.settings.destinationFolder.trim();
    if (!destination) throw new AppError(400, "Choose a destination folder in Settings");
    const destinationRoot = path.resolve(expandHome(destination));
    await mkdir(destinationRoot, { recursive: true }).catch((error) => {
      throw new AppError(400, `Cannot create destination folder: ${messageOf(error)}`);
    });

    if (albums.some((album) => !album.coverOverride)) {
      // Throws early with a clear message when no token is configured.
      this.client();
    }

    this.applyCancelled = false;
    this.session.apply = {
      phase: "running",
      total: albums.length,
      done: 0,
      results: [],
      startedAt: new Date().toISOString(),
    };
    this.applyRunning = true;
    await this.saveSession();

    void this.runApply(albums, destinationRoot);
    return this.session;
  }

  async cancelApply(): Promise<SessionView> {
    if (!this.applyRunning) return this.session;
    this.applyCancelled = true;
    return this.session;
  }

  async listFolders(input?: string): Promise<FolderListing> {
    const requested = input?.trim() || this.store.settings.rootFolder || os.homedir();
    const target = path.resolve(expandHome(requested));
    const info = await stat(target).catch(() => null);
    if (!info?.isDirectory()) throw new AppError(400, `Not a folder: ${target}`);

    const entries = await readdir(target, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    let audioFiles = 0;
    for (const entry of entries) {
      if (entry.isFile() && /\.(mp3|flac|m4a|ogg|opus|wav|aiff?|ape|wv|wma)$/i.test(entry.name)) {
        audioFiles += 1;
      }
    }
    const parent = path.dirname(target);
    return {
      path: target,
      parent: parent === target ? null : parent,
      directories,
      audioFiles,
    };
  }

  albumOrThrow(albumId: string): AlbumFolder {
    const album = this.session.albums.find((entry) => entry.id === albumId);
    if (!album) throw new AppError(404, "Album not found");
    return album;
  }

  private async runScan(root: string): Promise<void> {
    const scan = this.session.scan;
    try {
      const folders = await enumerateAlbumFolders(root);
      scan.total = folders.length;
      await this.saveSession();

      for (const location of folders) {
        if (this.scanCancelled) break;
        scan.currentFolder = location.path;

        let album: AlbumFolder;
        try {
          album = await scanAlbumFolder(location.path, {
            artCacheDir: this.artCacheDir,
            artistHint: location.artistHint,
          });
        } catch (error) {
          album = emptyAlbum(location.path, `Could not read folder: ${messageOf(error)}`);
        }

        this.session.albums.push(album);
        await this.saveSession();

        if (album.tracks.length > 0) {
          try {
            await this.matchAlbum(album, { allowAuto: true });
          } catch (error) {
            album.status = "needs-review";
            album.error = messageOf(error);
          }
        }

        scan.done += 1;
        this.refreshSummary();
        await this.saveSession();
      }

      scan.currentFolder = undefined;
      scan.finishedAt = new Date().toISOString();
      scan.phase = this.scanCancelled ? "cancelled" : "done";
      scan.error = undefined;
      this.refreshSummary();
      await this.saveSession();
    } catch (error) {
      scan.phase = "error";
      scan.error = messageOf(error);
      scan.currentFolder = undefined;
      scan.finishedAt = new Date().toISOString();
      this.refreshSummary();
      await this.saveSession();
    } finally {
      this.scanRunning = false;
    }
  }

  private async matchAlbum(album: AlbumFolder, options: MatchOptions): Promise<void> {
    album.deezerCandidates = [];
    album.deezerCandidatesLoaded = false;
    const unique = uniqueTracks(album.tracks, album.duplicates);
    if (unique.length === 0) {
      album.status = "needs-review";
      album.error = "No unique audio tracks found";
      album.updatedAt = new Date().toISOString();
      return;
    }

    const client = this.client();
    const limit = this.store.settings.candidateCount;
    const hasHints = Boolean(album.hints.artist || album.hints.album);
    const searchQuery = options.query ?? (hasHints ? undefined : album.folderName);

    const summaries = await client.searchReleases({
      ...(searchQuery ? { query: searchQuery } : {}),
      ...(!searchQuery ? { artist: album.hints.artist, album: album.hints.album } : {}),
      limit: Math.max(limit * 2, 8),
    });

    if (summaries.length === 0) {
      album.candidates = [];
      album.selectedReleaseId = undefined;
      album.mapping = album.tracks.map((track) => ({
        filePath: track.path,
        trackIndex: null,
      }));
      album.status = "needs-review";
      album.autoMatched = false;
      album.confidence = undefined;
      album.error = "No Discogs matches found. Try a Discogs or Deezer manual lookup.";
      album.updatedAt = new Date().toISOString();
      return;
    }

    const releases: DiscogsRelease[] = [];
    const failures: string[] = [];
    for (const summary of summaries.slice(0, Math.max(limit, 1))) {
      try {
        releases.push(await client.getRelease(summary.id, summary.coverImage));
      } catch (error) {
        failures.push(`${summary.title}: ${messageOf(error)}`);
      }
    }
    if (releases.length === 0) {
      throw new AppError(502, failures[0] ?? "Could not load Discogs releases");
    }

    const local = {
      artist: album.hints.artist,
      album: album.hints.album,
      year: album.hints.year,
      tracks: unique.map((track) => ({
        title: track.title,
        fileName: track.fileName,
        track: track.track,
        duration: track.duration,
      })),
    };

    const ranked = rankReleases(local, releases)
      .slice(0, Math.max(1, limit))
      .map<MatchCandidate>((entry) => ({
        release: entry.release,
        score: entry.score,
        breakdown: entry.breakdown,
      }));

    const top = ranked[0];
    if (!top) {
      album.status = "needs-review";
      album.error = "No Discogs matches found";
      return;
    }

    album.candidates = ranked;
    album.selectedReleaseId = top.release.id;
    await this.enrichGenreFallback(album, top.release);
    album.confidence = top.score;
    album.mapping = this.mappingFor(album, top.release);
    album.error = failures.length > 0 ? `Some matches failed to load: ${failures[0]}` : undefined;

    const high = options.allowAuto && isHighConfidence(
      { score: top.score, breakdown: top.breakdown },
      ranked[1] ? { score: ranked[1].score, breakdown: ranked[1].breakdown } : undefined,
      {
        threshold: this.store.settings.autoThreshold,
        margin: this.store.settings.autoMargin,
        hasArtist: Boolean(album.hints.artist),
        hasAlbum: Boolean(album.hints.album),
      },
    );

    album.autoMatched = high;
    album.status = high ? "auto-matched" : "needs-review";
    album.updatedAt = new Date().toISOString();
  }

  /**
   * Load Deezer candidates. They are displayed alongside Discogs candidates
   * and only become the selected release when there are no Discogs matches or
   * the user explicitly selects one.
   */
  private async matchDeezer(album: AlbumFolder, query?: string): Promise<void> {
    const unique = uniqueTracks(album.tracks, album.duplicates);
    if (unique.length === 0) {
      album.status = "needs-review";
      album.error = "No unique audio tracks found";
      album.updatedAt = new Date().toISOString();
      return;
    }

    const trimmed = query?.trim();
    const artist = trimmed ? undefined : album.hints.artist;
    const albumQuery = trimmed || album.hints.album || album.folderName;
    const summaries = await this.deezerClient().searchAlbums(artist, albumQuery, 6);
    const hasDiscogs = album.candidates.length > 0;

    if (summaries.length === 0) {
      album.deezerCandidates = [];
      album.deezerCandidatesLoaded = true;
      if (!hasDiscogs) {
        album.selectedReleaseId = undefined;
        album.mapping = album.tracks.map((track) => ({
          filePath: track.path,
          trackIndex: null,
        }));
        album.status = "needs-review";
        album.autoMatched = false;
        album.confidence = undefined;
        album.error =
          "No Discogs or Deezer matches found. Try a manual lookup with a different query.";
        album.updatedAt = new Date().toISOString();
      }      return;
    }

    const releases: DiscogsRelease[] = [];
    const failures: string[] = [];
    for (const summary of summaries.slice(0, 4)) {
      try {
        const info = await this.deezerClient().getAlbum(summary.albumId);
        const tracks = await this.deezerClient().getAlbumTracks(summary.albumId);
        if (tracks.length === 0) continue;
        releases.push(deezerRelease(info, tracks));
      } catch (error) {
        failures.push(`${summary.title}: ${messageOf(error)}`);
      }
    }

    if (releases.length === 0) {
      album.deezerCandidates = [];
      album.deezerCandidatesLoaded = true;
      if (!hasDiscogs) {
        album.selectedReleaseId = undefined;
        album.mapping = album.tracks.map((track) => ({
          filePath: track.path,
          trackIndex: null,
        }));
        album.status = "needs-review";
        album.autoMatched = false;
        album.confidence = undefined;
        album.error =
          failures[0] ?? "No Discogs or Deezer matches found. Try a different query.";
        album.updatedAt = new Date().toISOString();
      }
      return;
    }

    const local = {
      artist: album.hints.artist,
      album: album.hints.album,
      year: album.hints.year,
      tracks: unique.map((track) => ({
        title: track.title,
        fileName: track.fileName,
        track: track.track,
        duration: track.duration,
      })),
    };

    const ranked = rankReleases(local, releases)
      .slice(0, 4)
      .map<MatchCandidate>((entry) => ({
        release: entry.release,
        score: entry.score,
        breakdown: entry.breakdown,
      }));
    const ordered = trimmed
      ? releases
          .map((release) => {
            const rankedEntry = ranked.find((entry) => entry.release.id === release.id);
            if (!rankedEntry) return undefined;
            const artistName = release.artists[0]?.name ?? "";
            const queryScore = similarity(trimmed, `${artistName} ${release.title}`);
            return { ...rankedEntry, score: Math.round(queryScore * 10000) / 10000 };
          })
          .filter((entry): entry is MatchCandidate => Boolean(entry))
      : ranked;

    album.deezerCandidates = ordered;
    album.deezerCandidatesLoaded = true;

    const selectedStillExists =
      album.selectedReleaseId !== undefined &&
      (album.candidates.some((entry) => entry.release.id === album.selectedReleaseId) ||
        ordered.some((entry) => entry.release.id === album.selectedReleaseId));

    if (!hasDiscogs || !selectedStillExists) {
      const top = ordered[0] ?? album.candidates[0];
      if (top) {
        album.selectedReleaseId = top.release.id;
        album.confidence = top.score;
        album.mapping = this.mappingFor(album, top.release);
        await this.enrichGenreFallback(album, top.release);
      }
      album.status = "needs-review";
      album.autoMatched = false;
      album.error =
        failures.length > 0
          ? `Some Deezer matches failed to load: ${failures[0]}`
          : hasDiscogs
            ? album.error
            : undefined;
      album.updatedAt = new Date().toISOString();
    }
  }

  private mappingFor(album: AlbumFolder, release: DiscogsRelease): TrackAssignment[] {
    const unique = uniqueTracks(album.tracks, album.duplicates);
    const auto = autoMap(unique, release.tracklist);
    const byPath = new Map(auto.map((entry) => [entry.filePath, entry]));
    const losers = duplicatePaths(album.duplicates);
    return album.tracks.map((track) => {
      if (losers.has(track.path)) {
        return { filePath: track.path, trackIndex: null };
      }
      return byPath.get(track.path) ?? { filePath: track.path, trackIndex: null };
    });
  }

  private async runApply(albums: AlbumFolder[], destinationRoot: string): Promise<void> {
    const apply = this.session.apply;
    const settings = this.publicSettings();

    try {
      for (const album of albums) {
        if (this.applyCancelled) break;
        apply.current = album.folderName;

        let result: ApplyResult;
        try {
          const release = await this.releaseFor(album);
          await this.enrichGenreFallback(album, release);
          const coverResult = await this.coverFor(album, release);
          const applied = await applyAlbum({
            album,
            release,
            settings,
            destinationRoot,
            cover: coverResult.cover,
          });
          const errors = [...coverResult.errors, ...applied.errors];
          result = {
            ...applied,
            ok: applied.ok && errors.length === 0,
            errors,
          };

          album.status = "applied";
          album.applied = {
            targetFolder: applied.targetFolder ?? "",
            tagged: applied.tagged,
            files: applied.files,
            deduplicated: applied.deduplicated,
            skipped: applied.skipped ?? 0,
            errors,
            at: new Date().toISOString(),
          };
          album.updatedAt = new Date().toISOString();
        } catch (error) {
          const message = messageOf(error);
          result = {
            albumId: album.id,
            folderName: album.folderName,
            ok: false,
            tagged: 0,
            files: 0,
            deduplicated: 0,
            skipped: 0,
            errors: [message],
          };
          album.status = "error";
          album.error = message;
          album.updatedAt = new Date().toISOString();
        }

        apply.results.push(result);
        apply.done += 1;
        this.refreshSummary();
        await this.saveSession();
      }

      apply.current = undefined;
      apply.finishedAt = new Date().toISOString();
      apply.phase = this.applyCancelled ? "cancelled" : "done";
      this.refreshSummary();
      await this.saveSession();
    } catch (error) {
      apply.phase = "error";
      apply.error = messageOf(error);
      apply.current = undefined;
      apply.finishedAt = new Date().toISOString();
      await this.saveSession();
    } finally {
      this.applyRunning = false;
    }
  }

  private async releaseFor(album: AlbumFolder): Promise<DiscogsRelease> {
    const selected = album.selectedReleaseId;
    if (!selected) throw new AppError(400, "No release selected");
    const candidate = [...album.candidates, ...album.deezerCandidates].find(
      (entry) => entry.release.id === selected,
    );
    if (candidate) return candidate.release;
    return this.client().getRelease(selected);
  }

  /**
   * Genre enrichment order: Discogs → Deezer → MusicBrainz. Each network
   * fallback is best-effort and never blocks matching or applying.
   */
  private async enrichGenreFallback(
    album: AlbumFolder,
    release: DiscogsRelease,
  ): Promise<void> {
    const derivedGenres = [...release.genres, ...release.styles].filter((genre) =>
      genre?.trim(),
    );
    if (derivedGenres.length > 0) return;
    if (release.source !== "deezer") {
      await this.enrichWithDeezer(album, release);
      const deezerGenres =
        album.deezer?.releaseId === release.id ? album.deezer.genres : [];
      if (deezerGenres.length > 0) return;
    }
    await this.enrichWithMusicBrainz(album, release);
  }

  private async enrichWithMusicBrainz(
    album: AlbumFolder,
    release: DiscogsRelease,
  ): Promise<void> {
    if (album.musicbrainz?.releaseId === release.id) return;
    try {
      const info = await this.musicBrainzClient().findAlbum(
        release.artists[0]?.name,
        release.title,
      );
      if (info) {
        album.musicbrainz = { releaseId: release.id, ...info };
      }
    } catch {
      // MusicBrainz is optional metadata enrichment; never fail the operation.
    }
  }

  /**
   * Deezer is a best-effort genre fallback. It is only queried when Discogs has
   * neither genres nor styles, and failures never block matching or applying.
   */
  private async enrichWithDeezer(
    album: AlbumFolder,
    release: DiscogsRelease,
  ): Promise<void> {
    const discogsGenres = [...release.genres, ...release.styles].filter((genre) =>
      genre?.trim(),
    );
    if (discogsGenres.length > 0) return;
    if (album.deezer?.releaseId === release.id) return;

    try {
      const info = await this.deezerClient().findAlbum(
        release.artists[0]?.name,
        release.title,
      );
      if (info) {
        album.deezer = { releaseId: release.id, ...info };
      }
    } catch {
      // Deezer is optional metadata enrichment; never fail the operation.
    }
  }

  private async coverFor(
    album: AlbumFolder,
    release: DiscogsRelease,
  ): Promise<{ cover: CoverArt | null; errors: string[] }> {    const errors: string[] = [];

    if (album.coverOverride) {
      const image = album.images.find((entry) => entry.path === album.coverOverride);
      if (image) {
        try {
          const data = await readFile(image.path);
          const extension = path.extname(image.path).replace(/^\./, "") || "jpg";
          return {
            cover: { data, contentType: image.mimeType, extension },
            errors,
          };
        } catch (error) {
          errors.push(`Could not read local cover art: ${messageOf(error)}`);
        }
      }
    }

    const urls = [
      ...release.images.map((image) => image.uri),
      ...(release.coverImage ? [release.coverImage] : []),
    ].filter((url, index, all) => all.indexOf(url) === index);

    const imageClient = this.imageClient();
    for (const url of urls.slice(0, 3)) {
      try {
        const downloaded = await imageClient.downloadImage(url);
        return {
          cover: {
            data: downloaded.data,
            contentType: downloaded.contentType,
            extension: downloaded.extension,
          },
          errors: [],
        };
      } catch (error) {
        errors.push(messageOf(error));
      }
    }

    if (urls.length === 0) {
      errors.push("This release has no cover art");
    } else {
      errors.push("Could not download cover art");
    }
    return { cover: null, errors };
  }

  private refreshSummary(): void {
    this.session.scan.summary = summarize(this.session.albums);
    if (this.session.scan.phase === "idle") {
      this.session.scan.total = this.session.albums.length;
      this.session.scan.done = this.session.albums.length;
    }
  }

  private async loadSession(): Promise<SessionView> {
    try {
      const raw = JSON.parse(await readFile(this.sessionFile, "utf8")) as Partial<SessionView>;
      const scan = { ...emptyScan(this.store.settings.rootFolder), ...(raw.scan ?? {}) };
      const apply = { ...emptyApply(), ...(raw.apply ?? {}) };
      apply.results = Array.isArray(apply.results) ? apply.results : [];
      const albums = Array.isArray(raw.albums) ? raw.albums : [];

      if (scan.phase === "scanning") {
        scan.phase = "error";
        scan.error = "Scan was interrupted by a restart";
        scan.currentFolder = undefined;
      }
      if (apply.phase === "running") {
        apply.phase = "error";
        apply.error = "Apply job was interrupted by a restart";
        apply.current = undefined;
      }
      for (const album of albums) {
        if (album.status === "scanning") {
          album.status = "needs-review";
          album.error = "Scan was interrupted by a restart";
        }

        // Migrate sessions created before Deezer candidates were kept in a
        // separate list: any Deezer releases previously stored in candidates
        // move to deezerCandidates.
        const legacyDeezer = album.candidates.filter(
          (entry) => entry.release.source === "deezer",
        );
        const existingDeezer = Array.isArray(album.deezerCandidates)
          ? album.deezerCandidates
          : [];
        album.candidates = album.candidates.filter(
          (entry) => entry.release.source !== "deezer",
        );
        album.deezerCandidates =
          existingDeezer.length > 0 ? existingDeezer : legacyDeezer;
        album.deezerCandidatesLoaded =
          Boolean(album.deezerCandidatesLoaded) || album.deezerCandidates.length > 0;
      }

      const session: SessionView = { scan, apply, albums };
      session.scan.summary = summarize(albums);
      return session;
    } catch {
      return emptySession(this.store.settings.rootFolder);
    }
  }

  private async saveSession(): Promise<void> {
    const tmp = `${this.sessionFile}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.session));
    await rename(tmp, this.sessionFile);
  }
}
