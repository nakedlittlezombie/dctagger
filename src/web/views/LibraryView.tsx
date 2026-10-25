import { useEffect, useMemo, useState } from "react";

import type { AlbumFolder, AlbumStatus, PublicSettings, SessionView } from "../../packages/model/types";
import { missingTrackCount } from "../album-stats";
import { AlbumThumb } from "../components/AlbumThumb";
import { FolderPicker } from "../components/FolderPicker";
import { ProgressBar } from "../components/ProgressBar";
import { StatusChip } from "../components/StatusChip";

import { artUrl } from "../api-client";

type Filter = "all" | "review" | "auto" | "confirmed" | "applied" | "skipped";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "review", label: "Needs review" },
  { id: "auto", label: "Auto-matched" },
  { id: "confirmed", label: "Confirmed" },
  { id: "applied", label: "Applied" },
  { id: "skipped", label: "Skipped" },
];

function matchesFilter(album: AlbumFolder, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "review") return album.status === "needs-review" || album.status === "error";
  if (filter === "auto") return album.status === "auto-matched";
  if (filter === "confirmed") return album.status === "confirmed";
  if (filter === "applied") return album.status === "applied";
  return album.status === "skipped";
}

interface LibraryViewProps {
  session: SessionView;
  settings: PublicSettings;
  busy: boolean;
  onScan: (rootFolder: string) => void;
  onCancelScan: () => void;
  onReset: () => void;
  onReview: (albumId: string) => void;
  onReviewAll: () => void;
  onApply: () => void;
  onSettings: () => void;
}

