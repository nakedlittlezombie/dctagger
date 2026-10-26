import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { enumerateAlbumFolders, parseFolderName, scanAlbumFolder } from "../index";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dctagger-scan-"));
  roots.push(root);
  return root;
}

async function makeAlbum(folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "01 - Song.flac"), Buffer.alloc(16));
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

describe("enumerateAlbumFolders", () => {
  it("finds album folders directly under the root", async () => {
    const root = await tempRoot();
    await makeAlbum(path.join(root, "Mezzanine"));
    await makeAlbum(path.join(root, "Blue Lines"));

    const found = await enumerateAlbumFolders(root);
    expect(found.map((location) => path.basename(location.path)).sort()).toEqual([
      "Blue Lines",
      "Mezzanine",
    ]);
    expect(found.every((location) => location.artistHint === undefined)).toBe(true);
  });

  it("finds albums inside artist folders and hints the artist", async () => {
    const root = await tempRoot();
    await makeAlbum(path.join(root, "Massive Attack", "Mezzanine"));
    await makeAlbum(path.join(root, "Massive Attack", "Blue Lines"));
    await makeAlbum(path.join(root, "Portishead", "Dummy"));

    const found = await enumerateAlbumFolders(root);
    expect(found).toHaveLength(3);
    expect(found.find((location) => location.path.endsWith("Mezzanine"))?.artistHint).toBe(
      "Massive Attack",
    );
    expect(found.find((location) => location.path.endsWith("Dummy"))?.artistHint).toBe(
      "Portishead",
    );
  });

  it("supports a mixed flat + artist layout", async () => {
    const root = await tempRoot();
    await makeAlbum(path.join(root, "Loose Album"));
    await makeAlbum(path.join(root, "Artist", "Nested Album"));

    const found = await enumerateAlbumFolders(root);
    expect(found).toHaveLength(2);
    expect(found.find((location) => location.path.includes("Loose Album"))?.artistHint).toBeUndefined();
    expect(found.find((location) => location.path.includes("Nested Album"))?.artistHint).toBe("Artist");
  });

  it("treats the root itself as an album when audio lives directly in it", async () => {
    const root = await tempRoot();
    await writeFile(path.join(root, "01 - Song.flac"), Buffer.alloc(16));
    const found = await enumerateAlbumFolders(root);
    expect(found).toEqual([{ path: root }]);
  });

  it("ignores empty container folders", async () => {
    const root = await tempRoot();
    await mkdir(path.join(root, "Artist", "Empty Album"), { recursive: true });
    expect(await enumerateAlbumFolders(root)).toEqual([]);
  });

  it("borrows album hints from a container when the album folder is a disc", async () => {
    const root = await tempRoot();
    await makeAlbum(path.join(root, "Massive Attack", "Mezzanine", "CD1"));
    await makeAlbum(path.join(root, "Massive Attack", "Mezzanine", "CD2"));

    const found = await enumerateAlbumFolders(root);
    expect(found).toHaveLength(2);
    expect(found.every((location) => location.containerHints?.album === "Mezzanine")).toBe(
      true,
    );
    expect(found.every((location) => location.artistHint === "Massive Attack")).toBe(true);
  });

  it("does not borrow hints for an album that is not a disc folder", async () => {
    const root = await tempRoot();
    await makeAlbum(path.join(root, "Massive Attack", "Mezzanine"));

    const found = await enumerateAlbumFolders(root);
    expect(found[0]?.containerHints).toBeUndefined();
  });

  it("uses container hints when scanning a disc folder without tags", async () => {
    const root = await tempRoot();
    const disc = path.join(root, "Massive Attack", "Mezzanine", "CD1");
    await makeAlbum(disc);

    const location = (await enumerateAlbumFolders(root))[0];
    expect(location).toBeDefined();
    const album = await scanAlbumFolder(location?.path ?? disc, {
      artCacheDir: path.join(root, ".art"),
      artistHint: location?.artistHint,
      containerHints: location?.containerHints,
    });

    expect(album.hints.album).toBe("Mezzanine");
    expect(album.hints.artist).toBe("Massive Attack");
  });
});

describe("parseFolderName", () => {
  it("parses artist - album (year)", () => {
    expect(parseFolderName("Massive Attack - Mezzanine (1998)")).toEqual({
      artist: "Massive Attack",
      album: "Mezzanine",
      year: 1998,
    });
  });

  it("parses artist - year - album", () => {
    expect(parseFolderName("Portishead - 1994 - Dummy")).toEqual({
      artist: "Portishead",
      album: "Dummy",
      year: 1994,
    });
  });

  it("falls back to a bare album name", () => {
    expect(parseFolderName("Mezzanine")).toEqual({ album: "Mezzanine" });
  });
});
