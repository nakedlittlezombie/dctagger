import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AlbumFolder, LocalTrack } from "../../model/types";
import { buildServer } from "../index";

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});

function track(folder: string, fileName: string, title: string): LocalTrack {
  return {
    path: path.join(folder, fileName),
    fileName,
    size: 16,
    format: "flac",
    title,
    track: 1,
    hasArt: false,
  };
}

function album(input: {
  id: string;
  folderPath: string;
  folderName: string;
  artist: string;
  title: string;
  tracks: LocalTrack[];
  sourceFolders?: string[];
}): AlbumFolder {
  return {
    id: input.id,
    path: input.folderPath,
    folderName: input.folderName,
    tracks: input.tracks,
    images: [],
    hints: { artist: input.artist, album: input.title, source: "tags" },
    status: "needs-review",
    candidates: [],
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: input.tracks.map((entry) => ({ filePath: entry.path, trackIndex: null })),
    duplicates: [],
    autoMatched: false,
    ...(input.sourceFolders ? { sourceFolders: input.sourceFolders } : {}),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("merge API", () => {
  it("merges two session albums into one", async () => {
    const dataDir = await tempDir("dctagger-merge-");
    const { app, state } = await buildServer({ dataDir });

    const first = album({
      id: "first",
      folderPath: "/music/disc-1",
      folderName: "Mezzanine (Disc 1)",
      artist: "Massive Attack",
      title: "Mezzanine",
      tracks: [track("/music/disc-1", "01 - Angel.flac", "Angel")],
    });
    const second = album({
      id: "second",
      folderPath: "/music/disc-2",
      folderName: "Mezzanine (Disc 2)",
      artist: "Massive Attack",
      title: "Mezzanine",
      tracks: [track("/music/disc-2", "01 - Teardrop.flac", "Teardrop")],
    });
    state.session.albums = [first, second];

    const response = await app.inject({
      method: "POST",
      url: "/api/albums/merge",
      payload: { albumIds: ["first", "second"] },
    });

    expect(response.statusCode).toBe(200);
    const session = response.json() as { albums: AlbumFolder[] };
    expect(session.albums).toHaveLength(1);
    expect(session.albums[0]?.id).toBe("first");
    expect(session.albums[0]?.tracks).toHaveLength(2);
    expect(session.albums[0]?.sourceFolders).toEqual([
      "/music/disc-1",
      "/music/disc-2",
    ]);
    await app.close();
  });

  it("refuses a single album", async () => {
    const dataDir = await tempDir("dctagger-merge-");
    const { app, state } = await buildServer({ dataDir });
    state.session.albums = [
      album({
        id: "only",
        folderPath: "/music/only",
        folderName: "Only",
        artist: "Artist",
        title: "Only",
        tracks: [track("/music/only", "01 - Song.flac", "Song")],
      }),
    ];

    const response = await app.inject({
      method: "POST",
      url: "/api/albums/merge",
      payload: { albumIds: ["only"] },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("refuses to merge folders that are different albums", async () => {
    const dataDir = await tempDir("dctagger-merge-");
    const { app, state } = await buildServer({ dataDir });
    state.session.albums = [
      album({
        id: "mezzanine",
        folderPath: "/music/mezzanine",
        folderName: "Mezzanine",
        artist: "Massive Attack",
        title: "Mezzanine",
        tracks: [track("/music/mezzanine", "01 - Angel.flac", "Angel")],
      }),
      album({
        id: "dummy",
        folderPath: "/music/dummy",
        folderName: "Dummy",
        artist: "Portishead",
        title: "Dummy",
        tracks: [track("/music/dummy", "01 - Mysterons.flac", "Mysterons")],
      }),
    ];

    const response = await app.inject({
      method: "POST",
      url: "/api/albums/merge",
      payload: { albumIds: ["mezzanine", "dummy"] },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toContain("same album");
    await app.close();
  });

  it("splits a merged album back into re-scanned folders", async () => {
    const dataDir = await tempDir("dctagger-merge-");
    const firstFolder = await tempDir("dctagger-disc-1-");
    const secondFolder = await tempDir("dctagger-disc-2-");
    await writeFile(path.join(firstFolder, "01 - Angel.flac"), Buffer.alloc(16));
    await writeFile(path.join(secondFolder, "01 - Teardrop.flac"), Buffer.alloc(16));

    const { app, state } = await buildServer({ dataDir });
    state.session.albums = [
      album({
        id: "merged",
        folderPath: firstFolder,
        folderName: path.basename(firstFolder),
        artist: "Massive Attack",
        title: "Mezzanine",
        tracks: [
          track(firstFolder, "01 - Angel.flac", "Angel"),
          track(secondFolder, "01 - Teardrop.flac", "Teardrop"),
        ],
        sourceFolders: [firstFolder, secondFolder],
      }),
    ];

    const response = await app.inject({
      method: "POST",
      url: "/api/albums/merged/unmerge",
    });

    expect(response.statusCode).toBe(200);
    const session = response.json() as { albums: AlbumFolder[] };
    expect(session.albums).toHaveLength(2);
    expect(session.albums.map((entry) => entry.path).sort()).toEqual(
      [firstFolder, secondFolder].sort(),
    );
    expect(session.albums.every((entry) => entry.status === "needs-review")).toBe(true);
    expect(session.albums.every((entry) => entry.tracks.length === 1)).toBe(true);
    await app.close();
  });
});
