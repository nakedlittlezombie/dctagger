import { describe, expect, it } from "vitest";

import type { LocalTrack, ReleaseTrack } from "../../model/types";
import { autoMap } from "../index";

function local(fileName: string, title?: string, track?: number): LocalTrack {
  return {
    path: `/music/album/${fileName}`,
    fileName,
    size: 1000,
    format: "flac",
    title,
    track,
    hasArt: false,
  };
}

function remote(index: number, title: string): ReleaseTrack {
  return {
    index,
    position: String(index + 1),
    title,
    artists: [],
    disc: 1,
    trackNumber: index + 1,
  };
}

describe("autoMap", () => {
  it("maps files to tracks in the correct order", () => {
    const files = [
      local("01 - Teardrop.flac", "Teardrop", 3),
      local("02 - Angel.flac", "Angel", 1),
      local("03 - Risingson.flac", "Risingson", 2),
    ];
    const tracks = [remote(0, "Angel"), remote(1, "Risingson"), remote(2, "Teardrop")];
    const mapping = autoMap(files, tracks);

    expect(mapping.map((entry) => entry.trackIndex)).toEqual([2, 0, 1]);
    expect(mapping.every((entry) => entry.confidence && entry.confidence > 0.5)).toBe(true);
  });

  it("leaves extra local files unassigned", () => {
    const files = [local("01.flac", "Angel", 1), local("99 - Bonus.flac", "Studio Outtake")];
    const tracks = [remote(0, "Angel")];
    const mapping = autoMap(files, tracks);

    expect(mapping[0]?.trackIndex).toBe(0);
    expect(mapping[1]?.trackIndex).toBeNull();
  });

  it("returns null assignments when there are no tracks", () => {
    expect(autoMap([local("a.flac")], [])[0]?.trackIndex).toBeNull();
  });
});
