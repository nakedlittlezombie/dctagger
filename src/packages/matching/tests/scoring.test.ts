import { describe, expect, it } from "vitest";

import type { DiscogsRelease } from "../../model/types";
import { isHighConfidence, scoreRelease } from "../index";
import type { LocalMatchInput } from "../index";

function release(overrides: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return {
    id: 1,
    title: "Mezzanine",
    artists: [{ name: "Massive Attack" }],
    year: 1998,
    genres: ["Electronic"],
    styles: ["Trip Hop"],
    labels: [{ name: "Virgin", catno: "CDV2859" }],
    formats: [{ name: "CD", descriptions: ["Album"] }],
    tracklist: [
      { index: 0, position: "1", title: "Angel", artists: [], disc: 1, trackNumber: 1 },
      { index: 1, position: "2", title: "Risingson", artists: [], disc: 1, trackNumber: 2 },
      { index: 2, position: "3", title: "Teardrop", artists: [], disc: 1, trackNumber: 3 },
    ],
    images: [],
    uri: "https://www.discogs.com/release/1",
    ...overrides,
  };
}

const local: LocalMatchInput = {
  artist: "Massive Attack",
  album: "Mezzanine",
  year: 1998,
  tracks: [
    { fileName: "01 Angel.flac", title: "Angel", track: 1 },
    { fileName: "02 Risingson.flac", title: "Risingson", track: 2 },
    { fileName: "03 Teardrop.flac", title: "Teardrop", track: 3 },
  ],
};

describe("scoreRelease", () => {
  it("scores an exact match very highly", () => {
    const result = scoreRelease(local, release());
    expect(result.score).toBeGreaterThan(0.95);
    expect(result.breakdown.trackCount).toBe(1);
  });

  it("penalizes a different album", () => {
    const result = scoreRelease(local, release({ title: "Blue Lines" }));
    expect(result.score).toBeLessThan(0.75);
  });

  it("survives edition noise in the album title", () => {
    const result = scoreRelease(
      { ...local, album: "Mezzanine (Deluxe Edition)" },
      release(),
    );
    expect(result.breakdown.album).toBeGreaterThan(0.9);
  });

  it("notices a mismatched track count", () => {
    const result = scoreRelease(
      local,
      release({
        tracklist: [
          ...release().tracklist,
          { index: 3, position: "4", title: "Exchange", artists: [], disc: 1, trackNumber: 4 },
        ],
      }),
    );
    expect(result.breakdown.trackCount).toBeLessThan(0.7);
  });
});

describe("isHighConfidence", () => {
  const top = scoreRelease(local, release());
  const options = {
    threshold: 0.85,
    margin: 0.06,
    hasArtist: true,
    hasAlbum: true,
  };

  it("accepts a clear winner", () => {
    expect(isHighConfidence(top, scoreRelease(local, release({ title: "Blue Lines" })), options))
      .toBe(true);
  });

  it("rejects a close race", () => {
    expect(isHighConfidence(top, { ...top, score: top.score - 0.01 }, options)).toBe(false);
  });

  it("rejects scores under the threshold", () => {
    expect(
      isHighConfidence({ ...top, score: 0.5 }, undefined, { ...options, threshold: 0.9 }),
    ).toBe(false);
  });
});
