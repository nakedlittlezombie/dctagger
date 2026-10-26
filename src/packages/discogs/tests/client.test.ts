import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DiscogsClient, ImageBudgetExceededError, normalizeDiscogsToken } from "../index";

let server: http.Server;
let baseUrl = "";
let cacheDir = "";
let releaseRequests = 0;
let lastAuth = "";

beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "dctagger-discogs-"));
  server = http.createServer((request, response) => {
    lastAuth = String(request.headers.authorization ?? "");
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json");

    if (lastAuth.includes("bad-token")) {
      response.statusCode = 401;
      response.end(
        JSON.stringify({
          message: "Invalid consumer token. Please register an app before making requests.",
        }),
      );
      return;
    }

    if (url.pathname === "/database/search") {
      response.end(
        JSON.stringify({
          results: [
            {
              id: 42,
              type: "release",
              title: "Massive Attack - Mezzanine",
              year: "1998",
              format: ["CD", "Album"],
              label: ["Virgin"],
              cover_image: "https://i.discogs.com/cover.jpg",
            },
            { id: 43, type: "master", title: "Ignored master" },
          ],
        }),
      );
      return;
    }

    if (url.pathname === "/releases/42") {
      releaseRequests += 1;
      response.end(
        JSON.stringify({
          id: 42,
          title: "Mezzanine",
          year: 1998,
          artists: [{ id: 1, name: "Massive Attack" }],
          labels: [{ name: "Virgin", catno: "CDV2859" }],
          formats: [{ name: "CD", qty: "2", descriptions: ["Album"] }],
          genres: ["Electronic"],
          styles: ["Trip Hop"],
          images: [
            {
              type: "secondary",
              uri: "https://i.discogs.com/small.jpg",
              width: 100,
              height: 100,
            },
            {
              type: "primary",
              uri: "https://i.discogs.com/large.jpg",
              width: 1000,
              height: 1000,
            },
          ],
          tracklist: [
            { position: "1-01", type_: "track", title: "Angel", duration: "6:18" },
            { position: "1-02", type_: "track", title: "Risingson", duration: "4:58" },
            { position: "2-01", type_: "track", title: "Teardrop", duration: "5:29" },
            { type_: "heading", title: "Ignored heading" },
          ],
          uri: "https://www.discogs.com/release/42",
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(cacheDir, { recursive: true, force: true });
});

function client(): DiscogsClient {
  return new DiscogsClient({
    token: "test-token",
    baseUrl,
    minIntervalMs: 0,
    cacheDir,
  });
}

describe("DiscogsClient", () => {
  it("normalizes tokens pasted with an Authorization prefix", () => {
    expect(normalizeDiscogsToken("  Discogs token=abc123  ")).toBe("abc123");
    expect(normalizeDiscogsToken("Authorization: Discogs token=abc123")).toBe("abc123");
    expect(normalizeDiscogsToken("Bearer abc123")).toBe("abc123");
    expect(normalizeDiscogsToken('"abc123"')).toBe("abc123");
  });

  it("searches releases and filters masters", async () => {
    const results = await client().searchReleases({
      artist: "Massive Attack",
      album: "Mezzanine",
      limit: 4,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 42,
      title: "Massive Attack - Mezzanine",
      year: 1998,
    });
    expect(lastAuth).toBe("Discogs token=test-token");
  });

  it("maps release details, images, discs, and filters headings", async () => {
    const release = await client().getRelease(42);
    expect(release.artists[0]?.name).toBe("Massive Attack");
    expect(release.tracklist).toHaveLength(3);
    expect(release.tracklist.map((track) => [track.disc, track.trackNumber])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
    expect(release.images[0]?.type).toBe("primary");
    expect(release.coverImage).toBe("https://i.discogs.com/large.jpg");
    expect(release.labels[0]?.catno).toBe("CDV2859");
  });

  it("serves repeat requests from the disk cache", async () => {
    const before = releaseRequests;
    await client().getRelease(42);
    expect(releaseRequests).toBe(before);
  });

  it("normalizes a prefixed token before building the header", async () => {
    const prefixed = new DiscogsClient({
      token: " Discogs token=test-token ",
      baseUrl,
      minIntervalMs: 0,
    });
    await prefixed.searchReleases({ query: "prefixed-token", limit: 2 });
    expect(lastAuth).toBe("Discogs token=test-token");
  });

  it("adds an actionable hint for 401 consumer-token errors", async () => {
    const bad = new DiscogsClient({
      token: "bad-token",
      baseUrl,
      minIntervalMs: 0,
    });
    await expect(bad.searchReleases({ query: "bad", limit: 2 })).rejects.toThrow(
      /Personal Access Token/,
    );
  });

  it("raises a distinct error when the daily image budget is spent", async () => {
    const imageDir = path.join(cacheDir, "images");
    await mkdir(imageDir, { recursive: true });
    await writeFile(
      path.join(imageDir, "budget.json"),
      JSON.stringify({ day: new Date().toISOString().slice(0, 10), count: 1000 }),
    );
    try {
      await expect(
        client().downloadImage("https://i.discogs.com/uncached-cover.jpg"),
      ).rejects.toBeInstanceOf(ImageBudgetExceededError);
    } finally {
      await rm(imageDir, { recursive: true, force: true });
    }
  });
});
