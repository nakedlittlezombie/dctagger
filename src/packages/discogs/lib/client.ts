import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiscogsRelease } from "../../model/types";
import {
  mapRelease,
  mapSearchResult,
  type RawRelease,
  type RawSearchResponse,
  type SearchReleaseSummary,
} from "./raw";

export class DiscogsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DiscogsError";
  }
}

export interface DiscogsClientOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
  /** Minimum spacing between API requests. Discogs allows 60/min authenticated. */
  minIntervalMs?: number;
  cacheDir?: string;
  cacheTtlMs?: number;
}

interface JsonCacheEntry {
  at: number;
  data: unknown;
}

interface ImageCacheMeta {
  at: number;
  contentType: string;
  extension: string;
}

interface ImageBudget {
  day: string;
  count: number;
}

const IMAGE_DAILY_LIMIT = 1000;

export interface SearchOptions {
  artist?: string;
  album?: string;
  query?: string;
  limit?: number;
}

const DEFAULT_USER_AGENT =
  "DCTagger/0.1 +https://github.com/dctagger/dctagger";

/**
 * Accept tokens pasted as a bare value, `Discogs token=…`, `Bearer …`, or a
 * whole Authorization header. Discogs tokens never contain whitespace.
 */
export function normalizeDiscogsToken(raw: string): string {
  let token = raw
    .replace(/\uFEFF/g, "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  token = token.replace(/^authorization\s*:\s*/i, "").trim();
  token = token.replace(/^discogs\s+token\s*=\s*/i, "").trim();
  token = token.replace(/^bearer\s+/i, "").trim();
  token = token.replace(/^token\s*=\s*/i, "").trim();
  return token.replace(/\s+/g, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cacheKey(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("bmp")) return "bmp";
  return "jpg";
}

/** Authenticated, rate-limited, cached Discogs API client. */
export class DiscogsClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly minIntervalMs: number;
  private readonly cacheDir?: string;
  private readonly cacheTtlMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private imageQueue: Promise<unknown> = Promise.resolve();

  constructor(options: DiscogsClientOptions) {
    this.token = normalizeDiscogsToken(options.token);
    this.baseUrl = (options.baseUrl ?? "https://api.discogs.com").replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.minIntervalMs = options.minIntervalMs ?? 1100;
    this.cacheDir = options.cacheDir;
    this.cacheTtlMs = options.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async searchReleases(options: SearchOptions): Promise<SearchReleaseSummary[]> {
    const limit = Math.max(1, Math.min(25, options.limit ?? 8));
    const fields: Record<string, string> = {
      type: "release",
      per_page: String(Math.min(50, limit * 2)),
    };

    if (options.query?.trim()) {
      fields.q = options.query.trim();
    } else {
      if (options.artist?.trim()) fields.artist = options.artist.trim();
      if (options.album?.trim()) fields.release_title = options.album.trim();
      if (!fields.artist && !fields.release_title) {
        throw new DiscogsError("Album search needs an artist, album, or query");
      }
    }

    let response = await this.request<RawSearchResponse>("/database/search", fields);
    let results = response.results ?? [];

    // Artist + release_title is precise but brittle for odd spellings; retry
    // with a free-text query before giving up.
    if (results.length === 0 && !options.query && options.artist && options.album) {
      response = await this.request<RawSearchResponse>("/database/search", {
        type: "release",
        per_page: fields.per_page ?? "12",
        q: `${options.artist} ${options.album}`,
      });
      results = response.results ?? [];
    }

    return results
      .filter((result) => result.type === "release")
      .slice(0, limit)
      .map(mapSearchResult);
  }

  async getRelease(id: number, fallbackCover?: string): Promise<DiscogsRelease> {
    const raw = await this.request<RawRelease>(`/releases/${id}`, {});
    return mapRelease(raw, fallbackCover);
  }

  async getIdentity(): Promise<{ id: number; username: string; resourceUrl: string }> {
    const raw = await this.request<{ id: number; username: string; resource_url?: string }>(
      "/oauth/identity",
      {},
    );
    return {
      id: raw.id,
      username: raw.username,
      resourceUrl: raw.resource_url ?? "",
    };
  }

  async downloadImage(url: string): Promise<{ data: Buffer; contentType: string; extension: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new DiscogsError("Invalid image URL");
    }
    if (parsed.protocol !== "https:") {
      throw new DiscogsError("Refusing to download a non-HTTPS image");
    }
    const host = parsed.hostname;
    const isDiscogsHost = host === "discogs.com" || host.endsWith(".discogs.com");
    const isDeezerHost =
      host === "dzcdn.net" ||
      host.endsWith(".dzcdn.net") ||
      host === "deezer.com" ||
      host.endsWith(".deezer.com");
    if (!isDiscogsHost && !isDeezerHost) {
      throw new DiscogsError("Refusing to download a non-Discogs/non-Deezer image");
    }

    const key = cacheKey(url);
    const cached = await this.readImageCache(key);
    if (cached) return cached;

    return this.enqueueImage(async () => {
      // Another request may have filled the cache while this one queued.
      const secondLook = await this.readImageCache(key);
      if (secondLook) return secondLook;

      await this.consumeImageBudget();

      const response = await fetch(url, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "image/*",
          ...(isDiscogsHost && this.token
            ? { Authorization: `Discogs token=${this.token}` }
            : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new DiscogsError(
          `Could not download cover art (HTTP ${response.status})`,
          response.status,
        );
      }
      const contentType = response.headers.get("content-type") ?? "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new DiscogsError("Cover art response was not an image");
      }
      const data = Buffer.from(await response.arrayBuffer());
      const extension = extensionFor(contentType);

      const imageDir = this.cacheDir ? path.join(this.cacheDir, "images") : undefined;
      if (imageDir) {
        await mkdir(imageDir, { recursive: true });
        await writeFile(path.join(imageDir, `${key}.${extension}`), data);
        await writeFile(
          path.join(imageDir, `${key}.json`),
          JSON.stringify({ at: Date.now(), contentType, extension } satisfies ImageCacheMeta),
        );
      }

      return { data, contentType, extension };
    });
  }

  private async readImageCache(
    key: string,
  ): Promise<{ data: Buffer; contentType: string; extension: string } | undefined> {
    if (!this.cacheDir) return undefined;
    const imageDir = path.join(this.cacheDir, "images");
    try {
      const meta = JSON.parse(
        await readFile(path.join(imageDir, `${key}.json`), "utf8"),
      ) as ImageCacheMeta;
      if (Date.now() - meta.at >= this.cacheTtlMs) return undefined;
      const data = await readFile(path.join(imageDir, `${key}.${meta.extension}`));
      return { data, contentType: meta.contentType, extension: meta.extension };
    } catch {
      return undefined;
    }
  }

  /**
   * Discogs image assets have a soft cap of 1,000 downloads per day. Cached
   * images are free; only network misses consume the budget.
   */
  private async consumeImageBudget(): Promise<void> {
    if (!this.cacheDir) return;
    const file = path.join(this.cacheDir, "images", "budget.json");
    const today = new Date().toISOString().slice(0, 10);
    let budget: ImageBudget = { day: today, count: 0 };
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as ImageBudget;
      if (raw.day === today) budget = raw;
    } catch {
      // first image today
    }
    if (budget.count >= IMAGE_DAILY_LIMIT) {
      throw new DiscogsError(
        "Daily Discogs image limit reached (1,000/day). Cached art still works; try again tomorrow.",
      );
    }
    budget.count += 1;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(budget));
  }

  private enqueueImage<T>(task: () => Promise<T>): Promise<T> {
    const result = this.imageQueue.then(task, task);
    this.imageQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async request<T>(
    endpoint: string,
    fields: Record<string, string>,
  ): Promise<T> {
    if (!this.token) {
      throw new DiscogsError("A Discogs token is required. Add one in Settings.");
    }

    const params = new URLSearchParams(fields);
    const url = `${this.baseUrl}${endpoint}${params.size > 0 ? `?${params.toString()}` : ""}`;
    // Cache per token: authenticated responses can differ by account, and the
    // identity endpoint must never be served from a previous token's cache.
    const key = cacheKey(`${url}\n${this.token}`);

    const cached = await this.readJsonCache<T>(key);
    if (cached !== undefined) return cached;

    return this.enqueue(async () => {
      const doubleChecked = await this.readJsonCache<T>(key);
      if (doubleChecked !== undefined) return doubleChecked;

      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.throttle();
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": this.userAgent,
              Authorization: `Discogs token=${this.token}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(20_000),
          });

          if (response.status === 429) {
            const retryAfter = Number.parseFloat(
              response.headers.get("retry-after") ?? "2",
            );
            await sleep(Math.max(1, retryAfter) * 1000);
            continue;
          }

          if (!response.ok) {
            const body = (await response.text()).slice(0, 300);
            const hint =
              response.status === 401
                ? " Use the Personal Access Token from Discogs → Settings → Developers (not the Consumer Key or Secret). Paste only the token value, without `Discogs token=`."
                : "";
            throw new DiscogsError(
              `Discogs request failed (HTTP ${response.status})${body ? `: ${body}` : ""}${hint}`,
              response.status,
            );
          }

          const data = (await response.json()) as T;
          await this.writeJsonCache(key, data);
          return data;
        } catch (error) {
          lastError = error;
          if (error instanceof DiscogsError) break;
          if (attempt === 1) break;
          await sleep(1200);
        }
      }

      if (lastError instanceof Error) throw lastError;
      throw new DiscogsError("Discogs request failed");
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

  private async readJsonCache<T>(key: string): Promise<T | undefined> {
    if (!this.cacheDir) return undefined;
    try {
      const raw = JSON.parse(
        await readFile(path.join(this.cacheDir, "api", `${key}.json`), "utf8"),
      ) as JsonCacheEntry;
      if (Date.now() - raw.at > this.cacheTtlMs) return undefined;
      return raw.data as T;
    } catch {
      return undefined;
    }
  }

  private async writeJsonCache(key: string, data: unknown): Promise<void> {
    if (!this.cacheDir) return;
    const dir = path.join(this.cacheDir, "api");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const payload = JSON.stringify({ at: Date.now(), data } satisfies JsonCacheEntry);
    await writeFile(tmp, payload);
    await rename(tmp, file).catch(async () => {
      await writeFile(file, payload);
    });
  }
}
