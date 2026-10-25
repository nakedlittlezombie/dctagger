import type {
  DiscogsRelease,
  ReleaseTrack,
  ScoreBreakdown,
} from "../../model/types";
import {
  albumSimilarity,
  artistSimilarity,
  trackSimilarity,
} from "./similarity";

export interface LocalMatchTrack {
  title?: string;
  fileName: string;
  track?: number;
  duration?: number;
}

export interface LocalMatchInput {
  artist?: string;
  album?: string;
  year?: number;
  tracks: LocalMatchTrack[];
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreBreakdown;
}

export interface ConfidenceOptions {
  threshold: number;
  margin: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(clamp(value) * 10000) / 10000;
}

function trackCountScore(localCount: number, remoteCount: number): number {
  if (remoteCount === 0) return 0;
  const difference = Math.abs(localCount - remoteCount);
  if (difference === 0) return 1;
  if (difference === 1) return 0.6;
  if (difference === 2) return 0.3;
  if (difference <= 4 && localCount > remoteCount) return 0.1;
  return 0;
}

function yearScore(localYear: number | undefined, remoteYear: number | undefined): number {
  if (!localYear || !remoteYear) return 0.5;
  const difference = Math.abs(localYear - remoteYear);
  if (difference === 0) return 1;
  if (difference === 1) return 0.7;
  if (difference <= 2) return 0.4;
  return 0;
}

/**
 * Average of the best title pair for every local track. Uses a greedy
 * one-to-one assignment so repeated titles ("Intro") do not inflate the score.
 */
function trackTitlesScore(
  localTracks: LocalMatchTrack[],
  remoteTracks: ReleaseTrack[],
): number {
  if (localTracks.length === 0 || remoteTracks.length === 0) return 0;
  const pairs: Array<{ local: number; remote: number; score: number }> = [];

  for (let i = 0; i < localTracks.length; i += 1) {
    const local = localTracks[i];
    if (!local) continue;
    for (const remote of remoteTracks) {
      const title = local.title ?? local.fileName;
      let score = trackSimilarity(title, remote.title);
      if (local.track !== undefined && local.track === remote.trackNumber) {
        score = Math.min(1, score + 0.12);
      }
      pairs.push({ local: i, remote: remote.index, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedLocal = new Set<number>();
  const usedRemote = new Set<number>();
  const scores: number[] = [];

  for (const pair of pairs) {
    if (usedLocal.has(pair.local) || usedRemote.has(pair.remote)) continue;
    usedLocal.add(pair.local);
    usedRemote.add(pair.remote);
    scores.push(pair.score);
    if (scores.length === localTracks.length) break;
  }

  const total = scores.reduce((sum, score) => sum + score, 0);
  return total / Math.max(1, localTracks.length);
}

export function scoreRelease(
  local: LocalMatchInput,
  release: DiscogsRelease,
): ScoreResult {
  const remoteArtists = release.artists.map((artist) => artist.name);
  const artist = local.artist
    ? Math.max(...remoteArtists.map((name) => artistSimilarity(local.artist, name)), 0)
    : 0.5;
  const album = local.album
    ? albumSimilarity(local.album, release.title)
    : 0.5;
  const tracks = trackTitlesScore(local.tracks, release.tracklist);
  const count = trackCountScore(local.tracks.length, release.tracklist.length);
  const year = yearScore(local.year, release.year);

  // Weights are renormalized when the folder has no artist/album hints so a
  // missing tag never punishes an otherwise obvious match.
  const parts: Array<{ value: number; weight: number }> = [
    { value: album, weight: local.album ? 0.35 : 0.2 },
    { value: artist, weight: local.artist ? 0.2 : 0.1 },
    { value: tracks, weight: 0.2 },
    { value: count, weight: 0.15 },
    { value: year, weight: 0.1 },
  ];
  const weightTotal = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / weightTotal;

  return {
    score: round(score),
    breakdown: {
      album: round(album),
      artist: round(artist),
      trackCount: round(count),
      trackTitles: round(tracks),
      year: round(year),
    },
  };
}

export function rankReleases(
  local: LocalMatchInput,
  releases: DiscogsRelease[],
): Array<{ release: DiscogsRelease; score: number; breakdown: ScoreBreakdown }> {
  return releases
    .map((release) => ({ release, ...scoreRelease(local, release) }))
    .sort((a, b) => b.score - a.score);
}

export function isHighConfidence(
  top: ScoreResult,
  runnerUp: ScoreResult | undefined,
  options: ConfidenceOptions & { hasArtist: boolean; hasAlbum: boolean },
): boolean {
  if (top.score < options.threshold) return false;
  if (runnerUp && top.score - runnerUp.score < options.margin) return false;
  if (top.breakdown.trackCount < 0.99) return false;
  if (options.hasAlbum && top.breakdown.album < 0.62) return false;
  if (options.hasArtist && top.breakdown.artist < 0.5) return false;
  return true;
}
