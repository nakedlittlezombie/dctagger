import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MusicBrainzClient } from "../index";

let server: http.Server;
let baseUrl = "";
let cacheDir = "";
let releaseGroupRequests = 0;

beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "dctagger-musicbrainz-"));
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/ws/2/release-group") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      response.end(
        JSON.stringify({
          "release-groups":
            query.includes("nothing")
              ? []
              : [
                  {
                    id: "rg-mezzanine",
                    score: 100,
                    title: "Mezzanine",
                    "artist-credit": [{ name: "Massive Attack" }],
                  },
                  {
                    id: "rg-blue-lines",
                    score: 80,
                    title: "Blue Lines",
                    "artist-credit": [{ name: "Massive Attack" }],
                  },
                ],
        }),
      );
      return;
    }

    if (url.pathname === "/ws/2/release-group/rg-mezzanine") {
      releaseGroupRequests += 1;
      response.end(
        JSON.stringify({
          id: "rg-mezzanine",
          title: "Mezzanine",
          "artist-credit": [{ name: "Massive Attack" }],
          genres: [
            { name: "electronic", count: 11 },
            { name: "trip hop", count: 17 },
            { name: "downtempo", count: 5 },
            { name: "electronica", count: 3 },
            { name: "leftfield", count: 3 },
            { name: "dub", count: 1 },
          ],
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}/ws/2`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(cacheDir, { recursive: true, force: true });
});

function client(): MusicBrainzClient {
  return new MusicBrainzClient({
    baseUrl,
    minIntervalMs: 0,
    cacheDir,
    userAgent: "DCTagger-test/1.0 (test@example.com)",
  });
}

describe("MusicBrainzClient", () => {
  it("finds the closest release group and ranks genres by vote count", async () => {
    const album = await client().findAlbum("Massive Attack", "Mezzanine");
    expect(album).toMatchObject({
      releaseGroupId: "rg-mezzanine",
      title: "Mezzanine",
      artist: "Massive Attack",
      genres: ["trip hop", "electronic", "downtempo", "electronica"],
    });
    expect(album?.score).toBeGreaterThan(0.9);
  });

  it("returns undefined when nothing is close enough", async () => {
    expect(await client().findAlbum("Nobody", "Nothing")).toBeUndefined();
  });

  it("uses the disk cache for repeat release-group requests", async () => {
    const before = releaseGroupRequests;
    await client().getReleaseGroup("rg-mezzanine");
    expect(releaseGroupRequests).toBe(before);
  });
});
