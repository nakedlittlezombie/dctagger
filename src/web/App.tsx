import { useCallback, useEffect, useRef, useState } from "react";

import type { AlbumFolder, PublicSettings, SessionView } from "../packages/model/types";
import { api } from "./api-client";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { ApplyView } from "./views/ApplyView";
import { LibraryView } from "./views/LibraryView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";

type View = "library" | "review" | "apply" | "settings";

interface Toast {
  message: string;
  kind: "error" | "success";
}

const REVIEW_STATUSES = new Set(["needs-review", "error"]);

function viewFromHash(): { view: View; reviewId: string | null } {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("review/")) {
    return { view: "review", reviewId: decodeURIComponent(hash.slice(7)) };
  }
  if (hash === "apply" || hash === "settings" || hash === "library") {
    return { view: hash, reviewId: null };
  }
  return { view: "library", reviewId: null };
}

export default function App() {
  const initial = viewFromHash();
  const [session, setSession] = useState<SessionView | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [view, setView] = useState<View>(initial.view);
  const [reviewId, setReviewId] = useState<string | null>(initial.reviewId);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const previousScanPhase = useRef<string | null>(null);

  const notify = useCallback((message: string, kind: "error" | "success" = "success") => {
    setToast({ message, kind });
  }, []);

  const refresh = useCallback(async (silent = false) => {
    try {
      const [nextSession, nextSettings] = await Promise.all([api.session(), api.settings()]);
      setSession(nextSession);
      setSettings(nextSettings);
      setLoadError(null);
    } catch (cause) {
      if (!silent) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash();
      setView(next.view);
      setReviewId(next.reviewId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const desired =
      view === "review" && reviewId ? `#review/${encodeURIComponent(reviewId)}` : `#${view}`;
    if (window.location.hash !== desired) {
      window.history.replaceState(null, "", desired);
    }
  }, [view, reviewId]);

  const active = session?.scan.phase === "scanning" || session?.apply.phase === "running";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh(true), 1400);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const reviewQueue = session
    ? session.albums.filter((album) => REVIEW_STATUSES.has(album.status))
    : [];

  // When a scan finishes with work to do, open the first album automatically.
  useEffect(() => {
    const phase = session?.scan.phase;
    if (!phase) return;
    const previous = previousScanPhase.current;
    previousScanPhase.current = phase;
    if (previous === "scanning" && phase === "done") {
      const first = session?.albums.find((album) => REVIEW_STATUSES.has(album.status));
      if (first) {
        setReviewId(first.id);
        setView("review");
      }
    }
  }, [session?.scan.phase, session?.albums]);

  const updateAlbum = (album: AlbumFolder) => {
    setSession((current) =>
      current
        ? {
            ...current,
            albums: current.albums.map((entry) => (entry.id === album.id ? album : entry)),
          }
        : current,
    );
    void refresh(true);
  };

  const advance = async () => {
    try {
      const next = await api.session();
      setSession(next);
      const first = next.albums.find((album) => REVIEW_STATUSES.has(album.status));
      if (first) {
        setReviewId(first.id);
        setView("review");
      } else {
        setReviewId(null);
        setView("library");
      }
    } catch {
      setView("library");
    }
  };

  const scan = async (rootFolder: string) => {
    setBusy(true);
    try {
      const next = await api.scan(rootFolder);
      setSession(next);
      setView("library");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelScan = async () => {
    try {
      setSession(await api.cancelScan());
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const reset = async () => {
    if (!window.confirm("Clear the current scan and all review decisions?")) return;
    try {
      setSession(await api.resetSession());
      setReviewId(null);
      setView("library");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const startApply = async () => {
    setBusy(true);
    try {
      const next = await api.apply();
      setSession(next);
      setView("apply");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelApply = async () => {
    try {
      setSession(await api.cancelApply());
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const navigate = (next: "library" | "apply" | "settings") => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openReviewQueue = () => {
    const first = session?.albums.find((album) => REVIEW_STATUSES.has(album.status));
    if (first) {
      setReviewId(first.id);
      setView("review");
    } else {
      setView("library");
      notify("No albums are waiting for manual review.", "success");
    }
  };

  if (loadError && !session) {
    return (
      <div className="boot-screen">
        <div>
          <h1>DCTagger</h1>
          <p>Could not reach the local API: {loadError}</p>
          <button className="button primary" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!session || !settings) {
    return (
      <div className="boot-screen">
        <div className="boot-disc" />
        <p>Loading library…</p>
      </div>
    );
  }

  const currentAlbum = reviewId
    ? session.albums.find((album) => album.id === reviewId)
    : undefined;
  const queueIndex = currentAlbum
    ? reviewQueue.findIndex((album) => album.id === currentAlbum.id)
    : -1;
  const position =
    queueIndex >= 0
      ? { index: queueIndex + 1, total: reviewQueue.length }
      : undefined;

  const needsReview = session.albums.filter((album) => REVIEW_STATUSES.has(album.status)).length;
  const pendingApply = session.albums.filter(
    (album) => album.status === "auto-matched" || album.status === "confirmed",
  ).length;

  return (
    <div className="app-shell">
      <Header
        view={view}
        hasToken={settings.hasToken}
        userName={settings.discogsUser}
        scanning={session.scan.phase === "scanning"}
        onNavigate={navigate}
      />

      <div className="app-body">
        <Sidebar
          view={view}
          settings={settings}
          scan={session.scan}
          needsReview={needsReview}
          pendingApply={pendingApply}
          onNavigate={navigate}
          onReviewQueue={openReviewQueue}
        />

        <main className="app-main">
          {view === "library" && (
            <LibraryView
              session={session}
              settings={settings}
              busy={busy}
              onScan={(root) => void scan(root)}
              onCancelScan={() => void cancelScan()}
              onReset={() => void reset()}
              onReview={(albumId) => {
                setReviewId(albumId);
                setView("review");
              }}
              onReviewAll={() => {
                const first = reviewQueue[0];
                if (first) {
                  setReviewId(first.id);
                  setView("review");
                }
              }}
              onApply={() => setView("apply")}
              onSettings={() => setView("settings")}
            />
          )}

          {view === "review" && currentAlbum && (
            <ReviewView
              album={currentAlbum}
              settings={settings}
              position={position}
              onChanged={updateAlbum}
              onAdvance={() => void advance()}
              onBack={() => setView("library")}
              onNotify={notify}
            />
          )}

          {view === "review" && !currentAlbum && (
            <div className="view">
              <div className="banner warn">
                <span>That album is no longer in this scan.</span>
                <button className="button small" onClick={() => setView("library")}>
                  Back to library
                </button>
              </div>
            </div>
          )}

          {view === "apply" && (
            <ApplyView
              session={session}
              settings={settings}
              busy={busy}
              onStart={() => void startApply()}
              onCancel={() => void cancelApply()}
              onBack={() => setView("library")}
              onReview={(albumId) => {
                setReviewId(albumId);
                setView("review");
              }}
            />
          )}

          {view === "settings" && (
            <SettingsView
              settings={settings}
              onSaved={(next) => {
                setSettings(next);
                notify("Settings saved.");
                void refresh(true);
              }}
              onBack={() => setView("library")}
            />
          )}
        </main>
      </div>

      {toast && (
        <div className={toast.kind === "error" ? "toast error" : "toast success"}>
          <span>{toast.message}</span>
          <button className="icon-button" onClick={() => setToast(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
