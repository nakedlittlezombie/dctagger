import type { AlbumFolder, PublicSettings, SessionView } from "../../packages/model/types";
import { renderFileName, renderFolderPath } from "../../packages/naming";
import { missingTrackCount } from "../album-stats";
import { AlbumThumb } from "../components/AlbumThumb";
import { ProgressBar } from "../components/ProgressBar";

interface ApplyViewProps {
  session: SessionView;
  settings: PublicSettings;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onBack: () => void;
  onReview: (albumId: string) => void;
}

function targetPreview(albums: AlbumFolder[], settings: PublicSettings): string | null {
  const album = albums[0];
  if (!album) return null;
  const candidate =
    [...album.candidates, ...album.deezerCandidates].find(
      (entry) => entry.release.id === album.selectedReleaseId,
    ) ?? album.candidates[0] ?? album.deezerCandidates[0];
  if (!candidate) return album.folderName;
  const release = candidate.release;
  const artist = release.artists.map((entry) => entry.name).join(" & ") || "Unknown Artist";
  const folder = renderFolderPath(settings.folderPattern, {
    artist,
    albumartist: artist,
    album: release.title,
    year: release.year ?? album.hints.year,
    label: release.labels[0]?.name,
    catno: release.labels[0]?.catno,
    releaseid: release.id,
  });
  const track = release.tracklist[0];
  const file = track
    ? renderFileName(settings.trackPattern, {
        artist: track.artists[0] ?? artist,
        albumartist: artist,
        album: release.title,
        year: release.year,
        title: track.title,
        track: track.trackNumber,
        tracktotal: release.tracklist.filter((entry) => entry.disc === track.disc).length,
        disc: track.disc,
        disctotal: Math.max(1, ...release.tracklist.map((entry) => entry.disc)),
        label: release.labels[0]?.name,
        catno: release.labels[0]?.catno,
        releaseid: release.id,
      })
    : "01 - Track";
  return `${settings.destinationFolder}/${folder}/${file}.flac`;
}

