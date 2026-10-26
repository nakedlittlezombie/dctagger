import { describe, expect, it } from "vitest";

import type {
  AlbumFolder,
  AlbumStatus,
  LocalImage,
  LocalTrack,
} from "../../model/types";
import {
  compareAlbumsForMerge,
  findMergeGroups,
  mergeAlbumKey,
  mergeAlbums,
} from "../index";

function track(
  fileName: string,
  overrides: Partial<LocalTrack> = {},
): LocalTrack {
  return {
    path: `/music/original/${fileName}`,
    fileName,
    size: 10_000_000,
    format: fileName.split(".").pop() ?? "flac",
    duration: 240,
    hasArt: false,
    ...overrides,
  };
}

function album(input: {
  id: string;
  folderName?: string;
  artist?: string;
  title?: string;
  year?: number;
  tracks?: LocalTrack[];
  status?: AlbumStatus;
  genres?: string[];
  sourceFolders?: string[];
  coverOverride?: string;
  images?: LocalImage[];
}): AlbumFolder {
  const folderName = input.folderName ?? input.id;
  const tracks = input.tracks ?? [track("01 - Song.flac")];
  const folderPath = `/music/${input.id}`;
  return {
    id: input.id,
    path: folderPath,
    folderName,
    tracks,
    images: input.images ?? [],
    hints: {
      artist: input.artist,
      album: input.title === undefined ? folderName : input.title,
      year: input.year,
      ...(input.genres ? { genres: input.genres } : {}),
      source: "tags",
    },
    status: input.status ?? "needs-review",
    candidates: [],
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: tracks.map((entry) => ({ filePath: entry.path, trackIndex: null })),
    duplicates: [],
    autoMatched: false,
    ...(input.sourceFolders ? { sourceFolders: input.sourceFolders } : {}),
    ...(input.coverOverride ? { coverOverride: input.coverOverride } : {}),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function inFolder(folder: string, files: LocalTrack[]): LocalTrack[] {
  return files.map((entry) => ({
    ...entry,
    path: `/music/${folder}/${entry.fileName}`,
  }));
}

describe("mergeAlbumKey", () => {
  it("ignores disc markers", () => {
    expect(mergeAlbumKey("Mezzanine (Disc 1)")).toBe("mezzanine");
    expect(mergeAlbumKey("Mezzanine CD2")).toBe("mezzanine");
  });

  it("keeps volume and part qualifiers, which name separate releases", () => {
    expect(mergeAlbumKey("Portishead - Dummy [Vol. 3]")).toBe("portishead dummy vol 3");
    expect(mergeAlbumKey("Mezzanine Part 2")).toBe("mezzanine part 2");
  });

  it("keeps meaningful album names intact", () => {
    expect(mergeAlbumKey("Mezzanine")).toBe("mezzanine");
    expect(mergeAlbumKey("Dummy")).toBe("dummy");
  });
});

describe("compareAlbumsForMerge", () => {
  it("flags a release split across disc folders", () => {
    const discOne = album({
      id: "disc-1",
      folderName: "Mezzanine (Disc 1)",
      artist: "Massive Attack",
      title: "Mezzanine",
      tracks: inFolder("disc-1", [
        track("01 - Angel.flac", { title: "Angel", track: 1 }),
        track("02 - Risingson.flac", { title: "Risingson", track: 2 }),
      ]),
    });
    const discTwo = album({
      id: "disc-2",
      folderName: "Mezzanine (Disc 2)",
      artist: "Massive Attack",
      title: "Mezzanine",
      tracks: inFolder("disc-2", [
        track("01 - Teardrop.flac", { title: "Teardrop", track: 1 }),
        track("02 - Inertia Creeps.flac", { title: "Inertia Creeps", track: 2 }),
      ]),
    });

    const comparison = compareAlbumsForMerge(discOne, discTwo);
    expect(comparison).not.toBeNull();
    expect(comparison?.trackOverlap).toBe(0);
    expect(comparison?.reason).toContain("Complementary");
  });

  it("flags copies of the same release", () => {
    const tracks = [
      track("01 - Angel.flac", { title: "Angel", track: 1 }),
      track("02 - Risingson.flac", { title: "Risingson", track: 2 }),
    ];
    const copyOne = album({
      id: "copy-1",
      folderName: "Mezzanine",
      artist: "Massive Attack",
      tracks: inFolder("copy-1", tracks),
    });
    const copyTwo = album({
      id: "copy-2",
      folderName: "Mezzanine copy",
      artist: "Massive Attack",
      tracks: inFolder("copy-2", tracks),
    });

    const comparison = compareAlbumsForMerge(copyOne, copyTwo);
    expect(comparison).not.toBeNull();
    expect(comparison?.trackOverlap).toBe(1);
    expect(comparison?.reason).toContain("same tracks");
  });

  it("rejects different artists, albums, years, and applied albums", () => {
    const base = album({
      id: "a",
      folderName: "Mezzanine",
      artist: "Massive Attack",
      year: 1998,
    });
    expect(
      compareAlbumsForMerge(
        base,
        album({ id: "b", folderName: "Mezzanine", artist: "Portishead", year: 1998 }),
      ),
    ).toBeNull();
    expect(
      compareAlbumsForMerge(
        base,
        album({ id: "c", folderName: "Dummy", artist: "Massive Attack", year: 1998 }),
      ),
    ).toBeNull();
    expect(
      compareAlbumsForMerge(
        base,
        album({ id: "d", folderName: "Mezzanine", artist: "Massive Attack", year: 1991 }),
      ),
    ).toBeNull();
    expect(
      compareAlbumsForMerge(base, {
        ...album({ id: "e", folderName: "Mezzanine", artist: "Massive Attack" }),
        status: "applied",
      }),
    ).toBeNull();
  });

  it("rejects a sequence of numbered albums", () => {
    const volumeOne = album({
      id: "v1",
      folderName: "Mezzanine Vol. 1",
      artist: "Massive Attack",
      title: "Mezzanine Vol. 1",
    });
    const volumeTwo = album({
      id: "v2",
      folderName: "Mezzanine Vol. 2",
      artist: "Massive Attack",
      title: "Mezzanine Vol. 2",
    });
    expect(compareAlbumsForMerge(volumeOne, volumeTwo)).toBeNull();

    const nowTwenty = album({
      id: "n20",
      folderName: "Now 20",
      artist: "Various",
      title: "Now 20",
    });
    const nowTwentyOne = album({
      id: "n21",
      folderName: "Now 21",
      artist: "Various",
      title: "Now 21",
    });
    expect(compareAlbumsForMerge(nowTwenty, nowTwentyOne)).toBeNull();
  });
});

describe("findMergeGroups", () => {
  it("groups a three-disc release into one suggestion", () => {
    const albums = ["CD1", "CD2", "CD3"].map((folder) =>
      album({
        id: folder.toLowerCase(),
        folderName: `Mezzanine ${folder}`,
        artist: "Massive Attack",
        title: "Mezzanine",
        tracks: inFolder(folder, [
          track("01 - Song.flac", { title: `${folder} song`, track: 1 }),
        ]),
      }),
    );

    const groups = findMergeGroups(albums);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.albumIds).toEqual(["cd1", "cd2", "cd3"]);
  });

  it("leaves unrelated albums alone", () => {
    const albums = [
      album({ id: "a", folderName: "Mezzanine", artist: "Massive Attack", title: "Mezzanine" }),
      album({ id: "b", folderName: "Dummy", artist: "Portishead", title: "Dummy" }),
    ];
    expect(findMergeGroups(albums)).toEqual([]);
  });

  it("does not group a numbered sequence of albums", () => {
    const albums = [
      album({ id: "v1", folderName: "Mezzanine Vol. 1", artist: "Massive Attack", title: "Mezzanine Vol. 1" }),
      album({ id: "v2", folderName: "Mezzanine Vol. 2", artist: "Massive Attack", title: "Mezzanine Vol. 2" }),
    ];
    expect(findMergeGroups(albums)).toEqual([]);
  });

  it("compares albums that share a distinctive album-name token", () => {
    const albums = [
      album({
        id: "full",
        folderName: "The Downward Spiral",
        artist: "Nine Inch Nails",
        title: "The Downward Spiral",
      }),
      album({
        id: "bare",
        folderName: "Downward Spiral",
        artist: "Nine Inch Nails",
        title: "Downward Spiral",
      }),
    ];
    expect(findMergeGroups(albums)).toHaveLength(1);
  });
});

describe("mergeAlbums", () => {
  it("combines tracks, folders, hints, and artwork", () => {
    const target = album({
      id: "disc-1",
      folderName: "Mezzanine (Disc 1)",
      artist: "Massive Attack",
      title: "Mezzanine",
      genres: ["Trip Hop"],
      tracks: inFolder("disc-1", [
        track("01 - Angel.flac", { title: "Angel", track: 1, disc: 1 }),
      ]),
      images: [
        {
          path: "/music/disc-1/cover.jpg",
          fileName: "cover.jpg",
          mimeType: "image/jpeg",
          source: "folder",
        },
      ],
      coverOverride: "/music/disc-1/cover.jpg",
    });
    const second = album({
      id: "disc-2",
      folderName: "Mezzanine (Disc 2)",
      artist: "Massive Attack",
      title: "Mezzanine",
      genres: ["trip hop", "Downtempo"],
      tracks: inFolder("disc-2", [
        track("01 - Teardrop.flac", { title: "Teardrop", track: 1, disc: 2 }),
      ]),
      images: [
        {
          path: "/music/disc-2/cover.jpg",
          fileName: "cover.jpg",
          mimeType: "image/jpeg",
          source: "folder",
        },
      ],
      coverOverride: "/music/disc-2/cover.jpg",
    });

    const merged = mergeAlbums([target, second]);

    expect(merged.id).toBe("disc-1");
    expect(merged.path).toBe(target.path);
    expect(merged.folderName).toBe("Mezzanine (Disc 1)");
    expect(merged.sourceFolders).toEqual([target.path, second.path]);
    expect(merged.tracks.map((entry) => entry.title)).toEqual(["Angel", "Teardrop"]);
    expect(merged.hints.genres).toEqual(["Trip Hop", "Downtempo"]);
    expect(merged.images).toHaveLength(2);
    expect(merged.coverOverride).toBe("/music/disc-1/cover.jpg");
    expect(merged.status).toBe("needs-review");
    expect(merged.autoMatched).toBe(false);
    expect(merged.mapping.every((entry) => entry.trackIndex === null)).toBe(true);
  });

  it("detects duplicates across the merged folders", () => {
    const mp3 = inFolder("copy-a", [
      track("01 - Angel.mp3", {
        title: "Angel",
        track: 1,
        lossless: false,
        bitrate: 320_000,
      }),
    ]);
    const flac = inFolder("copy-b", [
      track("01 - Angel.flac", { title: "Angel", track: 1, lossless: true }),
    ]);

    const merged = mergeAlbums([
      album({ id: "copy-a", folderName: "Mezzanine", artist: "Massive Attack", tracks: mp3 }),
      album({ id: "copy-b", folderName: "Mezzanine", artist: "Massive Attack", tracks: flac }),
    ]);

    expect(merged.duplicates).toHaveLength(1);
    expect(merged.duplicates[0]?.keep).toContain("copy-b");
  });

  it("keeps a merged album's existing source folders", () => {
    const first = album({
      id: "a",
      folderName: "Mezzanine",
      artist: "Massive Attack",
      tracks: inFolder("a", [track("01 - Angel.flac", { title: "Angel", track: 1 })]),
      sourceFolders: ["/music/a", "/music/a-disc2"],
    });
    const second = album({
      id: "b",
      folderName: "Mezzanine",
      artist: "Massive Attack",
      tracks: inFolder("b", [track("02 - Risingson.flac", { title: "Risingson" })]),
    });

    const merged = mergeAlbums([first, second]);
    expect(merged.sourceFolders).toEqual([
      "/music/a",
      "/music/a-disc2",
      "/music/b",
    ]);
  });

  it("refuses to merge a single album", () => {
    expect(() => mergeAlbums([album({ id: "only" })])).toThrow();
  });

  it("refuses to merge folders that are different albums", () => {
    const first = album({
      id: "mezzanine",
      folderName: "Mezzanine",
      artist: "Massive Attack",
      title: "Mezzanine",
    });
    const second = album({
      id: "dummy",
      folderName: "Dummy",
      artist: "Portishead",
      title: "Dummy",
    });
    expect(() => mergeAlbums([first, second])).toThrow(/same album/);
  });

  it("refuses to merge a sequence of numbered albums", () => {
    const first = album({
      id: "vol-1",
      folderName: "Mezzanine Vol. 1",
      artist: "Massive Attack",
      title: "Mezzanine Vol. 1",
    });
    const second = album({
      id: "vol-2",
      folderName: "Mezzanine Vol. 2",
      artist: "Massive Attack",
      title: "Mezzanine Vol. 2",
    });
    expect(() => mergeAlbums([first, second])).toThrow(/same album/);
  });
});
