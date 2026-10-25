import type { AlbumFolder, DiscogsRelease, ReleaseTrack } from "../packages/model/types";

/** The release explicitly selected for this album, if any. */
export function selectedRelease(album: AlbumFolder): DiscogsRelease | undefined {
  return (
    album.candidates.find((entry) => entry.release.id === album.selectedReleaseId) ??
    album.candidates[0]
  )?.release;
}

/**
 * Release tracks that have no local file assigned in the stored album mapping.
 * These are tracks present on the Discogs release but absent from the folder.
 */
export function missingTracks(album: AlbumFolder): ReleaseTrack[] {
  const release = selectedRelease(album);
  if (!release || album.mapping.length === 0) return [];
  const assigned = new Set(
    album.mapping
      .map((entry) => entry.trackIndex)
      .filter((value): value is number => value !== null),
  );
  return release.tracklist.filter((track) => !assigned.has(track.index));
}

export function missingTrackCount(album: AlbumFolder): number {
  return missingTracks(album).length;
}
