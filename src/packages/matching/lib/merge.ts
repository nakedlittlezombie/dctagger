import type { AlbumFolder, LocalTrack } from "../../model/types";
import {
  artistSimilarity,
  normalizeAlbum,
  normalizeTrackTitle,
  similarity,
  trackSimilarity,
} from "./similarity";

/**
 * Disc markers that partition ONE release: "CD1", "Disc 2", "DVD 1". They are
 * removed before album names are compared, so the folders of a multi-disc set
 * still look like the same album.
 *
 * Volume/part markers ("Vol. 1", "Part 2") are deliberately NOT removed: those
 * usually name separate albums in a series, and merging a series is wrong.
 */
const DISC_MARKER = /\b(?:cd|disc|disk|dvd)\s*-?\s*\d{1,2}\b/gi;

const MERGE_SCORE_THRESHOLD = 0.85;
const ALBUM_SCORE_THRESHOLD = 0.85;
const ARTIST_SCORE_THRESHOLD = 0.8;

const titleKeyCache = new WeakMap<LocalTrack[], string[]>();
const albumKeyCache = new Map<string, string>();

/** Album name without disc qualifiers, normalised for comparison. */
export function mergeAlbumKey(input: string | undefined): string {
  if (!input) return "";
  const cached = albumKeyCache.get(input);
  if (cached !== undefined) return cached;
  const key = normalizeAlbum(input)
    .replace(DISC_MARKER, " ")
    .replace(/\s+/g, " ")
    .trim();
  albumKeyCache.set(input, key);
  return key;
}

/**
 * Album names that differ only by a number are consecutive entries in a
 * series ("Now 20" / "Now 21", "Vol. 1" / "Vol. 2"), not one release split
 * across folders. Disc markers are stripped before this check, so
 * "Disc 1" / "Disc 2" is still the same album.
 */
function isAlbumSequence(a: string, b: string): boolean {
  if (a === b) return false;
  const withoutNumbers = (value: string) =>
    value.replace(/\b\d{1,3}\b/g, " ").replace(/\s+/g, " ").trim();
  return withoutNumbers(a) === withoutNumbers(b);
}

export interface MergeComparison {
  /** Overall confidence in [0, 1]. */
  score: number;
  artistScore: number;
  albumScore: number;
  /** Fraction of the smaller album's tracks also present in the other. */
  trackOverlap: number;
  reason: string;
}

function titleKeys(tracks: LocalTrack[]): string[] {
  const cached = titleKeyCache.get(tracks);
  if (cached) return cached;
  const keys = tracks
    .map((track) => normalizeTrackTitle(track.title || track.fileName))
    .filter((title) => title.length > 0);
  titleKeyCache.set(tracks, keys);
  return keys;
}

/** Fraction of the smaller album's track titles that appear in the other. */
function sharedTitleFraction(a: LocalTrack[], b: LocalTrack[]): number {
  const left = titleKeys(a);
  const right = titleKeys(b);
  if (left.length === 0 || right.length === 0) return 0;
  const [smaller, larger] = left.length <= right.length ? [left, right] : [right, left];
  let shared = 0;
  for (const title of smaller) {
    if (larger.some((other) => other === title || trackSimilarity(other, title) >= 0.9)) {
      shared += 1;
    }
  }
  return shared / smaller.length;
}

function reasonFor(
  a: AlbumFolder,
  b: AlbumFolder,
  trackOverlap: number,
): string {
  const percent = Math.round(trackOverlap * 100);
  if (trackOverlap >= 0.6) {
    return `Both folders hold ${percent}% of the same tracks`;
  }
  if (trackOverlap <= 0.2) {
    return `Complementary tracklists (${a.tracks.length} + ${b.tracks.length} files)`;
  }
  return `Similar albums (${percent}% shared tracks)`;
}

/**
 * Compare two scanned albums for evidence that they are the same release found
 * in different folders. Returns null when the hints clearly disagree, when the
 * names are entries in a numbered series, or when either album is applied.
 */
export function compareAlbumsForMerge(
  a: AlbumFolder,
  b: AlbumFolder,
): MergeComparison | null {
  if (a.id === b.id) return null;
  if (a.tracks.length === 0 || b.tracks.length === 0) return null;
  if (a.status === "applied" || b.status === "applied") return null;
  if (a.hints.year && b.hints.year && Math.abs(a.hints.year - b.hints.year) > 1) {
    return null;
  }

  const bothArtists = Boolean(a.hints.artist && b.hints.artist);
  const artistScore = bothArtists
    ? artistSimilarity(a.hints.artist, b.hints.artist)
    : 0.6;
  if (bothArtists && artistScore < ARTIST_SCORE_THRESHOLD) return null;

  const keyA = mergeAlbumKey(a.hints.album ?? a.folderName);
  const keyB = mergeAlbumKey(b.hints.album ?? b.folderName);
  if (!keyA || !keyB) return null;
  if (isAlbumSequence(keyA, keyB)) return null;

  const albumScore = similarity(keyA, keyB);
  if (albumScore < ALBUM_SCORE_THRESHOLD) return null;

  const trackOverlap = sharedTitleFraction(a.tracks, b.tracks);
  const score = Math.min(1, 0.7 * albumScore + 0.3 * artistScore);
  if (score < MERGE_SCORE_THRESHOLD) return null;

  return {
    score,
    artistScore,
    albumScore,
    trackOverlap,
    reason: reasonFor(a, b, trackOverlap),
  };
}

/**
 * True when every pair in the set looks like the same release. Merging is for
 * copies or disc splits of one album only, never a sequence of albums.
 */
export function canMergeAlbums(albums: AlbumFolder[]): boolean {
  if (albums.length < 2) return false;
  for (let i = 0; i < albums.length; i += 1) {
    for (let j = i + 1; j < albums.length; j += 1) {
      const left = albums[i];
      const right = albums[j];
      if (!left || !right) return false;
      if (!compareAlbumsForMerge(left, right)) return false;
    }
  }
  return true;
}
