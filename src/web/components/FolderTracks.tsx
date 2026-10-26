import { useMemo } from "react";

import type { AlbumFolder, LocalTrack } from "../../packages/model/types";

/** Compare paths without caring about separator style or trailing slashes. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function folderOf(filePath: string): string {
  const normalized = normalize(filePath);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function trackPosition(track: LocalTrack): string {
  if (track.track === undefined) return "—";
  const disc = track.disc !== undefined && track.disc > 1 ? `${track.disc}-` : "";
  return `${disc}${track.track}`;
}

function compareTracks(a: LocalTrack, b: LocalTrack): number {
  const discA = a.disc ?? 1;
  const discB = b.disc ?? 1;
  if (discA !== discB) return discA - discB;
  const trackA = a.track ?? Number.MAX_SAFE_INTEGER;
  const trackB = b.track ?? Number.MAX_SAFE_INTEGER;
  if (trackA !== trackB) return trackA - trackB;
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
}

interface FolderTracksProps {
  album: AlbumFolder;
  /** Limit the list to files that live in this folder. */
  folder?: string;
}

/**
 * Compact, read-only track list for one album folder. Used by the merge
 * surfaces so folders can be inspected before they are combined.
 */
export function FolderTracks({ album, folder }: FolderTracksProps) {
  const tracks = useMemo(() => {
    const wanted = folder ? normalize(folder) : null;
    return album.tracks
      .filter((track) => !wanted || folderOf(track.path) === wanted)
      .sort(compareTracks);
  }, [album.tracks, folder]);

  if (tracks.length === 0) {
    return <p className="folder-track-empty muted tiny">No tracks found in this folder.</p>;
  }

  return (
    <ul className="folder-track-list">
      {tracks.map((track) => (
        <li key={track.path} className="folder-track" title={track.path}>
          <span className="folder-track-number">{trackPosition(track)}</span>
          <span className="folder-track-title" title={track.title ?? track.fileName}>
            {track.title || track.fileName}
          </span>
          <span className="folder-track-artist ellipsis">
            {track.artist || track.albumArtist || ""}
          </span>
          <span className="folder-track-meta">
            {track.qualityLabel || track.format.toUpperCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}
