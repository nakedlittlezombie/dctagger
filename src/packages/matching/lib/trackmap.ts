import type { LocalTrack, ReleaseTrack, TrackAssignment } from "../../model/types";
import { trackSimilarity } from "./similarity";

interface Pair {
  local: number;
  remote: number;
  score: number;
}

function durationSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return undefined;
}

function scorePair(local: LocalTrack, remote: ReleaseTrack): number {
  const title = local.title ?? local.fileName;
  let score = trackSimilarity(title, remote.title);
  if (local.track !== undefined && local.track === remote.trackNumber) {
    score += 0.18;
  }
  const remoteDuration = durationSeconds(remote.duration);
  if (local.duration !== undefined && remoteDuration !== undefined) {
    const difference = Math.abs(local.duration - remoteDuration);
    if (difference <= 2) score += 0.04;
    else if (difference > 30) score -= 0.1;
  }
  return Math.max(0, Math.min(1, score));
}

/**
 * Assign local files to release tracks one-to-one, best pairs first. Equal
 * track counts always produce a complete mapping; with different counts only
 * credible pairs are mapped and the rest stay unassigned.
 */
export function autoMap(
  localTracks: LocalTrack[],
  remoteTracks: ReleaseTrack[],
): TrackAssignment[] {
  if (remoteTracks.length === 0) {
    return localTracks.map((track) => ({
      filePath: track.path,
      trackIndex: null,
    }));
  }

  const pairs: Pair[] = [];
  for (let local = 0; local < localTracks.length; local += 1) {
    const track = localTracks[local];
    if (!track) continue;
    for (const remote of remoteTracks) {
      pairs.push({
        local,
        remote: remote.index,
        score: scorePair(track, remote),
      });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const usedLocal = new Set<number>();
  const usedRemote = new Set<number>();
  const assignments = new Map<number, TrackAssignment>();
  const completeMapping = localTracks.length <= remoteTracks.length;

  for (const pair of pairs) {
    if (usedLocal.has(pair.local) || usedRemote.has(pair.remote)) continue;
    if (!completeMapping && pair.score < 0.3) continue;
    usedLocal.add(pair.local);
    usedRemote.add(pair.remote);
    assignments.set(pair.local, {
      filePath: localTracks[pair.local]?.path ?? "",
      trackIndex: pair.remote,
      confidence: Math.round(pair.score * 1000) / 1000,
    });
  }

  return localTracks.map((track, index) => {
    return (
      assignments.get(index) ?? {
        filePath: track.path,
        trackIndex: null,
      }
    );
  });
}

/** Files not mapped to a track (bonus tracks, rips with fewer files, …). */
export function unmappedFiles(mapping: TrackAssignment[]): string[] {
  return mapping.filter((entry) => entry.trackIndex === null).map((entry) => entry.filePath);
}
