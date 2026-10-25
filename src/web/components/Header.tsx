type View = "library" | "review" | "apply" | "settings";

interface HeaderProps {
  view: View;
  hasToken: boolean;
  userName?: string;
  scanning: boolean;
  onNavigate: (view: "library" | "settings") => void;
}

const VIEW_LABELS: Record<View, string> = {
  library: "Ingestion controller",
  review: "Album resolution",
  apply: "Batch pipeline",
  settings: "API settings",
};

export function Header({
  view,
  hasToken,
  userName,
  scanning,
  onNavigate,
}: HeaderProps) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("library")} aria-label="DCTagger home">
        <img src="dctagger.png" alt="" className="brand-logo" />
        <span className="brand-stack">
          <span className="brand-word">DCTAGGER //</span>
        </span>
      </button>

      <div className="topbar-center">
        <span className={scanning ? "engine-chip scanning" : "engine-chip"}>
          <span className="dot" />
          {scanning ? "SCANNING" : "ENGINE READY"}
        </span>
        <span className="topbar-crumb mono">/ {VIEW_LABELS[view]}</span>
      </div>

      <div className="topbar-actions">
        <button
          className={hasToken ? "token-pill connected" : "token-pill"}
          onClick={() => onNavigate("settings")}
          title={hasToken ? "Discogs token configured" : "Add a Discogs token"}
        >
          <span className="dot" />
          {hasToken ? (userName ? `@${userName}` : "API CONNECTED") : "API OFFLINE"}
        </button>
        <button className="button small primary" onClick={() => onNavigate("library")}>
          <span className="material-symbols-outlined">radar</span>
          Scan directory
        </button>
      </div>
    </header>
  );
}
