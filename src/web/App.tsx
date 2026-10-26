import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AlbumFolder, PublicSettings, SessionView } from "../packages/model/types";
import {
  DEFAULT_QUEUE_OPTIONS,
  applyQueueOptions,
  isReviewAlbum,
  loadQueueOptions,
  neighborInQueue,
  queueIndex,
  saveQueueOptions,
  type QueueOptions,
} from "./album-queue";
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
  const [queueOptions, setQueueOptions] = useState<QueueOptions>(() => loadQueueOptions());
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

  useEffect(() => {
    saveQueueOptions(queueOptions);
  }, [queueOptions]);

  const albums = session?.albums;
  const queue = useMemo(
    () => applyQueueOptions(albums ?? [], queueOptions),
    [albums, queueOptions],
  );
  const reviewQueue = useMemo(() => queue.filter(isReviewAlbum), [queue]);

  // When a scan finishes with work to do, open the first album automatically.
  useEffect(() => {
    const phase = session?.scan.phase;
    if (!phase) return;
    const previous = previousScanPhase.current;
    previousScanPhase.current = phase;
    if (previous === "scanning" && phase === "done") {
      const first = reviewQueue[0];
      if (first) {
        setReviewId(first.id);
        setView("review");
      }
    }
  }, [session?.scan.phase, reviewQueue]);

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

  const openAlbum = useCallback((albumId: string) => {
    setReviewId(albumId);
    setView("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** Fold several scanned folders into one album and open it for review. */
  const mergeFolders = useCallback(
    async (albumIds: string[]) => {
      setBusy(true);
      try {
        const next = await api.mergeAlbums(albumIds);
        setSession(next);
        const target = next.albums.find((album) => album.id === albumIds[0]);
        if (target) openAlbum(target.id);
        notify(
          `Merged ${albumIds.length} folders into one album. Review the match, then confirm.`,
        );
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : String(cause), "error");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [notify, openAlbum],
  );

  /** Put a merged album's folders back as separate queue entries. */
  const unmergeFolders = useCallback(
    async (albumId: string) => {
      setBusy(true);
      try {
        const next = await api.unmergeAlbum(albumId);
        setSession(next);
        const target = next.albums.find((album) => album.id === albumId);
        if (target) {
          openAlbum(target.id);
        } else {
          setReviewId(null);
          setView("library");
        }
        notify("Split the merged album back into its folders.");
      } catch (cause) {
        notify(cause instanceof Error ? cause.message : String(cause), "error");
        throw cause;
      } finally {
        setBusy(false);
      }
    },
    [notify, openAlbum],
  );

  /**
   * Change the shared queue options. If the album on screen falls outside the
   * new queue, step to the first album that is still in it.
   */
  const updateQueueOptions = (patch: Partial<QueueOptions>) => {
    const next = { ...queueOptions, ...patch };
    setQueueOptions(next);
    if (view !== "review" || !reviewId) return;
    const nextQueue = applyQueueOptions(albums ?? [], next);
    if (!nextQueue.some((album) => album.id === reviewId)) {
      setReviewId(nextQueue[0]?.id ?? null);
    }
  };

  const resetQueueOptions = () => {
    const next = { ...DEFAULT_QUEUE_OPTIONS };
    setQueueOptions(next);
    const first = applyQueueOptions(albums ?? [], next)[0];
    if (first) setReviewId(first.id);
  };

  const advance = async () => {
    const preferredId = neighborInQueue(queue, reviewId)?.id;
    try {
      const next = await api.session();
      setSession(next);
      const nextQueue = applyQueueOptions(next.albums, queueOptions);
      const target =
        nextQueue.find((album) => album.id === preferredId) ??
        nextQueue.find(isReviewAlbum) ??
        nextQueue[0];
      if (target) {
        openAlbum(target.id);
      } else {
        setReviewId(null);
        setView("library");
      }
    } catch {
      setView("library");
    }
  };

  const stepQueue = (direction: -1 | 1) => {
    const index = queueIndex(queue, reviewId);
    const target = index === -1 ? undefined : queue[index + direction];
    if (target) openAlbum(target.id);
  };

  const startReviewAll = () => {
    const next = { ...queueOptions, filter: "review" as const };
    const first = applyQueueOptions(albums ?? [], next)[0];
    if (!first) {
      notify("No albums match the current queue filters.", "error");
      return;
    }
    setQueueOptions(next);
    openAlbum(first.id);
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
    const target =
      queue.find((album) => album.id === reviewId) ??
      reviewQueue[0] ??
      queue[0];
    if (target) {
      openAlbum(target.id);
    } else {
      setView("library");
      notify("No albums match the current queue filters.", "success");
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
  const currentQueueIndex = currentAlbum ? queueIndex(queue, currentAlbum.id) : -1;
  const position =
    currentQueueIndex >= 0
      ? { index: currentQueueIndex + 1, total: queue.length }
      : undefined;

  const needsReview = session.albums.filter((album) => isReviewAlbum(album)).length;
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
              queueOptions={queueOptions}
              onQueueOptionsChange={updateQueueOptions}
              onScan={(root) => void scan(root)}
              onCancelScan={() => void cancelScan()}
              onReset={() => void reset()}
              onReview={(albumId) => openAlbum(albumId)}
              onReviewAll={startReviewAll}
              onMerge={(albumIds) => void mergeFolders(albumIds).catch(() => undefined)}
              onApply={() => setView("apply")}
              onSettings={() => setView("settings")}
            />
          )}

          {view === "review" && currentAlbum && (
            <ReviewView
              album={currentAlbum}
              albums={session.albums}
              mergeSuggestions={session.mergeSuggestions}
              settings={settings}
              position={position}
              queueOptions={queueOptions}
              onQueueOptionsChange={updateQueueOptions}
              onPrev={() => stepQueue(-1)}
              onNext={() => stepQueue(1)}
              onChanged={updateAlbum}
              onAdvance={() => void advance()}
              onBack={() => setView("library")}
              onMerge={mergeFolders}
              onUnmerge={unmergeFolders}
              onNotify={notify}
            />
          )}

          {view === "review" && !currentAlbum && (
            <div className="view">
              <div className="banner warn">
                <span>
                  {session.albums.length === 0
                    ? "Scan a library folder to build the match queue."
                    : "No albums match the current queue filters, or that album is no longer in this scan."}
                </span>
                {session.albums.length > 0 && (
                  <button className="button small" onClick={resetQueueOptions}>
                    Show all albums
                  </button>
                )}
                <button className="button small ghost" onClick={() => setView("library")}>
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
              onReview={(albumId) => openAlbum(albumId)}
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
