import { useEffect, useState } from "react";

import type { CoverMode, DedupeMode, PublicSettings, TransferMode } from "../../packages/model/types";
import {
  NAMING_TOKENS,
  renderFileName,
  renderFolderPath,
  SAMPLE_CONTEXT,
} from "../../packages/naming";
import { api } from "../api-client";
import { FolderPicker } from "../components/FolderPicker";

interface SettingsViewProps {
  settings: PublicSettings;
  onSaved: (settings: PublicSettings) => void;
  onBack: () => void;
}

interface Draft {
  rootFolder: string;
  destinationFolder: string;
  autoThreshold: number;
  autoMargin: number;
  candidateCount: number;
  coverMode: CoverMode;
  transferMode: TransferMode;
  dedupeMode: DedupeMode;
  folderPattern: string;
  trackPattern: string;
}

function draftOf(settings: PublicSettings): Draft {
  return {
    rootFolder: settings.rootFolder,
    destinationFolder: settings.destinationFolder,
    autoThreshold: settings.autoThreshold,
    autoMargin: settings.autoMargin,
    candidateCount: settings.candidateCount,
    coverMode: settings.coverMode,
    transferMode: settings.transferMode,
    dedupeMode: settings.dedupeMode,
    folderPattern: settings.folderPattern,
    trackPattern: settings.trackPattern,
  };
}

const COVER_MODES: Array<{ id: CoverMode; title: string; body: string }> = [
  { id: "copy", title: "Save file", body: "Write cover.jpg beside the tracks." },
  { id: "embed", title: "Embed", body: "Write art into each audio file's tags." },
  { id: "both", title: "Both", body: "Embed art and keep a cover file." },
];

const TRANSFER_MODES: Array<{ id: TransferMode; title: string; body: string }> = [
  { id: "copy", title: "Copy", body: "Leave the original folder untouched." },
  { id: "move", title: "Move", body: "Move files and remove the emptied source folder." },
];

const DEDUPE_MODES: Array<{ id: DedupeMode; title: string; body: string }> = [
  { id: "off", title: "Off", body: "Leave duplicate copies untouched in the source." },
  { id: "hide", title: "Hide", body: "Leave losing copies in the source; don't transfer them." },
  { id: "delete", title: "Delete", body: "Delete losing copies after the keeper is transferred." },
];

function insideRoot(destination: string, root: string): boolean {
  if (!destination || !root) return false;
  const normalise = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const dest = normalise(destination);
  const base = normalise(root);
  return dest === base || dest.startsWith(`${base}/`);
}

