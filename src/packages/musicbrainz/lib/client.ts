import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { albumSimilarity, artistSimilarity } from "../../matching";

export class MusicBrainzError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MusicBrainzError";
  }
}

export interface MusicBrainzAlbumInfo {
  releaseGroupId: string;
  title: string;
  artist?: string;
  genres: string[];
  score?: number;
}

export interface MusicBrainzClientOptions {
  baseUrl?: string;
  userAgent?: string;
  cacheDir?: string;
  cacheTtlMs?: number;
  minIntervalMs?: number;
}

interface RawArtistCredit {
  name?: string;
  artist?: { name?: string };
}

interface RawSearchGroup {
  id?: string;
  score?: number;
  title?: string;
  "artist-credit"?: RawArtistCredit[];
}

interface RawSearchResponse {
  "release-groups"?: RawSearchGroup[];
}

interface RawGenre {
  name?: string;
  count?: number;
}

interface RawReleaseGroup {
  id?: string;
  title?: string;
  "artist-credit"?: RawArtistCredit[];
  genres?: RawGenre[];
}

interface CacheEntry {
  at: number;
  data: unknown;
}

const DEFAULT_USER_AGENT =
  "DCTagger/0.1 +https://github.com/dctagger/dctagger (local music tagger)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_GENRES = 4;

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function artistNames(credits: RawArtistCredit[] | undefined): string[] {
  return (credits ?? [])
    .map((credit) => credit.name ?? credit.artist?.name)
    .filter((name): name is string => Boolean(name));
}

/**
 * MusicBrainz public API client, used only as a genre fallback.
 * See https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting.
 */
export class MusicBrainzClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly cacheDir?: string;
  private readonly cacheTtlMs: number;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: MusicBrainzClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://musicbrainz.org/ws/2").replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.cacheDir = options.cacheDir;
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
  }

  async findAlbum(
    artist: string | undefined,
    album: string,
  ): Promise<MusicBrainzAlbumInfo | undefined> {
    if (!album.trim()) return undefined;
    const escapedAlbum = escapeLucene(album);
    const escapedArtist = artist ? escapeLucene(artist) : undefined;
    const query = escapedArtist
      ? `releasegroup:"${escapedAlbum}" AND artist:"${escapedArtist}"`
      : `releasegroup:"${escapedAlbum}"`;

    const response = await this.request<RawSearchResponse>("/release-group", {
      query,
      fmt: "json",
      limit: "5",
    });
    const results = (response["release-groups"] ?? []).filter(
      (result): result is RawSearchGroup & { id: string; title: string } =>
        typeof result.id === "string" && Boolean(result.title),
    );
    if (results.length === 0) return undefined;

    const scored = results
      .map((result) => {
        const titleScore = albumSimilarity(album, result.title);
        const names = artistNames(result["artist-credit"]);
        const artistScore = artist
          ? Math.max(0, ...names.map((name) => artistSimilarity(artist, name)))
          : 0.5;
        return {
          result,
          score: artist ? 0.7 * titleScore + 0.3 * artistScore : titleScore,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 0.55) return undefined;
    const info = await this.getReleaseGroup(best.result.id);
    return {
      ...info,
      artist: info.artist ?? (artistNames(best.result["artist-credit"]).join(", ") || undefined),
      score: Math.round(best.score * 1000) / 1000,
    };
  }

  async getReleaseGroup(releaseGroupId: string): Promise<MusicBrainzAlbumInfo> {
    const raw = await this.request<RawReleaseGroup>(
      `/release-group/${encodeURIComponent(releaseGroupId)}`,
      { inc: "genres", fmt: "json" },
    );
    if (!raw.id || !raw.title) {
      throw new MusicBrainzError("MusicBrainz returned an incomplete release group");
    }

    const genres = (raw.genres ?? [])
      .filter((genre): genre is { name: string; count?: number } => Boolean(genre.name?.trim()))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .map((genre) => genre.name.trim())
      .slice(0, MAX_GENRES);

    return {
      releaseGroupId: raw.id,
      title: raw.title,
      artist: artistNames(raw["artist-credit"]).join(", ") || undefined,
      genres,
    };
  }

  private async request<T>(endpoint: string, fields: Record<string, string>): Promise<T> {
    const params = new URLSearchParams(fields);
    const url = `${this.baseUrl}${endpoint}${params.size > 0 ? `?${params.toString()}` : ""}`;
    const key = hash(url);

    const cached = await this.readCache<T>(key);
    if (cached !== undefined) return cached;

    return this.enqueue(async () => {
      const secondLook = await this.readCache<T>(key);
      if (secondLook !== undefined) return secondLook;

      await this.throttle();
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": this.userAgent,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(10_000),
          });
          if (response.status === 503 || response.status === 429) {
            lastError = new MusicBrainzError(
              `MusicBrainz unavailable (HTTP ${response.status}); try again later`,
              response.status,
            );
            await sleep(1500 * (attempt + 1));
            continue;
          }
          if (!response.ok) {
            const body = (await response.text()).slice(0, 200);
            throw new MusicBrainzError(
              `MusicBrainz request failed (HTTP ${response.status})${body ? `: ${body}` : ""}`,
              response.status,
            );
          }
          const data = (await response.json()) as T;
          await this.writeCache(key, data);
          return data;
        } catch (error) {
          lastError = error;
          if (error instanceof MusicBrainzError) break;
          if (attempt === 1) break;
          await sleep(1100);
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new MusicBrainzError("MusicBrainz request failed");
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async readCache<T>(key: string): Promise<T | undefined> {
    if (!this.cacheDir) return undefined;
    try {
      const raw = JSON.parse(
        await readFile(path.join(this.cacheDir, `${key}.json`), "utf8"),
      ) as CacheEntry;
      if (Date.now() - raw.at > this.cacheTtlMs) return undefined;
      return raw.data as T;
    } catch {
      return undefined;
    }
  }

  private async writeCache(key: string, data: unknown): Promise<void> {
    if (!this.cacheDir) return;
    await mkdir(this.cacheDir, { recursive: true });
    const file = path.join(this.cacheDir, `${key}.json`);
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const payload = JSON.stringify({ at: Date.now(), data } satisfies CacheEntry);
    await writeFile(tmp, payload);
    await rename(tmp, file).catch(async () => {
      await writeFile(file, payload);
    });
  }
}

function escapeLucene(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
