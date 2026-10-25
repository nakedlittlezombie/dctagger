import { describe, expect, it } from "vitest";

import { cleanArtistName } from "../artist";

describe("cleanArtistName", () => {
  it("removes Discogs numeric disambiguation suffixes", () => {
    expect(cleanArtistName("Coda (39)")).toBe("Coda");
    expect(cleanArtistName("Codex Empire & MARMO (5)")).toBe("Codex Empire & MARMO");
    expect(cleanArtistName("Brain (23) & Novaglitch")).toBe("Brain & Novaglitch");
    expect(cleanArtistName("Catalepsy (4)")).toBe("Catalepsy");
  });

  it("normalises Various", () => {
    expect(cleanArtistName("Various (2)")).toBe("Various Artists");
  });

  it("does not remove non-numeric parentheses or numbers in the name", () => {
    expect(cleanArtistName("Artist (Live)")).toBe("Artist (Live)");
    expect(cleanArtistName("Blink-182")).toBe("Blink-182");
    expect(cleanArtistName("The 1975")).toBe("The 1975");
  });

  it("handles empty values", () => {
    expect(cleanArtistName("")).toBe("");
    expect(cleanArtistName(undefined)).toBe("");
    expect(cleanArtistName("(5)")).toBe("Unknown Artist");
  });
});
