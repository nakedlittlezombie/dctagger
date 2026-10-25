import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";

interface BoundaryState {
  error: Error | null;
}

class RootErrorBoundary extends React.Component<React.PropsWithChildren, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("DCTagger UI crashed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-fallback">
        <div className="boot-fallback-inner">
          <div className="mark">DCTAGGER // UI ERROR</div>
          <h1>The interface hit an error.</h1>
          <p>
            The local API may still be running. Check <a href="/api/health">/api/health</a>, then
            reload this page.
          </p>
          <p className="detail">{this.state.error.stack ?? this.state.error.message}</p>
          <p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 12,
                padding: "8px 14px",
                background: "#06b6d4",
                border: "1px solid #06b6d4",
                borderRadius: 4,
                color: "#02161c",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              RELOAD
            </button>
          </p>
        </div>
      </div>
    );
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
