import { describe, expect, it } from "vitest";

import {
  renderFileName,
  renderFolderPath,
  sanitizeSegment,
  SAMPLE_CONTEXT,
} from "../index";

describe("naming", () => {
  it("renders a folder pattern with nested segments", () => {
    expect(
      renderFolderPath("{artist}/{year} - {album}", SAMPLE_CONTEXT),
    ).toBe("Massive Attack/1998 - Mezzanine");
  });

  it("pads numeric tokens", () => {
    expect(
      renderFileName("{track:02} - {title}", SAMPLE_CONTEXT),
    ).toBe("02 - Teardrop");
  });

  it("drops empty tokens without leaving separators", () => {
    expect(renderFileName("{track:02} - {title}", { track: 3 })).toBe(
      "03",
    );
  });

  it("sanitizes filesystem-hostile characters", () => {
    expect(sanitizeSegment('AC/DC: "Live"')).toBe("AC-DC- -Live-");
    expect(renderFileName("{artist} - {title}", { artist: "AC/DC", title: "T.N.T." }))
      .toBe("AC-DC - T.N.T");
  });

  it("does not turn slashes inside tag values into subfolders", () => {
    expect(renderFolderPath("{artist}/{album}", { artist: "AC/DC", album: "Live" }))
      .toBe("AC-DC/Live");
  });

  it("never escapes the destination with traversal segments", () => {
    expect(renderFolderPath("../../etc/{album}", SAMPLE_CONTEXT)).toBe(
      "etc/Mezzanine",
    );
  });

  it("handles reserved Windows names", () => {
    expect(sanitizeSegment("CON")).toBe("_CON");
  });
});
