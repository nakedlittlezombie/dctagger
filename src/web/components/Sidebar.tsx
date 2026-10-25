import type { PublicSettings, ScanState } from "../../packages/model/types";

type View = "library" | "review" | "apply" | "settings";

interface SidebarProps {
  view: View;
  settings: PublicSettings;
  scan: ScanState;
  needsReview: number;
  pendingApply: number;
  onNavigate: (view: "library" | "apply" | "settings") => void;
  onReviewQueue: () => void;
}

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined side-icon" aria-hidden="true">
      {name}
    </span>
  );
}

export function Sidebar({
  view,
  settings,
  scan,
  needsReview,
  pendingApply,
  onNavigate,
  onReviewQueue,
}: SidebarProps) {
  const active = view === "review" ? "review" : view;
  return (
    <aside className="sidebar">
      <div className="sidebar-client">
        <div className="sidebar-label">Discogs client</div>
        <div className={settings.hasToken ? "client-state online" : "client-state"}>
          <span className="dot" />
          {settings.hasToken ? "ONLINE" : "NO TOKEN"}
          {settings.discogsUser ? <span className="client-user">@{settings.discogsUser}</span> : null}
        </div>
        <div className="quota-row">
          <span>Rate limit</span>
          <span>60 / MIN</span>
        </div>
        <div className="quota-track">
          <div className="quota-fill" style={{ width: scan.phase === "scanning" ? "72%" : "14%" }} />
        </div>
        <div className="quota-row">
          <span>Image budget</span>
          <span>1,000 / DAY</span>
        </div>
      </div>

      <nav className="side-nav">
        <button
          className={active === "library" ? "side-link active" : "side-link"}
          onClick={() => onNavigate("library")}
        >
          <Icon name="library_music" />
          <span>Library roots</span>
          <span className="side-count">{scan.summary.total || ""}</span>
        </button>
        <button
          className={active === "review" ? "side-link active" : "side-link"}
          onClick={onReviewQueue}
        >
          <Icon name="rule" />
          <span>Match grid</span>
          {needsReview > 0 && <span className="side-count warn">{needsReview}</span>}
        </button>
        <button
          className={active === "apply" ? "side-link active" : "side-link"}
          onClick={() => onNavigate("apply")}
        >
          <Icon name="folder_zip" />
          <span>Execution pipeline</span>
          {pendingApply > 0 && <span className="side-count">{pendingApply}</span>}
        </button>
        <button
          className={active === "settings" ? "side-link active" : "side-link"}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="tune" />
          <span>API settings</span>
        </button>
      </nav>

      {needsReview > 0 && (
        <button className="side-cta" onClick={onReviewQueue}>
          <Icon name="keyboard_voice" />
          <span>
            Open match queue
            <small>{needsReview} album{needsReview === 1 ? "" : "s"} pending</small>
          </span>
          <Icon name="arrow_forward" />
        </button>
      )}

      <div className="sidebar-root">
        <div className="sidebar-label">Source root</div>
        <div className="sidebar-path mono" title={settings.rootFolder || scan.rootFolder}>
          {settings.rootFolder || scan.rootFolder || "Not configured"}
        </div>
        <div className="sidebar-label" style={{ marginTop: 14 }}>
          Engine state
        </div>
        <div className="engine-line">
          <span className={scan.phase === "scanning" ? "dot pulse" : "dot"} />
          {scan.phase === "scanning"
            ? `SCANNING ${scan.done}/${scan.total || "?"}`
            : scan.phase === "done"
              ? "IDLE / READY"
              : scan.phase.toUpperCase()}
        </div>
      </div>

      <div className="sidebar-footer">
        <span>DCTAGGER // LOCAL</span>
        <span className="mono">v0.1</span>
      </div>
    </aside>
  );
}
