import path from "node:path";

import { normalizeTrackTitle, trackSimilarity } from "../../matching";
import type { DuplicateGroup, DuplicateMember, LocalTrack } from "../../model/types";
import { trackTitleFromFileName } from "./files";

const LOSSLESS_EXTENSIONS = new Set([
  ".flac",
  ".wav",
  ".aiff",
  ".aif",
  ".ape",
  ".wv",
  ".alac",
]);

export interface QualityInfo {
  score: number;
  label: string;
}

/**
 * Rank audio quality. Lossless beats lossy; within a family, bit depth, sample
 * rate and bitrate decide.
 */
export function qualityOf(track: LocalTrack): QualityInfo {
  const extension = path.extname(track.fileName).toLowerCase();
  const lossless =
    track.lossless === true || LOSSLESS_EXTENSIONS.has(extension);
  const bits = track.bitsPerSample ?? (lossless ? 16 : 0);
  const sampleRate = track.sampleRate ?? 44_100;
  const bitrate = track.bitrate ?? 0;
  const score =
    (lossless ? 1e12 : 0) +
    bits * 1e8 +
    sampleRate * 1000 +
    bitrate / 1000 +
    track.size / 1e6;

  const format = extension.replace(/^\./, "").toUpperCase() || "AUDIO";
  let label: string;
  if (lossless) {
    const rate = sampleRate >= 1000 ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz` : "";
    label = `${format} ${bits || 16}-bit${rate ? ` / ${rate}` : ""}`;
  } else if (bitrate > 0) {
    label = `${format} ${Math.round(bitrate / 1000)} kbps`;
  } else {
    label = `${format} ${(track.size / 1_048_576).toFixed(1)} MB`;
  }
  return { score, label };
}

function identityTitle(track: LocalTrack): string {
  return normalizeTrackTitle(track.title || trackTitleFromFileName(track.fileName));
}

function durationCompatible(a: LocalTrack, b: LocalTrack): boolean {
  if (a.duration === undefined || b.duration === undefined) return true;
  const difference = Math.abs(a.duration - b.duration);
  const tolerance = Math.max(4, Math.min(a.duration, b.duration) * 0.03);
  return difference <= tolerance;
}

function looksDuplicate(a: LocalTrack, b: LocalTrack): boolean {
  if (!durationCompatible(a, b)) return false;
  const titleA = identityTitle(a);
  const titleB = identityTitle(b);
  const sameNumber =
    a.track !== undefined && b.track !== undefined && a.track === b.track;
  const titleScore = titleA && titleB ? trackSimilarity(titleA, titleB) : 0;

  if (sameNumber) {
    // Same track number is strong evidence, but only when titles agree or the
    // durations line up closely.
    if (!titleA || !titleB) return true;
    if (titleScore >= 0.5) return true;
    if (
      a.duration !== undefined &&
      b.duration !== undefined &&
      Math.abs(a.duration - b.duration) <= 3
    ) {
      return true;
    }
    return false;
  }

  if (titleA && titleB && titleA === titleB) return true;
  if (titleScore >= 0.92) return true;
  return false;
}

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

function memberOf(track: LocalTrack): DuplicateMember {
  const quality = qualityOf(track);
  return {
    path: track.path,
    fileName: track.fileName,
    format: path.extname(track.fileName).replace(/^\./, "").toUpperCase(),
    qualityScore: Math.round(quality.score),
    qualityLabel: quality.label,
    size: track.size,
  };
}

/**
 * Find groups of files in one folder that represent the same track and choose
 * the highest-quality copy of each. Detection is intentionally conservative:
 * mismatched durations or clearly different titles never group.
 */
export function detectDuplicates(tracks: LocalTrack[]): DuplicateGroup[] {
  const union = new UnionFind(tracks.length);
  for (let i = 0; i < tracks.length; i += 1) {
    for (let j = i + 1; j < tracks.length; j += 1) {
      const a = tracks[i];
      const b = tracks[j];
      if (a && b && looksDuplicate(a, b)) union.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < tracks.length; index += 1) {
    const root = union.find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  }

  const result: DuplicateGroup[] = [];
  const usedKeys = new Set<string>();
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    const members = indices
      .map((index) => tracks[index])
      .filter((track): track is LocalTrack => Boolean(track))
      .map(memberOf);
    if (members.length < 2) continue;

    members.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
      return b.size - a.size;
    });

    const keep = members[0];
    if (!keep) continue;
    const runnerUp = members[1];
    const first = tracks[indices[0] ?? 0];
    const baseKey = first?.track !== undefined
      ? `track-${first.track}`
      : normalizeTrackTitle(first?.title || first?.fileName || "duplicate").replace(/\s+/g, "-") || "duplicate";
    let key = baseKey;
    let suffix = 1;
    while (usedKeys.has(key)) {
      suffix += 1;
      key = `${baseKey}-${suffix}`;
    }
    usedKeys.add(key);

    result.push({
      key,
      keep: keep.path,
      members,
      reason: runnerUp
        ? `Keeping ${keep.qualityLabel} instead of ${runnerUp.qualityLabel}`
        : `Keeping ${keep.qualityLabel}`,
    });
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

/** Tracks minus the losing copies. Used for matching and for "hide"/"delete". */
export function uniqueTracks(
  tracks: LocalTrack[],
  groups: DuplicateGroup[],
): LocalTrack[] {
  const losers = new Set<string>();
  for (const group of groups) {
    for (const member of group.members) {
      if (member.path !== group.keep) losers.add(member.path);
    }
  }
  return tracks.filter((track) => !losers.has(track.path));
}

export function duplicatePaths(groups: DuplicateGroup[]): Set<string> {
  const losers = new Set<string>();
  for (const group of groups) {
    for (const member of group.members) {
      if (member.path !== group.keep) losers.add(member.path);
    }
  }
  return losers;
}

/** Apply a manual keeper choice for one group. */
export function chooseKeeper(
  groups: DuplicateGroup[],
  key: string,
  keepPath: string,
): DuplicateGroup[] {
  return groups.map((group) => {
    if (group.key !== key) return group;
    if (!group.members.some((member) => member.path === keepPath)) return group;
    const members = [...group.members].sort((a, b) => {
      if (a.path === keepPath) return -1;
      if (b.path === keepPath) return 1;
      return b.qualityScore - a.qualityScore;
    });
    const keep = members[0];
    const runnerUp = members[1];
    return {
      ...group,
      keep: keepPath,
      members,
      reason: keep && runnerUp
        ? `Keeping ${keep.qualityLabel} instead of ${runnerUp.qualityLabel}`
        : group.reason,
    };
  });
}
