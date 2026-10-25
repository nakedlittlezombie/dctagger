import { useEffect, useMemo, useRef, useState } from "react";

import { autoMap } from "../../packages/matching";
import type {
  AlbumFolder,
  MatchCandidate,
  PublicSettings,
  ReleaseTrack,
} from "../../packages/model/types";
import { releaseGenres } from "../../packages/model/genre";
import { api, artUrl, imageUrl } from "../api-client";
import { Lightbox } from "../components/Lightbox";
import { StatusChip } from "../components/StatusChip";

function trackLabel(track: ReleaseTrack): string {
  const disc = track.disc > 1 ? `${track.disc}-` : "";
  return `${disc}${track.trackNumber}. ${track.title}`;
}

function autoMappingFor(
  album: AlbumFolder,
  releaseId: number | undefined,
): Record<string, number | null> {
  const candidate = [...album.candidates, ...album.deezerCandidates].find(
    (entry) => entry.release.id === releaseId,
  ) ?? album.candidates[0] ?? album.deezerCandidates[0];
  const losers = new Set(
    album.duplicates.flatMap((group) =>
      group.members.filter((member) => member.path !== group.keep).map((member) => member.path),
    ),
  );
  if (!candidate) return {};
  const kept = album.tracks.filter((track) => !losers.has(track.path));
  const auto = autoMap(kept, candidate.release.tracklist);
  const byPath = new Map(auto.map((entry) => [entry.filePath, entry]));
  const mapping: Record<string, number | null> = {};
  for (const track of album.tracks) {
    if (losers.has(track.path)) {
      mapping[track.path] = null;
    } else {
      mapping[track.path] = byPath.get(track.path)?.trackIndex ?? null;
    }
  }
  return mapping;
}

function mappingFromAlbum(album: AlbumFolder): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const assignment of album.mapping) {
    mapping[assignment.filePath] = assignment.trackIndex;
  }
  return mapping;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

interface ReviewViewProps {
  album: AlbumFolder;
  settings: PublicSettings;
  position?: { index: number; total: number };
  onChanged: (album: AlbumFolder) => void;
  onAdvance: () => void;
  onBack: () => void;
  onNotify: (message: string, kind?: "error" | "success") => void;
}

