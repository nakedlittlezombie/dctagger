import path from "node:path";

import {
  canMergeAlbums,
  compareAlbumsForMerge,
  mergeAlbumKey,
  type MergeComparison,
} from "../../matching";
import type {
  AlbumFolder,
  AlbumHints,
  LocalImage,
  LocalTrack,
  MatchCandidate,
  MergeSuggestion,
} from "../../model/types";
import { detectDuplicates } from "./dedupe";
import { naturalCompare } from "./files";

export { compareAlbumsForMerge, mergeAlbumKey } from "../../matching";
export type { MergeComparison } from "../../matching";

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    let current = value;
    while (this.parent[current] !== current) {
      const parent = this.parent[current] ?? current;
      this.parent[current] = this.parent[parent] ?? parent;
      current = parent;
    }
    return current;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

/**
 * Album-name tokens this common are not distinctive enough to propose pairs
 * ("greatest", "hits", "live"). Exact-name buckets already cover their splits.
 */
const MAX_TOKEN_POSTING = 25;

function appendTo<T>(map: Map<T, number[]>, key: T, value: number): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

/**
 * Pairs worth running the full comparison on. Comparing every album with every
 * other album is O(n²) and takes tens of seconds for a large library; matching
 * on the normalised album name (exact, or sharing a distinctive token) keeps
 * that to the albums that could plausibly be the same release. Anything the
 * index misses is still available through the manual merge picker.
 */
function candidatePairs(eligible: AlbumFolder[]): Array<[number, number]> {
  const size = eligible.length;
  const seen = new Set<number>();
  const pairs: Array<[number, number]> = [];
  const addPair = (a: number, b: number): void => {
    if (a === b) return;
    const left = Math.min(a, b);
    const right = Math.max(a, b);
    const key = left * size + right;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push([left, right]);
  };
  const addAll = (members: number[]): void => {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = members[i];
        const right = members[j];
        if (left !== undefined && right !== undefined) addPair(left, right);
      }
    }
  };

  const exactBuckets = new Map<string, number[]>();
  const tokenBuckets = new Map<string, number[]>();
  for (let index = 0; index < size; index += 1) {
    const album = eligible[index];
    if (!album) continue;
    const key = mergeAlbumKey(album.hints.album ?? album.folderName);
    if (!key) continue;
    appendTo(exactBuckets, key, index);
    for (const token of new Set(key.split(" "))) {
      if (token.length < 2) continue;
      appendTo(tokenBuckets, token, index);
    }
  }

  for (const members of exactBuckets.values()) addAll(members);
  for (const members of tokenBuckets.values()) {
    if (members.length < 2 || members.length > MAX_TOKEN_POSTING) continue;
    addAll(members);
  }
  return pairs;
}

/**
 * Find groups of albums that look like one release spread over several
 * folders. Groups can hold more than two folders (3-disc box sets) and are
 * returned strongest first.
 */
export function findMergeGroups(albums: AlbumFolder[]): MergeSuggestion[] {
  const eligible = albums.filter(
    (album) => album.tracks.length > 0 && album.status !== "applied",
  );
  const union = new UnionFind(eligible.length);
  const pairs: Array<{ a: number; b: number; comparison: MergeComparison }> = [];

  for (const [i, j] of candidatePairs(eligible)) {
    const left = eligible[i];
    const right = eligible[j];
    if (!left || !right) continue;
    const comparison = compareAlbumsForMerge(left, right);
    if (!comparison) continue;
    union.union(i, j);
    pairs.push({ a: i, b: j, comparison });
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < eligible.length; index += 1) {
    const root = union.find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  }

  const suggestions: MergeSuggestion[] = [];
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const members = indices
      .map((index) => eligible[index])
      .filter((album): album is AlbumFolder => Boolean(album));
    if (members.length < 2) continue;

    const membersOfGroup = new Set(indices);
    const groupPairs = pairs.filter(
      (pair) => membersOfGroup.has(pair.a) && membersOfGroup.has(pair.b),
    );
    const score = Math.min(...groupPairs.map((pair) => pair.comparison.score));
    const overlap =
      groupPairs.reduce((sum, pair) => sum + pair.comparison.trackOverlap, 0) /
      Math.max(1, groupPairs.length);

    const reason =
      members.length === 2 && groupPairs[0]
        ? groupPairs[0].comparison.reason
        : overlap >= 0.6
          ? `${members.length} copies of the same release`
          : `One release split across ${members.length} folders`;

    suggestions.push({
      albumIds: members.map((album) => album.id),
      score,
      reason,
    });
  }

  return suggestions.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const firstA = albums.findIndex((album) => album.id === a.albumIds[0]);
    const firstB = albums.findIndex((album) => album.id === b.albumIds[0]);
    return firstA - firstB;
  });
}

