import { describe, expect, it } from "vitest";

import { applyDedupeIgnores } from "../dedupe";
import type { DuplicateGroup, DuplicateMember } from "../types";

function member(fileName: string, qualityScore: number): DuplicateMember {
  return {
    path: `/music/album/${fileName}`,
    fileName,
    format: fileName.split(".").pop()?.toUpperCase() ?? "FLAC",
    qualityScore,
    qualityLabel: qualityScore > 100 ? "FLAC 16-bit" : "MP3 320 kbps",
    size: qualityScore * 100,
  };
}

function group(key: string, members: DuplicateMember[], keep = members[0]): DuplicateGroup {
  const kept = keep ?? members[0];
  const first = members[0];
  return {
    key,
    keep: kept?.path ?? "",
    members,
    reason: first ? `Keeping ${first.qualityLabel}` : "",
  };
}

describe("applyDedupeIgnores", () => {
  const flac = member("01 - Angel.flac", 500);
  const mp3 = member("01 - Angel.mp3", 100);

  it("returns the original groups when nothing is ignored", () => {
    const groups = [group("track-1", [flac, mp3])];
    expect(applyDedupeIgnores(groups, undefined)).toBe(groups);
    expect(applyDedupeIgnores(groups, [])).toBe(groups);
  });

  it("dissolves a two-file group when one copy is kept as its own track", () => {
    const groups = [group("track-1", [flac, mp3])];
    expect(applyDedupeIgnores(groups, [mp3.path])).toEqual([]);
    expect(applyDedupeIgnores(groups, [flac.path])).toEqual([]);
  });

  it("keeps the remaining copies grouped and picks a new keeper when needed", () => {
    const lower = member("01 - Angel.mp3", 100);
    const groups = [
      group("track-1", [flac, lower, member("01 - Angel 128.mp3", 50)], flac),
    ];
    const result = applyDedupeIgnores(groups, [flac.path]);
    expect(result).toHaveLength(1);
    expect(result[0]?.keep).toBe(lower.path);
    expect(result[0]?.members.map((entry) => entry.fileName)).toEqual([
      "01 - Angel.mp3",
      "01 - Angel 128.mp3",
    ]);
    expect(result[0]?.reason).toContain("Keeping MP3 320 kbps");
  });

  it("ignores paths that are not in any group", () => {
    const groups = [group("track-1", [flac, mp3])];
    const result = applyDedupeIgnores(groups, ["/music/album/02 - Risingson.flac"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.keep).toBe(flac.path);
  });
});
