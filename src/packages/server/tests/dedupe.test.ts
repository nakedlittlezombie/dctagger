import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AlbumFolder, DuplicateGroup, LocalTrack } from "../../model/types";
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

function track(folder: string, fileName: string): LocalTrack {
  return {
    path: path.join(folder, fileName),
    fileName,
    size: 1_000,
    format: path.extname(fileName).replace(/^\./, ""),
    hasArt: false,
  };
}

function duplicateGroup(keep: LocalTrack, copy: LocalTrack): DuplicateGroup {
  return {
    key: "track-1",
    keep: keep.path,
    members: [
      {
        path: keep.path,
        fileName: keep.fileName,
        format: "FLAC",
        qualityScore: 500,
        qualityLabel: "FLAC 16-bit",
        size: keep.size,
      },
      {
        path: copy.path,
        fileName: copy.fileName,
        format: "MP3",
        qualityScore: 100,
        qualityLabel: "MP3 320 kbps",
        size: copy.size,
      },
    ],
    reason: "Keeping FLAC 16-bit instead of MP3 320 kbps",
  };
}

function album(folder: string, tracks: LocalTrack[], duplicates: DuplicateGroup[]): AlbumFolder {
  return {
    id: "angel",
    path: folder,
    folderName: "Angel",
    tracks,
    images: [],
    hints: { artist: "Massive Attack", album: "Mezzanine", source: "tags" },
    status: "needs-review",
    candidates: [],
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: tracks.map((entry) => ({ filePath: entry.path, trackIndex: null })),
    duplicates,
    autoMatched: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("dedupe ignore API", () => {
  it("keeps a suspected duplicate as its own track and restores it", async () => {
    const dataDir = await tempDir("dctagger-dedupe-");
    const { app, state } = await buildServer({ dataDir });
    const folder = "/music/angel";
    const flac = track(folder, "01 - Angel.flac");
    const mp3 = track(folder, "01 - Angel.mp3");
    state.session.albums = [album(folder, [flac, mp3], [duplicateGroup(flac, mp3)])];

    const ignored = await app.inject({
      method: "POST",
      url: "/api/albums/angel/dedupe/ignore",
      payload: { path: mp3.path },
    });
    expect(ignored.statusCode).toBe(200);
    const updated = ignored.json() as AlbumFolder;
    expect(updated.dedupeIgnores).toEqual([mp3.path]);
    expect(updated.status).toBe("needs-review");

    const restored = await app.inject({
      method: "POST",
      url: "/api/albums/angel/dedupe/ignore",
      payload: { path: mp3.path, ignored: false },
    });
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as AlbumFolder).dedupeIgnores).toBeUndefined();
    await app.close();
  });

  it("rejects a file that is not currently a duplicate", async () => {
    const dataDir = await tempDir("dctagger-dedupe-");
    const { app, state } = await buildServer({ dataDir });
    const folder = "/music/angel";
    const flac = track(folder, "01 - Angel.flac");
    const other = track(folder, "02 - Risingson.flac");
    state.session.albums = [
      album(folder, [flac, other], [duplicateGroup(flac, track(folder, "01 - Angel.mp3"))]),
    ];

    const response = await app.inject({
      method: "POST",
      url: "/api/albums/angel/dedupe/ignore",
      payload: { path: other.path },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
