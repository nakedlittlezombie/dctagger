import type { AlbumFolder, AlbumStatus } from "../packages/model/types";
import { missingTrackCount } from "./album-stats";

/**
 * Shared view options for the album queue. The library list and the match
 * queue read the same options so the order you pick in one carries into the
 * other, and the review position stays meaningful when you navigate back.
 */
export type QueueFilter = "all" | "review" | "auto" | "confirmed" | "applied" | "skipped";

export type QueueSort = "scan" | "tracks-desc" | "tracks-asc";

export interface QueueOptions {
  filter: QueueFilter;
  sort: QueueSort;
  hideMissing: boolean;
  query: string;
}

export const QUEUE_FILTERS: ReadonlyArray<{ id: QueueFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "auto", label: "Auto-matched" },
  { id: "confirmed", label: "Confirmed" },
  { id: "applied", label: "Applied" },
  { id: "skipped", label: "Skipped" },
];

export const QUEUE_SORTS: ReadonlyArray<{ id: QueueSort; label: string }> = [
  { id: "scan", label: "Scan order" },
  { id: "tracks-desc", label: "Tracks: most first" },
  { id: "tracks-asc", label: "Tracks: fewest first" },
];

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  filter: "all",
  sort: "scan",
  hideMissing: false,
  query: "",
};

const STORAGE_KEY = "dctagger.album-queue.v1";

/** Albums the match queue is meant to resolve. */
export function isReviewStatus(status: AlbumStatus): boolean {
  return status === "needs-review" || status === "error";
}

export function isReviewAlbum(album: AlbumFolder): boolean {
  return isReviewStatus(album.status);
}

export function matchesQueueFilter(album: AlbumFolder, filter: QueueFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "review":
      return isReviewAlbum(album);
    case "auto":
      return album.status === "auto-matched";
    case "confirmed":
      return album.status === "confirmed";
    case "applied":
      return album.status === "applied";
    case "skipped":
      return album.status === "skipped";
  }
}

export function queueCounts(albums: AlbumFolder[]): Record<QueueFilter, number> {
  return {
    all: albums.length,
    review: albums.filter(isReviewAlbum).length,
    auto: albums.filter((album) => album.status === "auto-matched").length,
    confirmed: albums.filter((album) => album.status === "confirmed").length,
    applied: albums.filter((album) => album.status === "applied").length,
    skipped: albums.filter((album) => album.status === "skipped").length,
  };
}

function matchesQuery(album: AlbumFolder, needle: string): boolean {
  if (!needle) return true;
  return [
    album.folderName,
    album.hints.artist,
    album.hints.album,
    album.path,
    ...(album.sourceFolders ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

/**
 * The albums a queue step can land on, in the order the user asked for.
 * Status filter, then missing-track filter, then search, then sort.
 */
export function applyQueueOptions(
  albums: AlbumFolder[],
  options: QueueOptions,
): AlbumFolder[] {
  const needle = options.query.trim().toLowerCase();
  const rows = albums
    .filter((album) => matchesQueueFilter(album, options.filter))
    .filter((album) => !options.hideMissing || missingTrackCount(album) === 0)
    .filter((album) => matchesQuery(album, needle));
  if (options.sort === "scan") return rows;
  const direction = options.sort === "tracks-desc" ? -1 : 1;
  return [...rows].sort((a, b) => direction * (a.tracks.length - b.tracks.length));
}

export function queueIndex(queue: AlbumFolder[], albumId: string | null): number {
  if (!albumId) return -1;
  return queue.findIndex((album) => album.id === albumId);
}

/** Next step in the queue, falling back to the previous one at the end. */
export function neighborInQueue(
  queue: AlbumFolder[],
  albumId: string | null,
): AlbumFolder | undefined {
  const index = queueIndex(queue, albumId);
  if (index === -1) return undefined;
  return queue[index + 1] ?? queue[index - 1];
}

function isQueueFilter(value: unknown): value is QueueFilter {
  return QUEUE_FILTERS.some((entry) => entry.id === value);
}

function isQueueSort(value: unknown): value is QueueSort {
  return QUEUE_SORTS.some((entry) => entry.id === value);
}

/** Read the last used queue options so a reload keeps the same view. */
export function loadQueueOptions(): QueueOptions {
  if (typeof window === "undefined") return { ...DEFAULT_QUEUE_OPTIONS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_QUEUE_OPTIONS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_QUEUE_OPTIONS };
    const record = parsed as Record<string, unknown>;
    return {
      filter: isQueueFilter(record.filter) ? record.filter : DEFAULT_QUEUE_OPTIONS.filter,
      sort: isQueueSort(record.sort) ? record.sort : DEFAULT_QUEUE_OPTIONS.sort,
      hideMissing:
        typeof record.hideMissing === "boolean"
          ? record.hideMissing
          : DEFAULT_QUEUE_OPTIONS.hideMissing,
      query: typeof record.query === "string" ? record.query : DEFAULT_QUEUE_OPTIONS.query,
    };
  } catch {
    return { ...DEFAULT_QUEUE_OPTIONS };
  }
}

export function saveQueueOptions(options: QueueOptions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Storage can be unavailable (private mode, quota); the session still works.
  }
}