function sourcesOf(album: AlbumFolder): string[] {
  return album.sourceFolders?.length ? album.sourceFolders : [album.path];
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of paths) {
    const key = path.resolve(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function dedupeImages(images: LocalImage[]): LocalImage[] {
  const seen = new Set<string>();
  const result: LocalImage[] = [];
  for (const image of images) {
    if (seen.has(image.path)) continue;
    seen.add(image.path);
    result.push(image);
  }
  return result;
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Set<number>();
  const result: MatchCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.release.id)) continue;
    seen.add(candidate.release.id);
    result.push(candidate);
  }
  return result;
}

function dedupeGenres(values: Array<string | undefined>): string[] | undefined {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.length > 0 ? result : undefined;
}

function mergedHints(albums: AlbumFolder[]): AlbumHints {
  const firstValue = <T>(pick: (album: AlbumFolder) => T | undefined): T | undefined => {
    for (const album of albums) {
      const value = pick(album);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const genres = dedupeGenres(albums.flatMap((album) => album.hints.genres ?? []));
  const sources = new Set(albums.map((album) => album.hints.source));
  return {
    artist: firstValue((album) => album.hints.artist),
    album: firstValue((album) => album.hints.album),
    year: firstValue((album) => album.hints.year),
    ...(genres ? { genres } : {}),
    source: sources.size === 1 ? ([...sources][0] ?? "mixed") : "mixed",
  };
}

function trackOrder(a: LocalTrack, b: LocalTrack): number {
  const discA = a.disc ?? 1;
  const discB = b.disc ?? 1;
  if (discA !== discB) return discA - discB;
  const trackA = a.track ?? 9999;
  const trackB = b.track ?? 9999;
  if (trackA !== trackB) return trackA - trackB;
  return naturalCompare(a.fileName, b.fileName);
}

/**
 * Fold several scanned albums into one. The first album supplies the identity
 * (id, path, folder name); tracks, folders, artwork, candidates, and hints are
 * combined. Duplicates are detected across the whole merged tracklist, and the
 * result is sent back to review because its match must cover every folder.
 */
export function mergeAlbums(albums: AlbumFolder[]): AlbumFolder {
  const target = albums[0];
  if (!target || albums.length < 2) {
    throw new Error("Merging needs at least two albums");
  }
  if (!canMergeAlbums(albums)) {
    throw new Error(
      "Only folders that hold the same album can be merged; a sequence of different albums is not a merge",
    );
  }

  const tracks = albums.flatMap((album) => album.tracks).sort(trackOrder);
  const images = dedupeImages(albums.flatMap((album) => album.images));
  const candidates = dedupeCandidates(albums.flatMap((album) => album.candidates));
  const deezerCandidates = dedupeCandidates(
    albums.flatMap((album) => album.deezerCandidates),
  );
  const selectedReleaseId =
    albums
      .map((album) => album.selectedReleaseId)
      .find((id): id is number => id !== undefined) ??
    candidates[0]?.release.id ??
    deezerCandidates[0]?.release.id;
  const coverOverride =
    target.coverOverride && images.some((image) => image.path === target.coverOverride)
      ? target.coverOverride
      : undefined;

  const matchingDeezer = albums
    .map((album) => album.deezer)
    .find((entry) => entry && entry.releaseId === selectedReleaseId);
  const matchingMusicBrainz = albums
    .map((album) => album.musicbrainz)
    .find((entry) => entry && entry.releaseId === selectedReleaseId);

  return {
    ...target,
    tracks,
    images,
    hints: mergedHints(albums),
    sourceFolders: dedupePaths(albums.flatMap(sourcesOf)),
    candidates,
    deezerCandidates,
    deezerCandidatesLoaded: albums.some((album) => album.deezerCandidatesLoaded),
    selectedReleaseId,
    mapping: tracks.map((track) => ({ filePath: track.path, trackIndex: null })),
    duplicates: detectDuplicates(tracks),
    ...(matchingDeezer ? { deezer: matchingDeezer } : { deezer: undefined }),
    ...(matchingMusicBrainz
      ? { musicbrainz: matchingMusicBrainz }
      : { musicbrainz: undefined }),
    ...(coverOverride ? { coverOverride } : { coverOverride: undefined }),
    status: tracks.length > 0 ? "needs-review" : "error",
    autoMatched: false,
    applied: undefined,
    error: tracks.length > 0 ? undefined : "No audio files found",
    updatedAt: new Date().toISOString(),
  };
}
