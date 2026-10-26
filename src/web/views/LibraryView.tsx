import { useEffect, useMemo, useState } from "react";

import type { AlbumStatus, PublicSettings, SessionView } from "../../packages/model/types";
import { applyDedupeIgnores } from "../../packages/model/dedupe";
import { applyQueueOptions, type QueueOptions } from "../album-queue";
import { missingTrackCount } from "../album-stats";
import { AlbumThumb } from "../components/AlbumThumb";
import { FolderPicker } from "../components/FolderPicker";
import { FolderTracks } from "../components/FolderTracks";
import { ProgressBar } from "../components/ProgressBar";
import { QueueToolbar } from "../components/QueueToolbar";
import { StatusChip } from "../components/StatusChip";

import { artUrl } from "../api-client";

interface LibraryViewProps {
  session: SessionView;
  settings: PublicSettings;
  busy: boolean;
  queueOptions: QueueOptions;
  onQueueOptionsChange: (patch: Partial<QueueOptions>) => void;
  onScan: (rootFolder: string) => void;
  onCancelScan: () => void;
  onReset: () => void;
  onReview: (albumId: string) => void;
  onReviewAll: () => void;
  onMerge: (albumIds: string[]) => void;
  onApply: () => void;
  onSettings: () => void;
}

export function LibraryView({
  session,
  settings,
  busy,
  queueOptions,
  onQueueOptionsChange,
  onScan,
  onCancelScan,
  onReset,
  onReview,
  onReviewAll,
  onMerge,
  onApply,
  onSettings,
}: LibraryViewProps) {
  const [root, setRoot] = useState(settings.rootFolder || session.scan.rootFolder || "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedMerges, setExpandedMerges] = useState<Set<string>>(() => new Set());

  const toggleMergeExpanded = (key: string) => {
    setExpandedMerges((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!root) setRoot(settings.rootFolder || session.scan.rootFolder || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rootFolder, session.scan.rootFolder]);

  const { scan, albums, mergeSuggestions } = session;  const summary = scan.summary;
  const reviewable = albums.filter(
    (album) => album.status === "needs-review" || album.status === "error",
  );
  const pendingApply = albums.filter(
    (album) => album.status === "auto-matched" || album.status === "confirmed",
  );
  const scanning = scan.phase === "scanning";

  const visible = useMemo(
    () => applyQueueOptions(albums, queueOptions),
    [albums, queueOptions],
  );
  // Suggestions are recomputed by the server, but an apply run can finish while
  // this page is open; hide any suggestion that still points at applied albums.
  const activeMergeSuggestions = useMemo(
    () =>
      mergeSuggestions.filter((suggestion) =>
        suggestion.albumIds.every((id) => {
          const album = albums.find((entry) => entry.id === id);
          return album !== undefined && album.status !== "applied";
        }),
      ),
    [albums, mergeSuggestions],
  );

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

      {activeMergeSuggestions.length > 0 && (
        <section className="panel merge-panel">
          <div className="section-heading tight">
            <div>
              <div className="eyebrow">Folder merge</div>
              <h2>Albums found in several folders</h2>
            </div>
            <span className="chip">
              {activeMergeSuggestions.length} suggestion
              {activeMergeSuggestions.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="muted small">
            These folders look like the same release, either split across discs or duplicated in
            another location. Merge them so every file is matched, deduplicated, and saved as
            one album.
          </p>
          <div className="merge-suggestions">
            {activeMergeSuggestions.map((suggestion) => {
              const key = suggestion.albumIds.join(":");
              const open = expandedMerges.has(key);
              const names = suggestion.albumIds.map(
                (id) => albums.find((album) => album.id === id)?.folderName ?? id,
              );
              const folders = suggestion.albumIds
                .map((id) => albums.find((album) => album.id === id))
                .filter((album): album is NonNullable<typeof album> => album !== undefined);
              return (
                <div key={key} className="merge-suggestion-block">
                  <div className="merge-suggestion">
                    <div className="merge-suggestion-copy">
                      <strong>{names.join(" + ")}</strong>
                      <span className="muted tiny">{suggestion.reason}</span>
                    </div>
                    <div className="merge-suggestion-actions">
                      <button
                        className="link-button"
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleMergeExpanded(key)}
                      >
                        {open ? "Hide tracks" : "Show tracks"}
                      </button>
                      <button
                        className="button small"
                        disabled={busy}
                        onClick={() => onMerge(suggestion.albumIds)}
                      >
                        Merge {suggestion.albumIds.length} folders
                      </button>
                    </div>
                  </div>
                  {open && (
                    <div className="merge-suggestion-tracks">
                      {folders.map((folder) => (
                        <div key={folder.id} className="merge-folder-tracks">
                          <div className="merge-folder-head">
                            <span className="ellipsis mono tiny" title={folder.path}>
                              {folder.folderName}
                            </span>
                            <span className="chip">
                              {folder.tracks.length} file{folder.tracks.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <FolderTracks album={folder} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

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
                  {`Review ${reviewable.length} album${reviewable.length === 1 ? "" : "s"} →`}
                </button>
              )}
              {pendingApply.length > 0 && (
                <button className="button success" onClick={onApply}>
                  {`Apply ${pendingApply.length} ${pendingApply.length === 1 ? "match" : "matches"}`}
                </button>
              )}
            </div>
          </div>

          <QueueToolbar
            albums={albums}
            options={queueOptions}
            onChange={onQueueOptionsChange}
          />

          <div className="album-table">
            {visible.length === 0 && (
              <p className="empty-row">
                No albums in this view.{" "}
                {queueOptions.filter !== "all" && (
                  <button
                    className="link-button"
                    onClick={() => onQueueOptionsChange({ filter: "all" })}
                  >
                    Show all
                  </button>
                )}
                {queueOptions.filter !== "all" && queueOptions.hideMissing && " · "}
                {queueOptions.hideMissing && (
                  <button
                    className="link-button"
                    onClick={() => onQueueOptionsChange({ hideMissing: false })}
                  >
                    Include albums with missing tracks
                  </button>
                )}
              </p>
            )}
            {visible.map((album) => {
              const missing = missingTrackCount(album);
              const duplicateGroups = applyDedupeIgnores(album.duplicates, album.dedupeIgnores).length;
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
                      {duplicateGroups > 0 && (
                        <span className="chip dupe-chip">
                          {duplicateGroups} dupe{duplicateGroups === 1 ? "" : "s"}
                        </span>
                      )}
                      {album.sourceFolders && album.sourceFolders.length > 1 && (
                        <span
                          className="chip merge-chip"
                          title={album.sourceFolders.join("\n")}
                        >
                          {album.sourceFolders.length} folders
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