export function LibraryView({
  session,
  settings,
  busy,
  onScan,
  onCancelScan,
  onReset,
  onReview,
  onReviewAll,
  onApply,
  onSettings,
}: LibraryViewProps) {
  const [root, setRoot] = useState(settings.rootFolder || session.scan.rootFolder || "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!root) setRoot(settings.rootFolder || session.scan.rootFolder || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rootFolder, session.scan.rootFolder]);

  const { scan, albums } = session;
  const summary = scan.summary;
  const reviewable = albums.filter(
    (album) => album.status === "needs-review" || album.status === "error",
  );
  const pendingApply = albums.filter(
    (album) => album.status === "auto-matched" || album.status === "confirmed",
  );
  const scanning = scan.phase === "scanning";

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return albums
      .filter((album) => matchesFilter(album, filter))
      .filter((album) => {
        if (!needle) return true;
        return [album.folderName, album.hints.artist, album.hints.album, album.path]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(needle));
      });
  }, [albums, filter, query]);

  const counts = {
    all: albums.length,
    review: reviewable.length,
    auto: albums.filter((album) => album.status === "auto-matched").length,
    confirmed: albums.filter((album) => album.status === "confirmed").length,
    applied: albums.filter((album) => album.status === "applied").length,
    skipped: albums.filter((album) => album.status === "skipped").length,
  } satisfies Record<Filter, number>;

  return (
    <div className="view library-view">
      {!settings.hasToken && (
        <div className="banner warn">
          <div>
            <strong>Add a Discogs token to start matching.</strong>
            <span>
              Create a personal access token in Discogs → Settings → Developers, then paste it
              into Settings.
            </span>
          </div>
          <button className="button small" onClick={onSettings}>
            Open settings
          </button>
        </div>
      )}

      <section className="scan-card panel">
        <div className="scan-card-main">
          <div className="eyebrow">Ingestion controller / library roots</div>
          <h1>Audio ingest &amp; match workspace</h1>
          <p className="lede">
            Point DCTagger at a library root. It walks album folders (flat or grouped by artist),
            reads tags, queries Discogs, auto-approves clear matches, and stages the rest for
            cover-to-cover review.
          </p>
          <div className="folder-input-row">
            <div className="path-input">
              <span className="path-icon">⌂</span>
              <input
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                placeholder="/home/you/Music"
                spellCheck={false}
                aria-label="Music library folder"
              />
            </div>
            <button className="button ghost" onClick={() => setPickerOpen(true)}>
              Browse
            </button>
            <button
              className="button primary"
              disabled={busy || scanning || !root.trim() || !settings.hasToken}
              title={!settings.hasToken ? "Add a Discogs token first" : undefined}
              onClick={() => {
                if (
                  albums.length > 0 &&
                  !window.confirm(
                    "Scanning again clears the current results and review decisions. Continue?",
                  )
                ) {
                  return;
                }
                onScan(root.trim());
              }}
            >
              {scanning ? "Scanning…" : scan.phase === "done" ? "Rescan library" : "Scan folder"}
            </button>
          </div>
          <div className="policy-strip">
            <span className="chip">
              AUTO-ACCEPT ≥ <strong>{Math.round(settings.autoThreshold * 100)}%</strong>
            </span>
            <span className="chip">
              LEAD ≥ <strong>{Math.round(settings.autoMargin * 100)}%</strong>
            </span>
            <span className="chip">{settings.candidateCount} candidates</span>
            <span className="chip">DUPLICATES: {settings.dedupeMode}</span>
            <span className="chip">COVER: {settings.coverMode}</span>
            <span className="chip">TRANSFER: {settings.transferMode}</span>
          </div>
          {scanning && (
            <div className="scan-progress">
              <ProgressBar
                value={scan.done}
                max={scan.total || 1}
                label={
                  scan.total > 0
                    ? `Scanned ${scan.done} of ${scan.total} folders`
                    : "Discovering album folders…"
                }
              />
              {scan.currentFolder && (
                <p className="muted small ellipsis">Matching {scan.currentFolder}</p>
              )}
              <button className="button small ghost" onClick={onCancelScan}>
                Cancel scan
              </button>
            </div>
          )}
          {!scanning && scan.phase !== "idle" && (
            <div className="scan-result-line">
              <span>
                {scan.phase === "done"
                  ? `Scan complete — ${summary.total} album folders`
                  : scan.phase === "cancelled"
                    ? "Scan cancelled"
                    : "Scan failed"}
                {scan.error ? `: ${scan.error}` : ""}
              </span>
              <button className="link-button" onClick={onReset}>
                Clear results
              </button>
            </div>
          )}
        </div>

        <div className="scan-stats">
          <div className="stat">
            <span className="stat-value">{summary.total}</span>
            <span className="stat-label">folders</span>
          </div>
          <div className="stat accent-green">
            <span className="stat-value">{summary.autoMatched}</span>
            <span className="stat-label">auto-approved</span>
          </div>
          <div className="stat accent-amber">
            <span className="stat-value">{summary.needsReview}</span>
            <span className="stat-label">need review</span>
          </div>
          <div className="stat">
            <span className="stat-value">{summary.applied}</span>
            <span className="stat-label">applied</span>
          </div>
        </div>
      </section>

      {albums.length > 0 && (
        <section className="panel albums-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">Match grid / library queue</div>
              <h2>{summary.total} folders scanned</h2>
            </div>
            <div className="panel-actions">
              {reviewable.length > 0 && (
                <button className="button primary" onClick={onReviewAll}>
                  Review {reviewable.length} album{reviewable.length === 1 ? "" : "s"} →
                </button>
              )}
              {pendingApply.length > 0 && (
                <button className="button success" onClick={onApply}>
                  Apply {pendingApply.length} match{pendingApply.length === 1 ? "" : "es"}
                </button>
              )}
            </div>
          </div>

          <div className="toolbar">
            <div className="filter-tabs">
              {FILTERS.map((entry) => (
                <button
                  key={entry.id}
                  className={filter === entry.id ? "filter-tab active" : "filter-tab"}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                  <span className="filter-count">{counts[entry.id]}</span>
                </button>
              ))}
            </div>
            <input
              className="search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter albums…"
              aria-label="Filter albums"
            />
          </div>

          <div className="album-table">
            {visible.length === 0 && (
              <p className="empty-row">
                No albums in this view.{" "}
                {filter !== "all" && (
                  <button className="link-button" onClick={() => setFilter("all")}>
                    Show all
                  </button>
                )}
              </p>
            )}
            {visible.map((album) => {
              const missing = missingTrackCount(album);
              return (
                <button
                  key={album.id}
                  className={`album-row ${album.status === "applied" ? "is-applied" : ""}`}
                  onClick={() => onReview(album.id)}
                >
                  <AlbumThumb album={album} />
                  <div className="album-main">
                    <div className="album-title-line">
                      <span className="album-folder">{album.folderName}</span>
                      <StatusChip status={album.status as AlbumStatus} confidence={album.confidence} />
                      {album.duplicates.length > 0 && (
                        <span className="chip dupe-chip">
                          {album.duplicates.length} dupe{album.duplicates.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {missing > 0 && (
                        <span
                          className="chip missing-chip"
                          title={`${missing} track${missing === 1 ? "" : "s"} on the selected Discogs release have no local file`}
                        >
                          {missing} missing
                        </span>
                      )}
                    </div>
                    <div className="album-sub">
                      {album.hints.artist || album.hints.album ? (
                        <>
                          {album.hints.artist && <span>{album.hints.artist}</span>}
                          {album.hints.album && <span className="album-album">{album.hints.album}</span>}
                          {album.hints.year && <span className="muted">{album.hints.year}</span>}
                        </>
                      ) : (
                        <span className="muted">No artist/album hints</span>
                      )}
                    </div>
                    <div className="album-meta">
                      <span>{album.tracks.length} files</span>
                      {album.candidates[0] && (
                        <span>
                          best: {Math.round(album.confidence ? album.confidence * 100 : album.candidates[0].score * 100)}%
                        </span>
                      )}
                      {album.applied && (
                        <span className="ellipsis applied-path">→ {album.applied.targetFolder}</span>
                      )}
                      {album.error && <span className="error-text ellipsis">{album.error}</span>}
                    </div>
                  </div>
                  <div className="album-side">
                    {album.images.length > 0 && (
                      <span
                        className="local-art-dot"
                        title={`${album.images.length} local artwork file(s)`}
                        style={{ backgroundImage: `url(${artUrl(album.id, 0)})` }}
                      />
                    )}
                    <span className="row-action">
                      {album.status === "applied"
                        ? "View"
                        : album.status === "needs-review" || album.status === "error"
                          ? "Review"
                          : "Edit"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {albums.length === 0 && scan.phase === "idle" && (
        <section className="onboarding-grid">
          <div className="panel step-card">
            <span className="step-number">01</span>
            <h3>Scan</h3>
            <p>
              Album folders can sit directly under the root or inside artist folders. Tags and
              folder names become match hints.
            </p>
          </div>
          <div className="panel step-card">
            <span className="step-number">02</span>
            <h3>Review</h3>
            <p>
              High-confidence matches are accepted automatically. The rest arrive one album at a
              time with covers, tracklists, and folder art.
            </p>
          </div>
          <div className="panel step-card">
            <span className="step-number">03</span>
            <h3>Apply</h3>
            <p>
              Write tags, fetch cover art, dedupe, rename, and copy or move everything into your
              destination using your naming pattern.
            </p>
          </div>
        </section>
      )}

      {pickerOpen && (
        <FolderPicker
          title="Choose your music folder"
          initialPath={root}
          onClose={() => setPickerOpen(false)}
          onSelect={(path) => {
            setRoot(path);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
