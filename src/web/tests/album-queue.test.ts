import { describe, expect, it } from "vitest";

import type { AlbumFolder, AlbumStatus, DiscogsRelease, LocalTrack } from "../../packages/model/types";
import {
  DEFAULT_QUEUE_OPTIONS,
  applyQueueOptions,
  isReviewAlbum,
  matchesQueueFilter,
  neighborInQueue,
  queueCounts,
  queueIndex,
  type QueueFilter,
  type QueueOptions,
} from "../album-queue";

function track(index: number): LocalTrack {
  const fileName = `track-${index}.flac`;
  return {
    path: `/music/album/${fileName}`,
    fileName,
    size: 1_000,
    format: "flac",
    hasArt: true,
  };
}

function release(trackCount: number): DiscogsRelease {
  return {
    id: 1,
    title: "Release",
    artists: [],
    genres: [],
    styles: [],
    labels: [],
    formats: [],
    images: [],
    uri: "https://www.discogs.com/release/1",
    tracklist: Array.from({ length: trackCount }, (_, index) => ({
      index,
      position: String(index + 1),
      title: `Track ${index + 1}`,
      artists: [],
      disc: 1,
      trackNumber: index + 1,
    })),
  };
}

function album(
  id: string,
  status: AlbumStatus,
  options: {
    folderName?: string;
    trackCount?: number;
    hints?: AlbumFolder["hints"];
    releaseTracks?: number;
    assigned?: number;
  } = {},
): AlbumFolder {
  const folderName = options.folderName ?? id;
  const trackCount = options.trackCount ?? 1;
  const tracks = Array.from({ length: trackCount }, (_, index) => track(index));
  const releaseTracks = options.releaseTracks;
  const candidates =
    releaseTracks === undefined
      ? []
      : [
          {
            release: release(releaseTracks),
            score: 0.9,
            breakdown: { album: 1, artist: 1, trackCount: 1, trackTitles: 1, year: 1 },
          },
        ];
  const assigned = options.assigned ?? tracks.length;
  return {
    id,
    path: `/music/${id}`,
    folderName,
    tracks,
    images: [],
    hints: options.hints ?? { source: "folder" },
    status,
    candidates,
    deezerCandidates: [],
    deezerCandidatesLoaded: false,
    mapping: tracks.map((entry, index) => ({
      filePath: entry.path,
      trackIndex: index < assigned ? index : null,
    })),
    duplicates: [],
    autoMatched: status === "auto-matched",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function options(patch: Partial<QueueOptions> = {}): QueueOptions {
  return { ...DEFAULT_QUEUE_OPTIONS, ...patch };
}

const filters: QueueFilter[] = ["all", "review", "auto", "confirmed", "applied", "skipped"];

describe("matchesQueueFilter", () => {
  it("treats errors as needing review", () => {
    expect(isReviewAlbum(album("a", "error"))).toBe(true);
    expect(matchesQueueFilter(album("a", "error"), "review")).toBe(true);
    expect(matchesQueueFilter(album("a", "auto-matched"), "review")).toBe(false);
  });

  it("maps every filter to its status", () => {
    const expected: Record<Exclude<QueueFilter, "review">, AlbumStatus> = {
      all: "needs-review",
      auto: "auto-matched",
      confirmed: "confirmed",
      applied: "applied",
      skipped: "skipped",
    };
    for (const filter of filters) {
      const status =
        filter === "review" ? "needs-review" : expected[filter as Exclude<QueueFilter, "review">];
      expect(matchesQueueFilter(album("a", status), filter)).toBe(true);
      expect(matchesQueueFilter(album("a", "error"), filter)).toBe(
        filter === "all" || filter === "review",
      );
    }
  });
});

describe("queueCounts", () => {
  it("counts review statuses as one bucket", () => {
    const albums = [
      album("a", "needs-review"),
      album("b", "error"),
      album("c", "auto-matched"),
      album("d", "applied"),
    ];
    expect(queueCounts(albums)).toEqual({
      all: 4,
      review: 2,
      auto: 1,
      confirmed: 0,
      applied: 1,
      skipped: 0,
    });
  });
});

describe("applyQueueOptions", () => {
  const albums = [
    album("small", "needs-review", { trackCount: 2 }),
    album("large", "needs-review", { trackCount: 9 }),
    album("middle", "auto-matched", { trackCount: 5 }),
  ];

  it("keeps scan order by default", () => {
    expect(applyQueueOptions(albums, options()).map((entry) => entry.id)).toEqual([
      "small",
      "large",
      "middle",
    ]);
  });

  it("orders by track count in both directions", () => {
    expect(
      applyQueueOptions(albums, options({ sort: "tracks-desc" })).map((entry) => entry.id),
    ).toEqual(["large", "middle", "small"]);
    expect(
      applyQueueOptions(albums, options({ sort: "tracks-asc" })).map((entry) => entry.id),
    ).toEqual(["small", "middle", "large"]);
  });

  it("combines the status filter with the sort", () => {
    expect(
      applyQueueOptions(albums, options({ filter: "review", sort: "tracks-asc" })).map(
        (entry) => entry.id,
      ),
    ).toEqual(["small", "large"]);
  });

  it("searches folder names and hints", () => {
    const named = [
      album("one", "needs-review", { folderName: "Blue Train" }),
      album("two", "needs-review", {
        folderName: "unknown",
        hints: { source: "tags", artist: "Coltrane", album: "Giant Steps" },
      }),
    ];
    expect(applyQueueOptions(named, options({ query: "coltrane" })).map((e) => e.id)).toEqual([
      "two",
    ]);
    expect(applyQueueOptions(named, options({ query: "blue" })).map((e) => e.id)).toEqual(["one"]);
  });

  it("hides albums with release tracks that have no local file", () => {
    const withMissing = [
      album("complete", "needs-review", { trackCount: 2, releaseTracks: 2, assigned: 2 }),
      album("short", "needs-review", { trackCount: 2, releaseTracks: 3, assigned: 2 }),
    ];
    expect(applyQueueOptions(withMissing, options()).map((e) => e.id)).toEqual([
      "complete",
      "short",
    ]);
    expect(
      applyQueueOptions(withMissing, options({ hideMissing: true })).map((e) => e.id),
    ).toEqual(["complete"]);
  });
});

describe("queue navigation", () => {
  const albums = [album("a", "needs-review"), album("b", "needs-review"), album("c", "error")];

  it("reports the current index", () => {
    expect(queueIndex(albums, "b")).toBe(1);
    expect(queueIndex(albums, "nope")).toBe(-1);
    expect(queueIndex(albums, null)).toBe(-1);
  });

  it("steps forward and falls back to the previous album at the end", () => {
    expect(neighborInQueue(albums, "a")?.id).toBe("b");
    expect(neighborInQueue(albums, "c")?.id).toBe("b");
    expect(neighborInQueue(albums, "nope")).toBeUndefined();
  });
});
