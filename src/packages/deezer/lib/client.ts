import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { albumSimilarity, artistSimilarity } from "../../matching";

export class DeezerError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DeezerError";
  }
}

export interface DeezerAlbumInfo {
  albumId: number;
  title: string;
  artist?: string;
  genres: string[];
  label?: string;
  releaseDate?: string;
  url?: string;
}

export interface DeezerClientOptions {
  baseUrl?: string;
  cacheDir?: string;
  cacheTtlMs?: number;
  minIntervalMs?: number;
}

interface RawSearchAlbum {
  id?: number;
  title?: string;
  artist?: { name?: string };
}

interface RawSearchResponse {
  data?: RawSearchAlbum[];
}

interface RawAlbum {
  id?: number;
  title?: string;
  artist?: { name?: string };
  genres?: { data?: Array<{ name?: string }> };
  genre_id?: number;
  label?: string;
  release_date?: string;
  link?: string;
}

interface CacheEntry {
  at: number;
  data: unknown;
}

const DEFAULT_USER_AGENT = "DCTagger/0.1 +https://github.com/dctagger/dctagger";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

/**
 * Public Deezer API client. Used only as a metadata fallback (genre), never
 * for downloading. No credentials are required.
 */
export class DeezerClient {
  private readonly baseUrl: string;
  private readonly cacheDir?: string;
  private readonly cacheTtlMs: number;
  private readonly minIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: DeezerClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.deezer.com").replace(/\/+$/, "");
    this.cacheDir = options.cacheDir;
    this.cacheTtlMs = options.cacheTtlMs ?? 30 * 24 * 60 * 60 * 1000;
    this.minIntervalMs = options.minIntervalMs ?? 300;
  }

  /**
   * Search for an album by artist/title and return the best match. Returns
   * undefined rather than guessing when no result is close enough.
   */
  async findAlbum(artist: string | undefined, album: string): Promise<DeezerAlbumInfo | undefined> {
    const query = [artist, album].filter(Boolean).join(" ").trim();
    if (!query) return undefined;

    const response = await this.request<RawSearchResponse>("/search/album", {
      q: query,
      limit: "8",
    });
    const results = (response.data ?? []).filter(
      (result): result is RawSearchAlbum & { id: number; title: string } =>
        typeof result.id === "number" && Boolean(result.title),
    );
    if (results.length === 0) return undefined;

    const scored = results
      .map((result) => {
        const titleScore = albumSimilarity(album, result.title);
        const artistScore = artist
          ? artistSimilarity(artist, result.artist?.name)
          : 0.5;
        return {
          result,
          score: artist ? 0.7 * titleScore + 0.3 * artistScore : titleScore,
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 0.55) return undefined;
    return this.getAlbum(best.result.id);
  }

  async getAlbum(albumId: number): Promise<DeezerAlbumInfo> {
    const raw = await this.request<RawAlbum>(`/album/${albumId}`, {});
    const genres = (raw.genres?.data ?? [])
      .map((genre) => genre.name?.trim())
      .filter((name): name is string => Boolean(name));

    if (genres.length === 0 && raw.genre_id) {
      try {
        const genre = await this.request<{ name?: string }>(`/genre/${raw.genre_id}`, {});
        if (genre.name?.trim()) genres.push(genre.name.trim());
      } catch {
        // Not fatal: the album still has useful data.
      }
    }

    if (typeof raw.id !== "number" || !raw.title) {
      throw new DeezerError("Deezer returned an incomplete album");
    }

    return {
      albumId: raw.id,
      title: raw.title,
      artist: raw.artist?.name,
      genres,
      label: raw.label,
      releaseDate: raw.release_date,
      url: raw.link,
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
              "User-Agent": DEFAULT_USER_AGENT,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(8_000),
          });
          if (response.status === 429) {
            const retryAfter = Number.parseFloat(response.headers.get("retry-after") ?? "2");
            await sleep(Math.max(1, retryAfter) * 1000);
            continue;
          }
          if (!response.ok) {
            const body = (await response.text()).slice(0, 200);
            throw new DeezerError(
              `Deezer request failed (HTTP ${response.status})${body ? `: ${body}` : ""}`,
              response.status,
            );
          }
          const data = (await response.json()) as T;
          await this.writeCache(key, data);
          return data;
        } catch (error) {
          lastError = error;
          if (error instanceof DeezerError) break;
          if (attempt === 1) break;
          await sleep(800);
        }
      }
      if (lastError instanceof Error) throw lastError;
      throw new DeezerError("Deezer request failed");
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