export function ReviewView({
  album,
  settings,
  position,
  onChanged,
  onAdvance,
  onBack,
  onNotify,
}: ReviewViewProps) {
  const [selectedId, setSelectedId] = useState<number | undefined>(
    album.selectedReleaseId ?? album.candidates[0]?.release.id ??
      album.deezerCandidates[0]?.release.id,
  );
  const [mapping, setMapping] = useState<Record<string, number | null>>(() =>
    mappingFromAlbum(album),
  );
  const [coverOverride, setCoverOverride] = useState<string | null>(album.coverOverride ?? null);
  const [artistQuery, setArtistQuery] = useState("");
  const [albumQuery, setAlbumQuery] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [dedupeWorking, setDedupeWorking] = useState<string | null>(null);
  const [deezerLoading, setDeezerLoading] = useState(false);
  const [deezerError, setDeezerError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; caption?: string } | null>(null);
  const deezerRequestedFor = useRef<string | null>(null);

  useEffect(() => {
    setSelectedId(
      album.selectedReleaseId ?? album.candidates[0]?.release.id ??
        album.deezerCandidates[0]?.release.id,
    );
    setMapping(mappingFromAlbum(album));
    setCoverOverride(album.coverOverride ?? null);
  }, [album.id, album.updatedAt, album.selectedReleaseId]);

  // Populate the Deezer block once per album. The server persists it, so this
  // is cached across reloads and never repeats for an already-loaded album.
  useEffect(() => {
    if (album.deezerCandidatesLoaded) return;
    if (deezerRequestedFor.current === album.id) return;
    deezerRequestedFor.current = album.id;
    let cancelled = false;
    setDeezerLoading(true);
    setDeezerError(null);
    void api
      .lookup(album.id, { source: "deezer" })
      .then((updated) => {
        if (!cancelled) onChanged(updated);
      })
      .catch((cause) => {
        if (!cancelled) {
          setDeezerError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setDeezerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [album.id, album.deezerCandidatesLoaded, onChanged]);

  const selected = [...album.candidates, ...album.deezerCandidates].find(
    (entry) => entry.release.id === selectedId,
  ) ?? album.candidates[0] ?? album.deezerCandidates[0];
  const release = selected?.release;
  const losers = useMemo(
    () =>
      new Set(
        album.duplicates.flatMap((group) =>
          group.members
            .filter((member) => member.path !== group.keep)
            .map((member) => member.path),
        ),
      ),
    [album.duplicates],
  );
  const keptTracks = album.tracks.filter((track) => !losers.has(track.path));
  const assignedCount = keptTracks.filter((track) => mapping[track.path] !== null).length;
  const unmapped = keptTracks.filter((track) => mapping[track.path] === null).length;

  const suggestions = useMemo(() => {
    if (!release) return new Map<string, number>();
    const auto = autoMap(keptTracks, release.tracklist);
    return new Map(auto.map((entry) => [entry.filePath, entry.confidence ?? 0]));
  }, [keptTracks, release]);

  const selectedCover = coverOverride
    ? artUrl(album.id, album.images.findIndex((image) => image.path === coverOverride))
    : release?.coverImage || release?.thumb
      ? imageUrl(release.coverImage ?? release.thumb ?? "")
      : album.images[0]
        ? artUrl(album.id, 0)
        : undefined;

  const applyCandidate = (candidate: MatchCandidate) => {
    setSelectedId(candidate.release.id);
    setMapping(autoMappingFor(album, candidate.release.id));
  };

  const renderCandidate = (candidate: MatchCandidate) => {
    const pinned = candidate.release.id === selected?.release.id;
    const thumb = candidate.release.coverImage ?? candidate.release.thumb;
    const scoreClass =
      candidate.score >= 0.9 ? "high" : candidate.score >= 0.6 ? "medium" : "low";
    return (
      <button
        key={candidate.release.id}
        className={pinned ? "candidate-card active" : "candidate-card"}
        onClick={() => applyCandidate(candidate)}
      >
        <div className="candidate-thumb">
          {thumb ? <img src={imageUrl(thumb)} alt="" loading="lazy" /> : <span>♪</span>}
        </div>
        <div className="candidate-copy">
          <span className="candidate-title" title={candidate.release.title}>
            {candidate.release.title}
          </span>
          <span className="candidate-artist">
            {candidate.release.artists.map((artist) => artist.name).join(", ")}
            {candidate.release.year ? ` · ${candidate.release.year}` : ""}
          </span>
          <span className="candidate-format">
            {candidate.release.formats.map((format) => format.name).join(" ")}
            {candidate.release.tracklist.length > 0
              ? ` · ${candidate.release.tracklist.length} tracks`
              : ""}
            {` · ${candidate.release.source === "deezer" ? "dz" : "r"}${Math.abs(candidate.release.id)}`}
          </span>
        </div>
        <span
          className={`score-badge ${scoreClass}`}
          title={Object.entries(candidate.breakdown)
            .map(([key, value]) => `${key} ${Math.round(value * 100)}%`)
            .join(" · ")}
        >
          {Math.round(candidate.score * 100)}%
        </span>
      </button>
    );
  };

  const setFileTrack = (filePath: string, value: number | null) => {
    setMapping((current) => {
      const next = { ...current, [filePath]: value };
      if (value !== null) {
        for (const [otherPath, otherValue] of Object.entries(next)) {
          if (otherPath !== filePath && otherValue === value) next[otherPath] = null;
        }
      }
      return next;
    });
  };

  const clearMapping = () => {
    setMapping(Object.fromEntries(album.tracks.map((track) => [track.path, null])));
  };

  const lookup = async (source: "discogs" | "deezer" = "discogs") => {
    setWorking(true);
    if (source === "deezer") {
      setDeezerLoading(true);
      setDeezerError(null);
    } else {
      deezerRequestedFor.current = null;
    }
    try {
      const updated = await api.lookup(album.id, {
        source,
        artist: artistQuery.trim(),
        album: albumQuery.trim(),
      });
      onChanged(updated);
      const count =
        source === "deezer" ? updated.deezerCandidates.length : updated.candidates.length;
      onNotify(
        count > 0
          ? `Found ${count} ${source === "deezer" ? "Deezer" : "Discogs"} match${count === 1 ? "" : "es"}.`
          : `No ${source === "deezer" ? "Deezer" : "Discogs"} matches found.`,
        count > 0 ? "success" : "error",
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (source === "deezer") setDeezerError(message);
      onNotify(message, "error");
    } finally {
      setWorking(false);
      if (source === "deezer") setDeezerLoading(false);
    }
  };

  const lookupLink = async () => {
    const url = linkQuery.trim();
    if (!url) {
      onNotify("Paste a Discogs or Deezer release link first.", "error");
      return;
    }
    setWorking(true);
    const isDeezerLink = /deezer\.com/i.test(url);
    if (isDeezerLink) {
      setDeezerLoading(true);
      setDeezerError(null);
    } else {
      deezerRequestedFor.current = null;
    }
    try {
      const updated = await api.lookup(album.id, { source: "link", url });
      onChanged(updated);
      const selected = [...updated.candidates, ...updated.deezerCandidates].find(
        (entry) => entry.release.id === updated.selectedReleaseId,
      );
      onNotify(
        selected
          ? `Linked match loaded: ${selected.release.artists.map((artist) => artist.name).join(", ")} — ${selected.release.title}.`
          : "Linked match loaded.",
        "success",
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (isDeezerLink) setDeezerError(message);
      onNotify(message, "error");
    } finally {
      setWorking(false);
      if (isDeezerLink) setDeezerLoading(false);
    }
  };

  const confirm = async () => {
    if (!release) return;
    if (assignedCount === 0) {
      onNotify("Map at least one file to a track first.", "error");
      return;
    }
    if (unmapped > 0) {
      const proceed = window.confirm(
        `${unmapped} unmapped file${unmapped === 1 ? "" : "s"} will be left in the source folder and not transferred. Continue?`,
      );
      if (!proceed) return;
    }
    setWorking(true);
    try {
      const updated = await api.confirm(album.id, {
        releaseId: release.id,
        mapping: album.tracks.map((track) => ({
          filePath: track.path,
          trackIndex: losers.has(track.path) ? null : mapping[track.path] ?? null,
        })),
        coverOverride,
      });
      onChanged(updated);
      onNotify(`Confirmed “${release.title}”.`, "success");
      onAdvance();
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setWorking(false);
    }
  };

  const skip = async () => {
    setWorking(true);
    try {
      const updated = await api.skip(album.id);
      onChanged(updated);
      onAdvance();
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setWorking(false);
    }
  };

  const reopen = async () => {
    setWorking(true);
    try {
      const updated = await api.reopen(album.id);
      onChanged(updated);
      onNotify(
        updated.status === "confirmed"
          ? "Album returned to the apply queue. Applying again creates a new destination folder; remove the failed one afterwards."
          : "Album reopened for review.",
        "success",
      );
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setWorking(false);
    }
  };

  const chooseDedupeKeeper = async (key: string, keepPath: string) => {
    setDedupeWorking(key);
    try {
      const updated = await api.setDedupeKeeper(album.id, key, keepPath);
      onChanged(updated);
      onNotify("Keeper changed. Mapping refreshed.", "success");
    } catch (cause) {
      onNotify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setDedupeWorking(null);
    }
  };

  const applied = album.status === "applied";
  const assignedFilesByTrack = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const [filePath, trackIndex] of Object.entries(mapping)) {
      if (trackIndex === null) continue;
      const track = album.tracks.find((entry) => entry.path === filePath);
      if (!track) continue;
      const list = map.get(trackIndex) ?? [];
      list.push(track.fileName);
      map.set(trackIndex, list);
    }
    return map;
  }, [mapping, album.tracks]);

  const missingCount = release
    ? release.tracklist.filter((track) => (assignedFilesByTrack.get(track.index)?.length ?? 0) === 0)
        .length
    : 0;

  const firstMappedTrack = useMemo(() => {
    if (!release) return undefined;
    const first = Object.values(mapping).find((value) => value !== null) ?? null;
    return release.tracklist.find((track) => track.index === first);
  }, [mapping, release]);
  const isDeezer = release?.source === "deezer";
  const releaseIdLabel = release ? `${isDeezer ? "dz" : "r"}${Math.abs(release.id)}` : "";
  const coverSourceLabel = coverOverride
    ? "Local override"
    : release?.coverImage
      ? isDeezer
        ? "Deezer"
        : "Discogs"
      : "Folder";
  const deezerGenres =
    release && !isDeezer && album.deezer?.releaseId === release.id
      ? album.deezer.genres
      : undefined;
  const musicBrainzGenres =
    release && album.musicbrainz?.releaseId === release.id
      ? album.musicbrainz.genres
      : undefined;
  const releaseHasGenres =
    release !== undefined &&
    [...release.genres, ...release.styles].some((genre) => genre?.trim());
  const effectiveGenres = release
    ? releaseGenres(release, album.hints.genres, deezerGenres, musicBrainzGenres)
    : [];
  const genreSource = !release
    ? "—"
    : releaseHasGenres
      ? isDeezer
        ? "Deezer"
        : "Discogs"
      : deezerGenres?.length
        ? "Deezer"
        : musicBrainzGenres?.length
          ? "MusicBrainz"
          : album.hints.genres?.length
            ? "Local tags"
            : "None";
  const confidenceValue = selected?.score ?? album.confidence ?? 0;
  const confidenceClass =
    confidenceValue >= 0.9 ? "high" : confidenceValue >= 0.6 ? "medium" : "low";

  return (
    <div className="view review-view">
      <div className="review-top">
        <button className="back-link" onClick={onBack}>
          ← Library roots
        </button>
        <span className="review-crumb mono">/ MATCH GRID / ALBUM RESOLUTION</span>
        <div className="review-position">
          {position ? `STAGE ${position.index} / ${position.total}` : "ALBUM REVIEW"}
        </div>
        <div className="review-actions-top">
          {applied ? (
            <span className="chip status-applied">Applied</span>
          ) : album.status === "skipped" ? (
            <button className="button ghost small" disabled={working} onClick={() => void reopen()}>
              Reopen album
            </button>
          ) : (
            <>
              <button className="button ghost small" disabled={working} onClick={() => void skip()}>
                Skip album
              </button>
              <button
                className="button primary"
                disabled={working || assignedCount === 0 || !release}
                onClick={() => void confirm()}
              >
                {working ? "Saving…" : "Confirm match"}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="review-header panel">
        <div className="review-album-info">
          <div className="eyebrow">Album folder</div>
          <h1>{album.folderName}</h1>
          <div className="review-meta-line">
            <StatusChip status={album.status} confidence={album.confidence} />
            <span>{album.tracks.length} files</span>
            {release && <span>{release.tracklist.length} Discogs tracks</span>}
            {album.duplicates.length > 0 && (
              <span className="warn-text">
                {album.duplicates.length} duplicate group{album.duplicates.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="muted small review-path">{album.path}</p>
          {album.error && <p className="form-error">{album.error}</p>}
        </div>
        <div className="review-confidence">
          <span className={`confidence-value ${confidenceClass}`}>
            {Math.round(confidenceValue * 100)}%
          </span>
          <span className="muted small">match confidence</span>
        </div>
      </div>

      {applied && (
        <div className="banner success">
          <div>
            <strong>Applied to {album.applied?.targetFolder}</strong>
            <span>
              {album.applied?.tagged} tagged · {album.applied?.files} files
              {album.applied?.deduplicated
                ? ` · ${album.applied.deduplicated} duplicate${album.applied.deduplicated === 1 ? "" : "s"} handled`
                : ""}
              {album.applied?.skipped
                ? ` · ${album.applied.skipped} unmatched left in source`
                : ""}
            </span>
            {album.applied && album.applied.errors.length > 0 && (
              <span className="error-text">{album.applied.errors.join(" · ")}</span>
            )}
          </div>
          <button className="button small" onClick={onBack}>
            Back to library
          </button>
          {album.applied && album.applied.errors.length > 0 && (
            <button
              className="button small ghost"
              disabled={working}
              onClick={() => void reopen()}
            >
              Retry apply
            </button>
          )}
        </div>
      )}

      <div className="review-grid">
        <aside className="candidate-column">
          <section className="panel candidate-cover">
            {selectedCover ? (
              <button
                className="cover-button"
                onClick={() =>
                  setLightbox({
                    src: selectedCover,
                    caption: release ? `${release.artists.map((a) => a.name).join(", ")} — ${release.title}` : undefined,
                  })
                }
              >
                <img src={selectedCover} alt="Selected album cover" />
                <span className="cover-hint">Click to enlarge</span>
              </button>
            ) : (
              <div className="cover-missing">No cover art yet</div>
            )}
            {release && (
              <div className="selected-release">
                <div className="eyebrow">Selected release</div>
                <h3>{release.title}</h3>
                <p>{release.artists.map((artist) => artist.name).join(", ")}</p>
                <div className="release-chips">
                  {release.year && <span className="chip">{release.year}</span>}
                  <span className="chip">
                    {release.formats.map((format) => format.name).join(" ") || "Release"}
                  </span>
                  <span className="chip">{releaseIdLabel}</span>
                  <span className="chip">{coverSourceLabel} art</span>
                </div>
                <p className="muted small">
                  {[release.country, release.labels[0]?.name, release.labels[0]?.catno]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <a href={release.uri} target="_blank" rel="noreferrer" className="link-button">
                  Open on {isDeezer ? "Deezer" : "Discogs"} ↗
                </a>
              </div>
            )}
          </section>

          <section className="panel candidates-panel">
            <div className="section-heading tight">
              <div>
                <div className="eyebrow">Discogs candidates</div>
                <h2>Top matches</h2>
              </div>
              <span className="chip">{album.candidates.length} found</span>
            </div>
            <div className="candidate-list">
              {album.candidates.length === 0 && (
                <p className="muted small">
                  No Discogs matches yet. Deezer matches appear below.
                </p>
              )}
              {album.candidates.map(renderCandidate)}
            </div>
          </section>

          <section className="panel deezer-panel">
            <div className="section-heading tight">
              <div>
                <div className="eyebrow">Deezer</div>
                <h2>Top Deezer matches</h2>
              </div>
              <span className="chip">{album.deezerCandidates.length}</span>
            </div>
            {deezerLoading && <p className="muted small">Searching Deezer…</p>}
            {!deezerLoading && deezerError && (
              <div className="deezer-empty">
                <p className="form-error">{deezerError}</p>
                <button className="button ghost small" onClick={() => void lookup("deezer")}>
                  Retry Deezer
                </button>
              </div>
            )}
            {!deezerLoading && !deezerError && album.deezerCandidates.length === 0 && (
              <p className="muted small">
                {album.deezerCandidatesLoaded
                  ? "No Deezer matches found."
                  : "Deezer matches have not been loaded yet."}
              </p>
            )}
            {!deezerLoading && album.deezerCandidates.length > 0 && (
              <div className="candidate-list">
                {album.deezerCandidates.map(renderCandidate)}
              </div>
            )}
            {!deezerLoading && !album.deezerCandidatesLoaded && !deezerError && (
              <button className="button ghost small" onClick={() => void lookup("deezer")}>
                Find Deezer matches
              </button>
            )}
          </section>

          <section className="panel lookup-panel">
            <div className="section-heading tight">
              <div>
                <div className="eyebrow">Manual lookup</div>
                <h2>Artist / album / link</h2>
              </div>
            </div>
            <form
              className="lookup-form"
              onSubmit={(event) => {
                event.preventDefault();
                void lookup("discogs");
              }}
            >
              <input
                value={artistQuery}
                onChange={(event) => setArtistQuery(event.target.value)}
                placeholder="Artist"
                spellCheck={false}
                aria-label="Artist"
              />
              <input
                value={albumQuery}
                onChange={(event) => setAlbumQuery(event.target.value)}
                placeholder="Album"
                spellCheck={false}
                aria-label="Album"
              />
              <input
                className="lookup-link"
                value={linkQuery}
                onChange={(event) => setLinkQuery(event.target.value)}
                placeholder="Paste a Discogs or Deezer release link"
                spellCheck={false}
                aria-label="Release link"
              />
              <div className="lookup-actions">
                <button className="button ghost small" type="submit" disabled={working}>
                  Search Discogs
                </button>
                <button
                  className="button ghost small"
                  type="button"
                  disabled={working}
                  onClick={() => void lookup("deezer")}
                >
                  Search Deezer
                </button>
                <button
                  className="button ghost small"
                  type="button"
                  disabled={working}
                  onClick={() => void lookupLink()}
                >
                  Match link
                </button>
              </div>
            </form>
            <p className="muted tiny">
              Empty artist/album uses the folder hints. Links may be Discogs release/master URLs
              or Deezer album URLs.
            </p>
          </section>
        </aside>

        <main className="alignment-column">
          <section className="panel tracklist-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">{isDeezer ? "Deezer tracklist" : "Canonical tracklist"}</div>
                <h2>Track alignment</h2>
                <p className="muted small">
                  {release
                    ? `${release.artists.map((artist) => artist.name).join(", ")} — ${release.title}`
                    : "Select a release to see its tracks"}
                </p>
              </div>
              <div className="tracklist-stats">
                <span className="chip status-confirmed">{assignedCount} linked</span>
                <span className="chip">{keptTracks.length} files</span>
                {missingCount > 0 && (
                  <span
                    className="chip missing-chip"
                    title={`${missingCount} track${missingCount === 1 ? "" : "s"} on this release have no local file`}
                  >
                    {missingCount} missing
                  </span>
                )}
              </div>
            </div>
            {release ? (
              <div className="tracklist">
                {release.tracklist.map((track) => {
                  const files = assignedFilesByTrack.get(track.index) ?? [];
                  return (
                    <div key={track.index} className={files.length > 0 ? "track-row mapped" : "track-row"}>
                      <span className="track-position">{track.position || track.trackNumber}</span>
                      <span className={files.length > 0 ? "track-node linked" : "track-node"} />
                      <div className="track-copy">
                        <span className="track-title">{track.title}</span>
                        <span className="track-assigned">
                          {files.length > 0 ? files.join(", ") : "unassigned"}
                        </span>
                      </div>
                      <span className="track-duration">{track.duration ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted">No release selected.</p>
            )}
          </section>

          <section className="panel mapping-panel">
            <div className="section-heading">
              <div>
                <div className="eyebrow">Source → canonical</div>
                <h2>File / track assignment</h2>
                <p className="muted small">
                  {unmapped > 0
                    ? `${unmapped} file${unmapped === 1 ? "" : "s"} will be transferred untagged.`
                    : "Every file is mapped."}
                </p>
              </div>
              <div className="panel-actions">
                <button
                  className="button ghost small"
                  disabled={!release || applied}
                  onClick={() => setMapping(autoMappingFor(album, selected?.release.id))}
                >
                  Auto-map
                </button>
                <button className="button ghost small" disabled={applied} onClick={clearMapping}>
                  Clear
                </button>
              </div>
            </div>

            <div className="file-map-list">
              {album.tracks.map((track) => {
                const isLoser = losers.has(track.path);
                const assigned = mapping[track.path];
                const suggestion = suggestions.get(track.path);
                return (
                  <div
                    key={track.path}
                    className={`file-map-row ${isLoser ? "is-loser" : ""} ${assigned === null ? "unmapped" : ""}`}
                  >
                    <div className="file-map-info">
                      <span className="file-map-name ellipsis" title={track.fileName}>
                        {track.fileName}
                      </span>
                      <span className="file-map-tags">
                        {[
                          track.title,
                          track.artist,
                          track.track ? `track ${track.track}` : undefined,
                          track.format.toUpperCase(),
                          track.qualityLabel,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {isLoser && (
                        <span className="chip dupe-chip">
                          {settings.dedupeMode === "off"
                            ? "Duplicate — copied as extra"
                            : settings.dedupeMode === "hide"
                              ? "Duplicate — hidden"
                              : "Duplicate — delete"}
                        </span>
                      )}
                    </div>
                    {isLoser ? (
                      <span className="muted small dedupe-note">NOT TAGGED</span>
                    ) : (
                      <div className="file-map-controls">
                        {suggestion !== undefined && suggestion > 0 && assigned !== null && (
                          <span className={`suggest-badge ${suggestion > 0.6 ? "good" : ""}`}>
                            {Math.round(suggestion * 100)}%
                          </span>
                        )}
                        <select
                          value={assigned === null ? "" : String(assigned)}
                          disabled={!release || applied}
                          onChange={(event) =>
                            setFileTrack(
                              track.path,
                              event.target.value === "" ? null : Number(event.target.value),
                            )
                          }
                        >
                          <option value="">Skip / unmapped</option>
                          {release?.tracklist.map((remote) => (
                            <option key={remote.index} value={remote.index}>
                              {trackLabel(remote)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mapping-footer">
              <span className="muted small mono">
                {unmapped === 0
                  ? `${assignedCount}/${keptTracks.length} FILES LINKED`
                  : `${unmapped} UNMAPPED FILE${unmapped === 1 ? "" : "S"}`}
              </span>
              <span className="muted tiny">
                {unmapped > 0
                  ? "Unmapped files stay in the source folder and are not transferred."
                  : "Every kept file is linked to the selected release."}
              </span>
            </div>
          </section>
        </main>

        <aside className="inspector-column">
          <section className="panel art-panel">
            <div className="section-heading tight">
              <div>
                <div className="eyebrow">Artwork inspector</div>
                <h2>Folder art</h2>
              </div>
              <span className="chip">{album.images.length} {album.images.length === 1 ? "file" : "files"}</span>
            </div>
            {album.images.length === 0 ? (
              <p className="muted small">No artwork files in this folder.</p>
            ) : (
              <div className="art-grid">
                {album.images.map((image, index) => {
                  const src = artUrl(album.id, index);
                  const pinned = coverOverride === image.path;
                  return (
                    <div key={`${image.path}-${index}`} className={pinned ? "art-tile active" : "art-tile"}>
                      <button
                        className="art-image-button"
                        onClick={() => setLightbox({ src, caption: image.fileName })}
                      >
                        <img src={src} alt={image.fileName} loading="lazy" />
                      </button>
                      <div className="art-tile-foot">
                        <span className="ellipsis" title={image.fileName}>
                          {image.fileName}
                        </span>
                        <span className="art-tile-meta mono">
                          {image.size ? formatBytes(image.size) : image.mimeType}
                          {` · ${image.source === "embedded" ? "EMBEDDED" : "FILE"}`}
                        </span>
                        <button
                          className="link-button"
                          onClick={() => setCoverOverride(pinned ? null : image.path)}
                        >
                          {pinned ? "Use Discogs art" : "Replace with this"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel inspector-panel">
            <div className="section-heading tight">
              <div>
                <div className="eyebrow">Metadata preview</div>
                <h2>Canonical tags</h2>
              </div>
              <span className="chip status-confirmed">READY</span>
            </div>
            {release ? (
              <div className="tag-preview">
                <div className="tag-row">
                  <span>Title</span>
                  <strong>{firstMappedTrack?.title ?? "—"}</strong>
                </div>
                <div className="tag-row">
                  <span>Artist</span>
                  <strong>{release.artists.map((artist) => artist.name).join(", ") || "—"}</strong>
                </div>
                <div className="tag-row">
                  <span>Album</span>
                  <strong>{release.title}</strong>
                </div>
                <div className="tag-row">
                  <span>Year</span>
                  <strong>{release.year ?? album.hints.year ?? "—"}</strong>
                </div>
                <div className="tag-row">
                  <span>Genre</span>
                  <strong title="Discogs genres + styles, then Deezer, then local genre tags">
                    {effectiveGenres.join(", ") || "—"}{" "}
                    <span className="muted tiny">· {genreSource}</span>
                  </strong>
                </div>
                <div className="tag-row">
                  <span>Style</span>
                  <strong>{release.styles.join(", ") || "—"}</strong>
                </div>
                <div className="tag-row">
                  <span>Label</span>
                  <strong>{release.labels[0]?.name ?? "—"}</strong>
                </div>
                <div className="tag-row">
                  <span>Catalog #</span>
                  <code>{release.labels[0]?.catno ?? "—"}</code>
                </div>
                <div className="tag-row">
                  <span>Release ID</span>
                  <code>{releaseIdLabel}</code>
                </div>
                <div className="tag-row">
                  <span>Cover</span>
                  <strong>{coverSourceLabel}</strong>
                </div>
              </div>
            ) : (
              <p className="muted small">Select a Discogs release to preview its tags.</p>
            )}
          </section>

          {album.duplicates.length > 0 && (
            <section className="panel dedupe-panel">
              <div className="section-heading tight">
                <div>
                  <div className="eyebrow">Quality control</div>
                  <h2>Duplicate files</h2>
                </div>
                <span className="chip">{album.duplicates.length}</span>
              </div>
              <p className="muted tiny dedupe-intro">
                {settings.dedupeMode === "off"
                  ? "Dedupe off — losing copies are transferred as untagged extras."
                  : settings.dedupeMode === "hide"
                    ? "Losing copies stay in the source folder, not transferred."
                    : "Losing copies are deleted after the keeper is transferred."}{" "}
                Choosing a keeper remaps the album.
              </p>
              <div className="dedupe-groups">
                {album.duplicates.map((group) => (
                  <div key={group.key} className="dedupe-group">
                    <div className="dedupe-group-head">
                      <strong>{group.reason}</strong>
                      <span className="mono tiny">{group.key}</span>
                    </div>
                    {group.members.map((member) => (
                      <label
                        key={member.path}
                        className={group.keep === member.path ? "dedupe-member keeper" : "dedupe-member"}
                      >
                        <input
                          type="radio"
                          name={`keep-${group.key}`}
                          checked={group.keep === member.path}
                          disabled={dedupeWorking === group.key || applied}
                          onChange={() => void chooseDedupeKeeper(group.key, member.path)}
                        />
                        <span className="dedupe-file ellipsis">{member.fileName}</span>
                        <span className="dedupe-quality">{member.qualityLabel}</span>
                        <span className="muted small">{formatBytes(member.size)}</span>
                        {group.keep === member.path && <span className="chip status-confirmed">KEEP</span>}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      <div className={applied ? "review-footer applied" : "review-footer"}>
        <div className="review-stage mono">
          {release
            ? `STAGE: ${isDeezer ? "DEEZER" : "DISCOGS"} RELEASE ${releaseIdLabel} · ${assignedCount}/${keptTracks.length} FILES LINKED`
            : "STAGE: AWAITING RELEASE SELECTION"}
          {unmapped > 0 && <span className="warn-text"> · {unmapped} UNMAPPED</span>}
          {album.duplicates.length > 0 && (
            <span className="muted">
              {" "}· {album.duplicates.length} DUPLICATE{album.duplicates.length === 1 ? "" : "S"}
            </span>
          )}
          {missingCount > 0 && (
            <span className="warn-text"> · {missingCount} RELEASE TRACK{missingCount === 1 ? "" : "S"} MISSING</span>
          )}
        </div>
        <div className="review-footer-actions">
          {applied ? (
            <span className="chip status-applied">PIPELINE COMPLETE</span>
          ) : (
            <>
              <button className="button ghost small" disabled={working} onClick={() => void skip()}>
                Reject / skip
              </button>
              <button
                className="button primary"
                disabled={working || assignedCount === 0 || !release}
                onClick={() => void confirm()}
              >
                {working ? "Saving…" : "Confirm album match →"}
              </button>
            </>
          )}
        </div>
      </div>

      {lightbox && (
        <Lightbox src={lightbox.src} caption={lightbox.caption} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
