import { describe, expect, it } from "vitest";

import type { LocalTrack } from "../../model/types";
import {
  chooseKeeper,
  detectDuplicates,
  qualityOf,
  uniqueTracks,
} from "../index";
import { trackTitleFromFileName } from "../index";

function track(overrides: Partial<LocalTrack> & { fileName: string }): LocalTrack {
  return {
    path: `/music/album/${overrides.fileName}`,
    size: 10_000_000,
    format: overrides.fileName.split(".").pop() ?? "flac",
    duration: 245,
    hasArt: false,
    ...overrides,
  };
}

describe("trackTitleFromFileName", () => {
  it("strips numbering and quality noise", () => {
    expect(trackTitleFromFileName("01 - Blue Monday [320].mp3")).toBe("Blue Monday");
    expect(trackTitleFromFileName("A2_Teardrop.flac")).toBe("Teardrop");
  });
});

describe("qualityOf", () => {
  it("ranks lossless 24/96 above MP3 320", () => {
    const flac = qualityOf(
      track({
        fileName: "01.flac",
        lossless: true,
        bitsPerSample: 24,
        sampleRate: 96_000,
        bitrate: 2_300_000,
      }),
    );
    const mp3 = qualityOf(
      track({ fileName: "01.mp3", lossless: false, bitrate: 320_000, size: 9_000_000 }),
    );
    expect(flac.score).toBeGreaterThan(mp3.score);
    expect(flac.label).toContain("24-bit");
    expect(mp3.label).toContain("320 kbps");
  });
});

describe("detectDuplicates", () => {
  it("groups the same track and keeps the best copy", () => {
    const tracks = [
      track({
        fileName: "01 - Angel.mp3",
        title: "Angel",
        track: 1,
        lossless: false,
        bitrate: 320_000,
      }),
      track({
        fileName: "01 - Angel.flac",
        title: "Angel",
        track: 1,
        lossless: true,
        bitsPerSample: 24,
        sampleRate: 96_000,
      }),
      track({ fileName: "02 - Risingson.flac", title: "Risingson", track: 2, lossless: true }),
    ];

    const groups = detectDuplicates(tracks);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep).toContain("Angel.flac");
    expect(groups[0]?.reason).toContain("24-bit");
    expect(uniqueTracks(tracks, groups)).toHaveLength(2);
  });

  it("does not group different tracks with the same number", () => {
    const groups = detectDuplicates([
      track({ fileName: "01 - Intro.mp3", title: "Intro", track: 1, duration: 30 }),
      track({ fileName: "01 - Outro.mp3", title: "Outro", track: 1, duration: 300 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("does not group the same title with wildly different lengths", () => {
    const groups = detectDuplicates([
      track({ fileName: "Angel (live).mp3", title: "Angel", duration: 240 }),
      track({ fileName: "Angel (remix).mp3", title: "Angel", duration: 480 }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("needs title evidence for same-number tracks in different folders", () => {
    const groups = detectDuplicates([
      track({
        fileName: "01 - Intro.mp3",
        path: "/music/disc-1/01 - Intro.mp3",
        title: "Intro",
        track: 1,
        duration: 45,
      }),
      track({
        fileName: "01 - Interlude.mp3",
        path: "/music/disc-2/01 - Interlude.mp3",
        title: "Interlude",
        track: 1,
        duration: 44,
      }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("groups copies of the same track across folders", () => {
    const groups = detectDuplicates([
      track({
        fileName: "01 - Angel.mp3",
        path: "/music/copy-a/01 - Angel.mp3",
        title: "Angel",
        track: 1,
        lossless: false,
        bitrate: 320_000,
      }),
      track({
        fileName: "01 - Angel.flac",
        path: "/music/copy-b/01 - Angel.flac",
        title: "Angel",
        track: 1,
        lossless: true,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep).toContain("copy-b");
  });

  it("allows a manual keeper override", () => {
    const tracks = [
      track({ fileName: "01 - Angel.mp3", title: "Angel", track: 1, lossless: false, bitrate: 320_000 }),
      track({ fileName: "01 - Angel.flac", title: "Angel", track: 1, lossless: true }),
    ];
    const groups = detectDuplicates(tracks);
    const mp3 = tracks[0];
    const updated = chooseKeeper(groups, groups[0]?.key ?? "", mp3?.path ?? "");
    expect(updated[0]?.keep).toBe(mp3?.path);
  });
});
