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

function DiscIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="logo-mark">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
      <path
        d="M12 2.4a9.6 9.6 0 0 1 8.4 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
        <DiscIcon />
        <span className="brand-stack">
          <span className="brand-word">DCTAGGER //</span>
          <span className="brand-sub">disc tagger workstation</span>
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
