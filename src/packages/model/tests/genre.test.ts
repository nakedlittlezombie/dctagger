import { describe, expect, it } from "vitest";

import { normalizeGenres, releaseGenres } from "../genre";

describe("genre helpers", () => {
  it("combines Discogs genres with styles", () => {
    expect(
      releaseGenres({ genres: ["Electronic"], styles: ["Trip Hop", "Downtempo"] }),
    ).toEqual(["Electronic", "Trip Hop", "Downtempo"]);
  });

  it("deduplicates case-insensitively and trims values", () => {
    expect(normalizeGenres([" Rock ", "rock", "", "  ", "Pop"])).toEqual([
      "Rock",
      "Pop",
    ]);
  });

  it("falls back to local genres when Discogs has none", () => {
    expect(
      releaseGenres({ genres: [], styles: [] }, ["Ambient", "Drone"]),
    ).toEqual(["Ambient", "Drone"]);
  });

  it("prefers Discogs values over local fallback", () => {
    expect(
      releaseGenres({ genres: ["Electronic"], styles: [] }, ["Ambient"]),
    ).toEqual(["Electronic"]);
  });

  it("prefers the Deezer fallback over local tags", () => {
    expect(
      releaseGenres({ genres: [], styles: [] }, ["Ambient"], ["Electro"]),
    ).toEqual(["Electro"]);
  });

  it("uses MusicBrainz after Deezer and before local tags", () => {
    expect(
      releaseGenres({ genres: [], styles: [] }, ["Ambient"], [], ["Trip Hop"]),
    ).toEqual(["Trip Hop"]);
  });
});
