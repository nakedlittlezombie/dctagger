import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DeezerClient } from "../index";

let server: http.Server;
let baseUrl = "";
let cacheDir = "";
let albumRequests = 0;

beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "dctagger-deezer-"));
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/search/album") {
      const query = (url.searchParams.get("q") ?? "").toLowerCase();
      response.end(
        JSON.stringify({
          data:
            query.includes("nothing")
              ? []
              : [
                  {
                    id: 301773,
                    title: "Mezzanine",
                    artist: { name: "Massive Attack" },
                  },
                  {
                    id: 999,
                    title: "Blue Lines",
                    artist: { name: "Massive Attack" },
                  },
                ],
        }),
      );
      return;
    }

    if (url.pathname === "/album/301773") {
      albumRequests += 1;
      response.end(
        JSON.stringify({
          id: 301773,
          title: "Mezzanine",
          artist: { name: "Massive Attack" },
          genres: { data: [{ name: "Electro" }] },
          label: "Circa",
          release_date: "1998-04-20",
          link: "https://www.deezer.com/album/301773",
        }),
      );
      return;
    }

    if (url.pathname === "/album/2") {
      response.end(
        JSON.stringify({
          id: 2,
          title: "No Genres",
          artist: { name: "Test" },
          genre_id: 132,
        }),
      );
      return;
    }

    if (url.pathname === "/genre/132") {
      response.end(JSON.stringify({ id: 132, name: "Pop" }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "object" && address) baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(cacheDir, { recursive: true, force: true });
});

function client(): DeezerClient {
  return new DeezerClient({ baseUrl, minIntervalMs: 0, cacheDir });
}

describe("DeezerClient", () => {
  it("finds the closest album and returns its genre", async () => {
    const album = await client().findAlbum("Massive Attack", "Mezzanine");
    expect(album).toMatchObject({
      albumId: 301773,
      title: "Mezzanine",
      artist: "Massive Attack",
      genres: ["Electro"],
      label: "Circa",
    });
  });

  it("falls back to the genre_id endpoint when genres are missing", async () => {
    const album = await client().getAlbum(2);
    expect(album.genres).toEqual(["Pop"]);
  });

  it("returns undefined when nothing is close enough", async () => {
    expect(await client().findAlbum("Nobody", "Nothing")).toBeUndefined();
  });

  it("uses the disk cache for repeat album requests", async () => {
    const before = albumRequests;
    await client().getAlbum(301773);
    expect(albumRequests).toBe(before);
  });
});
