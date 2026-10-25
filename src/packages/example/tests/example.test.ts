import { describe, expect, it } from "vitest";

// Tests import the package's ENTRY POINT (`../index`), never `lib/`.
import { normalizeTag } from "../index";

describe("normalizeTag", () => {
  it("builds a slug and a human label", () => {
    expect(normalizeTag("  Retro Games!  ")).toEqual({
      slug: "retro-games",
      label: "Retro Games",
    });
  });

  it("collapses repeated separators", () => {
    expect(normalizeTag("Sci--Fi / Fantasy").slug).toBe("sci-fi-fantasy");
  });

  it("rejects empty input", () => {
    expect(() => normalizeTag("   ")).toThrow("tag must not be empty");
  });
});