export function SettingsView({ settings, onSaved, onBack }: SettingsViewProps) {
  const [draft, setDraft] = useState<Draft>(draftOf(settings));
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"root" | "destination" | null>(null);

  useEffect(() => {
    setDraft(draftOf(settings));
  }, [settings]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (extra?: { clearToken?: boolean }) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.saveSettings({
        ...draft,
        ...(token.trim() ? { discogsToken: token.trim() } : {}),
        ...(extra?.clearToken ? { clearToken: true } : {}),
      });
      setToken("");
      onSaved(next);
      setMessage(
        extra?.clearToken ? "Token cleared. Settings saved." : "Settings saved.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    const typedToken = token.trim();
    try {
      const identity = await api.testDiscogs(typedToken || undefined);
      if (typedToken) {
        // Don't leave a verified token unsaved: scanning would keep using the
        // previous token and could fail with a misleading 401.
        const next = await api.saveSettings({ ...draft, discogsToken: typedToken });
        setToken("");
        onSaved(next);
        setMessage(
          `Connected as @${identity.username}. Token and settings saved — scanning will use it now.`,
        );
      } else {
        setMessage(`Connected as @${identity.username}.`);
        onSaved(await api.settings());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  };

  const folderPreview = renderFolderPath(draft.folderPattern || "{album}", SAMPLE_CONTEXT);
  const filePreview = renderFileName(draft.trackPattern || "{title}", SAMPLE_CONTEXT);

  return (
    <div className="view settings-view">
      <div className="view-head">
        <div>
          <button className="back-link" onClick={onBack}>
            ← Library
          </button>
          <h1>Settings</h1>
          <p className="muted">
            Discogs access, matching confidence, naming, and how files land in your destination.
          </p>
        </div>
        <button className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      {(error || message) && (
        <div className={error ? "banner error" : "banner success"}>
          <span>{error ?? message}</span>
        </div>
      )}

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Discogs access</h2>
          <span className={settings.hasToken ? "chip status-automatched" : "chip"}>
            {settings.hasToken ? `Connected${settings.discogsUser ? ` as @${settings.discogsUser}` : ""}` : "No token"}
          </span>
        </div>
        <p className="muted small">
          Discogs requires a personal access token for search. Generate one at{" "}
          <a href="https://www.discogs.com/settings/developers" target="_blank" rel="noreferrer">
            discogs.com/settings/developers
          </a>
          . The token is stored locally in <code>.dctagger/settings.json</code>.
        </p>
        <p className="muted small">
          Paste the <strong>Personal Access Token</strong> (not the Consumer Key or Consumer
          Secret). The value should be the token itself — no <code>Discogs token=</code> prefix.
        </p>
        <div className="inline-form">
          <div className="token-input">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={settings.hasToken ? "Token stored — enter a new one to replace" : "Paste personal access token"}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="link-button" onClick={() => setShowToken((value) => !value)}>
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <button className="button ghost" disabled={testing || (!token.trim() && !settings.hasToken)} onClick={() => void test()}>
            {testing ? "Testing…" : token.trim() ? "Test & save" : "Test connection"}
          </button>
          {settings.hasToken && (
            <button
              className="button danger-ghost"
              disabled={saving}
              onClick={() => {
                if (window.confirm("Remove the stored Discogs token?")) void save({ clearToken: true });
              }}
            >
              Clear token
            </button>
          )}
        </div>
        {settings.hasToken && settings.tokenHint && (
          <p className="muted tiny mono">
            Stored token {settings.tokenHint}
            {settings.tokenLength ? ` · ${settings.tokenLength} chars` : ""}
          </p>
        )}
      </section>

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Folders</h2>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Music library (scan root)</span>
            <div className="field-with-button">
              <input
                value={draft.rootFolder}
                onChange={(event) => set("rootFolder", event.target.value)}
                placeholder="/home/you/Music"
                spellCheck={false}
              />
              <button className="button ghost small" onClick={() => setPicker("root")}>
                Browse
              </button>
            </div>
          </label>
          <label className="field">
            <span>Destination folder</span>
            <div className="field-with-button">
              <input
                value={draft.destinationFolder}
                onChange={(event) => set("destinationFolder", event.target.value)}
                placeholder="/home/you/Music/Tagged"
                spellCheck={false}
              />
              <button className="button ghost small" onClick={() => setPicker("destination")}>
                Browse
              </button>
            </div>
          </label>
        </div>
        {insideRoot(draft.destinationFolder, draft.rootFolder) && (
          <p className="warn-text small">
            The destination is inside the scan root. A rescan may pick up tagged copies as new
            albums; consider a destination outside the library.
          </p>
        )}
      </section>

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Matching</h2>
          <span className="muted small">Auto-match only when these bars are cleared</span>
        </div>
        <div className="field-grid three">
          <label className="field">
            <span>
              Minimum confidence <strong>{Math.round(draft.autoThreshold * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              value={draft.autoThreshold}
              onChange={(event) => set("autoThreshold", Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>
              Lead over runner-up <strong>{Math.round(draft.autoMargin * 100)}%</strong>
            </span>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={draft.autoMargin}
              onChange={(event) => set("autoMargin", Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Top matches to fetch</span>
            <select
              value={draft.candidateCount}
              onChange={(event) => set("candidateCount", Number(event.target.value))}
            >
              {[2, 3, 4, 5, 6, 8].map((count) => (
                <option key={count} value={count}>
                  {count} releases
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">
          A match is auto-accepted only when confidence clears the threshold, it leads the
          runner-up by the margin, and its track count matches your folder. Discogs allows 60
          authenticated requests per minute (25 unauthenticated); DCTagger spaces API calls to
          stay under that, caches responses for 7 days, and limits image downloads to 1,000 per
          day. Cached images don’t count against the image budget.
        </p>
        <p className="muted small">
          Genre fallback: Discogs genres/styles → Deezer album genre → MusicBrainz genres →
          existing local genre tags. Deezer is queried only when Discogs has no genre or style;
          MusicBrainz only when both Discogs and Deezer are empty. Results are cached for 30
          days.
        </p>
      </section>

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Duplicates</h2>
        </div>
        <div className="option-grid">
          {DEDUPE_MODES.map((mode) => (
            <button
              key={mode.id}
              className={draft.dedupeMode === mode.id ? "option-card active" : "option-card"}
              onClick={() => set("dedupeMode", mode.id)}
            >
              <strong>{mode.title}</strong>
              <span>{mode.body}</span>
            </button>
          ))}
        </div>
        <p className="muted small">
          Duplicates are detected per folder by track number/title and duration. The copy with the
          best audio quality (lossless, bit depth, sample rate, bitrate) wins. You can override the
          keeper on any album review screen.
        </p>
      </section>

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Output</h2>
        </div>
        <div className="option-grid">
          {TRANSFER_MODES.map((mode) => (
            <button
              key={mode.id}
              className={draft.transferMode === mode.id ? "option-card active" : "option-card"}
              onClick={() => set("transferMode", mode.id)}
            >
              <strong>{mode.title}</strong>
              <span>{mode.body}</span>
            </button>
          ))}
        </div>
        <div className="option-grid">
          {COVER_MODES.map((mode) => (
            <button
              key={mode.id}
              className={draft.coverMode === mode.id ? "option-card active" : "option-card"}
              onClick={() => set("coverMode", mode.id)}
            >
              <strong>{mode.title}</strong>
              <span>{mode.body}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel settings-section">
        <div className="section-heading">
          <h2>Naming pattern</h2>
          <span className="muted small">Tokens: {NAMING_TOKENS.map((tokenName) => `{${tokenName}}`).join(" ")}</span>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Album folder</span>
            <input
              value={draft.folderPattern}
              onChange={(event) => set("folderPattern", event.target.value)}
              spellCheck={false}
              className="mono"
            />
            <span className="preview-line">{folderPreview}</span>
          </label>
          <label className="field">
            <span>Track file</span>
            <input
              value={draft.trackPattern}
              onChange={(event) => set("trackPattern", event.target.value)}
              spellCheck={false}
              className="mono"
            />
            <span className="preview-line">
              {filePreview}.flac
            </span>
          </label>
        </div>
        <p className="muted small">
          Use <code>{"{track:02}"}</code> for zero-padded numbers. A folder pattern can contain
          <code>/</code> to create subfolders. Missing tags are dropped, and illegal filename
          characters are sanitized.
        </p>
      </section>

      <div className="settings-save-bar">
        <span className="muted small">
          {settings.hasToken ? "Discogs token stored locally." : "A token is required for matching."}
        </span>
        <button className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      {picker && (
        <FolderPicker
          title={picker === "root" ? "Choose your music folder" : "Choose a destination folder"}
          initialPath={picker === "root" ? draft.rootFolder : draft.destinationFolder}
          onClose={() => setPicker(null)}
          onSelect={(path) => {
            if (picker === "root") set("rootFolder", path);
            else set("destinationFolder", path);
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