export function ApplyView({
  session,
  settings,
  busy,
  onStart,
  onCancel,
  onBack,
  onReview,
}: ApplyViewProps) {
  const { apply } = session;
  const pending = session.albums.filter(
    (album) => album.status === "auto-matched" || album.status === "confirmed",
  );
  const applied = session.albums.filter((album) => album.status === "applied");
  const running = apply.phase === "running";
  const preview = targetPreview(pending.length > 0 ? pending : applied, settings);
  const pendingFiles = pending.reduce(
    (sum, album) =>
      sum + album.mapping.filter((assignment) => assignment.trackIndex !== null).length,
    0,
  );

  const start = () => {
    const warnings: string[] = [];
    if (settings.transferMode === "move") {
      warnings.push("Move mode will move files out of the source folders.");
    }
    if (settings.dedupeMode === "delete") {
      warnings.push("Duplicate losers will be permanently deleted.");
    }
    if (warnings.length > 0 && !window.confirm(`${warnings.join("\n")}\n\nContinue?`)) return;
    onStart();
  };

  return (
    <div className="view apply-view">
      <div className="view-head">
        <div>
          <button className="back-link" onClick={onBack}>
            ← Library
          </button>
          <h1>Apply matches</h1>
          <p className="muted">
            Tags are written, art is fetched, duplicates are resolved, and files are named into
            your destination.
          </p>
        </div>
        {!running && pending.length > 0 && (
          <button className="button primary" disabled={busy} onClick={start}>
            {`Apply ${pending.length} album${pending.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      <section className="panel apply-summary">
        <div className="pipeline-grid">
          <div className="pipeline-card">
            <div className="pipeline-head">
              <span className="step">01</span>
              <h3>Metadata schema</h3>
              <span className="chip status-confirmed">canonical</span>
            </div>
            <div className="pipeline-list">
              <span>Title · artist · album · album artist</span>
              <span>Track / disc numbers · totals</span>
              <span>Year · genre · style</span>
              <span>Label · catalog number</span>
              <span className="mono">Discogs release ID in comment</span>
            </div>
            <div className="pipeline-foot">Writer: taglib · all supported formats</div>
          </div>

          <div className="pipeline-card">
            <div className="pipeline-head">
              <span className="step">02</span>
              <h3>Artwork &amp; assets</h3>
              <span className="chip">{settings.coverMode}</span>
            </div>
            <div className="pipeline-list">
              <span>
                {settings.coverMode === "both"
                  ? "Embed front cover + save cover file"
                  : settings.coverMode === "embed"
                    ? "Embed front cover in each file"
                    : "Save cover file beside tracks"}
              </span>
              <span>Local folder art replaces Discogs art</span>
              <span>Duplicates: {settings.dedupeMode}</span>
              <span>Existing extras (cue, log, art) transferred</span>
              <span>Unmapped audio left in the source</span>
            </div>
            <div className="pipeline-foot">
              Image cache + 1,000/day cap · falls back to local art
            </div>
          </div>

          <div className="pipeline-card">
            <div className="pipeline-head">
              <span className="step">03</span>
              <h3>File routing &amp; vault</h3>
              <span className="chip">{settings.transferMode}</span>
            </div>
            <div className="pipeline-list">
              <span className="mono ellipsis" title={settings.destinationFolder}>
                {settings.destinationFolder || "Destination not set"}
              </span>
              <span className="mono ellipsis">/{settings.folderPattern}</span>
              <span className="mono ellipsis">{settings.trackPattern}.[ext]</span>
              <span>{settings.transferMode === "move" ? "Source album folders are emptied" : "Source library stays untouched"}</span>
            </div>
            <div className="pipeline-foot">Path tokens sanitized · destination-contained</div>
          </div>
        </div>

        {preview && (
          <div className="target-preview">
            <span className="eyebrow">Example output</span>
            <code>{preview}</code>
          </div>
        )}
      </section>

      {running && (
        <section className="panel job-panel">
          <div className="section-heading">
            <div>
              <h2>Tagging and transferring</h2>
              <p className="muted small">{apply.current ? `Working on ${apply.current}` : "Preparing…"}</p>
            </div>
            <button className="button ghost small" onClick={onCancel}>
              Cancel after current album
            </button>
          </div>
          <ProgressBar
            value={apply.done}
            max={apply.total || 1}
            label={`Applied ${apply.done} of ${apply.total} albums`}
          />
          <div className="job-results">
            {apply.results.map((result) => (
              <div key={result.albumId} className={result.ok ? "job-result ok" : "job-result failed"}>
                <span className="job-result-icon">{result.ok ? "✓" : "!"}</span>
                <span className="ellipsis">{result.folderName}</span>
                <span className="muted small">
                  {result.ok
                    ? `${result.tagged} tagged${result.skipped ? ` · ${result.skipped} left in source` : ""}`
                    : result.errors[0] ?? "Failed"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!running && apply.phase !== "idle" && (
        <section className="panel job-panel">
          <div className="section-heading">
            <div>
              <h2>
                {apply.phase === "done"
                  ? "Apply complete"
                  : apply.phase === "cancelled"
                    ? "Apply cancelled"
                    : "Apply failed"}
              </h2>
              <p className="muted small">
                {apply.results.filter((result) => result.ok).length} succeeded ·{" "}
                {apply.results.filter((result) => !result.ok).length} with issues
                {apply.error ? ` · ${apply.error}` : ""}
              </p>
            </div>
            <button className="button ghost small" onClick={onBack}>
              Back to library
            </button>
          </div>
          <div className="job-results">
            {apply.results.map((result) => (
              <div key={result.albumId} className={result.ok ? "job-result ok" : "job-result failed"}>
                <span className="job-result-icon">{result.ok ? "✓" : "!"}</span>
                <div className="job-result-copy">
                  <span className="ellipsis">{result.folderName}</span>
                  <span className="muted tiny ellipsis">
                    {result.ok
                      ? `${result.files} files · ${result.tagged} tagged${
                          result.deduplicated
                            ? ` · ${result.deduplicated} duplicate${result.deduplicated === 1 ? "" : "s"}`
                            : ""
                        }${result.skipped ? ` · ${result.skipped} unmatched left` : ""} → ${result.targetFolder}`
                      : result.errors.join(" · ")}
                  </span>
                </div>
                <button
                  className="link-button"
                  onClick={() => {
                    const album = session.albums.find((entry) => entry.id === result.albumId);
                    if (album) onReview(album.id);
                  }}
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!running && (
        <section className="panel pending-panel">
          <div className="section-heading">
            <div>
              <h2>Queued for apply</h2>
              <p className="muted small">
                {pending.length} confirmed or auto-matched {pending.length === 1 ? "album" : "albums"}.
              </p>
            </div>
          </div>
          {pending.length === 0 ? (
            <div className="empty-row">
              Nothing queued. Confirm matches in the library first.
              <button className="link-button" onClick={onBack}>
                Review albums
              </button>
            </div>
          ) : (
            <>
              <div className="pending-list">
                {pending.map((album) => {
                  const candidate =
                    [...album.candidates, ...album.deezerCandidates].find(
                      (entry) => entry.release.id === album.selectedReleaseId,
                    ) ??
                    album.candidates[0] ??
                    album.deezerCandidates[0];
                  const missing = missingTrackCount(album);
                  return (
                    <button
                      key={album.id}
                      className="pending-row"
                      onClick={() => onReview(album.id)}
                    >
                      <AlbumThumb album={album} />
                      <div className="pending-copy">
                        <span className="ellipsis">{album.folderName}</span>
                        <span className="muted small ellipsis">
                          {candidate
                            ? `${candidate.release.artists.map((artist) => artist.name).join(", ")} — ${candidate.release.title}`
                            : "No release selected"}
                        </span>
                      </div>
                      {missing > 0 && (
                        <span
                          className="chip missing-chip"
                          title={`${missing} track${missing === 1 ? "" : "s"} on the selected release have no local file`}
                        >
                          {missing} missing
                        </span>
                      )}
                      <span className="chip status-automatched">
                        {album.status === "auto-matched" ? "Auto" : "Confirmed"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="pipeline-cta">
                <button className="button primary" disabled={busy} onClick={start}>
                  Apply all tags &amp; execute pipeline ({pendingFiles} files) →
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
