import { useEffect, useMemo, useState } from "react";

import { compareAlbumsForMerge } from "../../packages/matching";
import type { AlbumFolder, MergeSuggestion } from "../../packages/model/types";
import { FolderTracks } from "./FolderTracks";
import { StatusChip } from "./StatusChip";

interface MergePickerProps {
  /** Album that keeps its identity after the merge. */
  album: AlbumFolder;
  /** Every album in the scan, used to offer merge partners. */
  albums: AlbumFolder[];
  /** Server-computed groups that look like the same release. */
  suggestions: MergeSuggestion[];
  onMerge: (albumIds: string[]) => Promise<void>;
  onClose: () => void;
}

/**
 * Pick other folders that belong to the same release. Only folders that look
 * like the same album are offered, so a merge can never combine a sequence of
 * different albums; albums flagged by the detector are sorted first with their
 * confidence.
 */
export function MergePicker({
  album,
  albums,
  suggestions,
  onMerge,
  onClose,
}: MergePickerProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /** Best suggestion score per partner folder, for ranking and labels. */
  const partners = useMemo(() => {
    const map = new Map<string, { score: number; reason: string }>();
    for (const suggestion of suggestions) {
      if (!suggestion.albumIds.includes(album.id)) continue;
      for (const albumId of suggestion.albumIds) {
        if (albumId === album.id) continue;
        const existing = map.get(albumId);
        if (!existing || suggestion.score > existing.score) {
          map.set(albumId, { score: suggestion.score, reason: suggestion.reason });
        }
      }
    }
    return map;
  }, [suggestions, album.id]);

  const candidates = useMemo(() => {
    return albums
      .filter(
        (candidate) =>
          candidate.id !== album.id &&
          candidate.status !== "applied" &&
          candidate.tracks.length > 0 &&
          compareAlbumsForMerge(album, candidate) !== null,
      )
      .map((candidate) => ({
        album: candidate,
        suggestion: partners.get(candidate.id),
      }))
      .sort((left, right) => {
        const scoreDifference =
          (right.suggestion?.score ?? 0) - (left.suggestion?.score ?? 0);
        if (scoreDifference !== 0) return scoreDifference;
        if (right.album.tracks.length !== left.album.tracks.length) {
          return right.album.tracks.length - left.album.tracks.length;
        }
        return left.album.folderName.localeCompare(right.album.folderName);
      });
  }, [album, albums, partners]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? candidates.filter(({ album: candidate }) =>
        [candidate.folderName, candidate.path, candidate.hints.artist, candidate.hints.album]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(needle)),
      )
    : candidates;

  const selectedAlbums = candidates
    .filter(({ album: candidate }) => selected.has(candidate.id))
    .map(({ album: candidate }) => candidate);
  const totalFiles =
    album.tracks.length +
    selectedAlbums.reduce((sum, candidate) => sum + candidate.tracks.length, 0);

  const toggle = (albumId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  };

  const toggleExpanded = (albumId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  };

  const submit = async () => {
    if (selectedAlbums.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      await onMerge([album.id, ...selectedAlbums.map((candidate) => candidate.id)]);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div className="modal merge-picker" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Merge folders into “{album.folderName}”</h2>
            <span className="muted tiny">
              Files stay where they are. Only folders that look like the same album can be
              merged — copies of one release, or its discs split across folders.
            </span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="merge-picker-search">
          <input
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter folders…"
            aria-label="Filter folders to merge"
            autoFocus
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="merge-picker-body">
          {visible.length === 0 && (
            <p className="muted small">
              {candidates.length === 0
                ? "No other folder in this scan looks like the same album."
                : "No folders match that filter."}
            </p>
          )}
          {visible.map(({ album: candidate, suggestion }) => {
            const checked = selected.has(candidate.id);
            const open = expanded.has(candidate.id);
            return (
              <div
                key={candidate.id}
                className={checked ? "merge-option selected" : "merge-option"}
              >
                <div className="merge-option-head">
                  <input
                    id={`merge-option-${candidate.id}`}
                    type="checkbox"
                    checked={checked}
                    disabled={working}
                    onChange={() => toggle(candidate.id)}
                  />
                  <label className="merge-option-copy" htmlFor={`merge-option-${candidate.id}`}>
                    <span className="merge-option-title">
                      <strong className="ellipsis">{candidate.folderName}</strong>
                      <StatusChip
                        status={candidate.status}
                        confidence={candidate.confidence}
                      />
                      <span className="chip">
                        {candidate.tracks.length} file
                        {candidate.tracks.length === 1 ? "" : "s"}
                      </span>
                      {suggestion && (
                        <span className="chip merge-chip">
                          {Math.round(suggestion.score * 100)}% likely
                        </span>
                      )}
                    </span>
                    <span className="muted tiny ellipsis" title={candidate.path}>
                      {candidate.path}
                    </span>
                    <span className="muted tiny">
                      {[
                        candidate.hints.artist,
                        candidate.hints.album,
                        candidate.hints.year,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No artist/album hints"}
                      {suggestion ? ` — ${suggestion.reason}` : ""}
                    </span>
                  </label>
                  <button
                    className="link-button merge-expand"
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleExpanded(candidate.id)}
                  >
                    {open ? "Hide tracks" : "Show tracks"}
                  </button>
                </div>
                {open && <FolderTracks album={candidate} />}
              </div>
            );
          })}
        </div>

        <div className="modal-foot">
          <span className="muted small">
            {selectedAlbums.length === 0
              ? "Select folders to merge"
              : `${selectedAlbums.length + 1} folders · ${totalFiles} files total`}
          </span>
          <div className="modal-actions">
            <button className="button ghost small" disabled={working} onClick={onClose}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={working || selectedAlbums.length === 0}
              onClick={() => void submit()}
            >
              {working ? "Merging…" : "Merge folders"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
