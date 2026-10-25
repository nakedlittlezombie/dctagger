import { useEffect, useState } from "react";

import type { FolderListing } from "../../packages/model/types";
import { api } from "../api-client";

interface FolderPickerProps {
  title: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ title, initialPath, onSelect, onClose }: FolderPickerProps) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [pathDraft, setPathDraft] = useState(initialPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.listFolders(target || initialPath || undefined);
      setListing(next);
      setPathDraft(next.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div className="modal folder-picker" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form
          className="path-form"
          onSubmit={(event) => {
            event.preventDefault();
            void load(pathDraft);
          }}
        >
          <input
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            spellCheck={false}
            aria-label="Folder path"
          />
          <button className="button ghost" type="submit">
            Go
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}

        <div className="folder-list">
          {loading && <p className="muted">Reading folder…</p>}
          {!loading && listing && (
            <>
              {listing.parent && (
                <button className="folder-row parent" onClick={() => void load(listing.parent ?? undefined)}>
                  <span className="folder-icon">↑</span> Parent folder
                </button>
              )}
              {listing.directories.length === 0 && (
                <p className="muted">No subfolders here.</p>
              )}
              {listing.directories.map((directory) => (
                <button
                  key={directory}
                  className="folder-row"
                  onClick={() => void load(`${listing.path}/${directory}`)}
                >
                  <span className="folder-icon">▸</span> {directory}
                </button>
              ))}
            </>
          )}
        </div>

        {listing && (
          <div className="modal-foot">
            <span className="muted small">
              {listing.audioFiles > 0
                ? `${listing.audioFiles} audio file${listing.audioFiles === 1 ? "" : "s"} directly here`
                : "No audio files directly here"}
            </span>
            <button className="button primary" onClick={() => onSelect(listing.path)}>
              Use this folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
