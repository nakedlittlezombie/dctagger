import type { AlbumStatus } from "../../packages/model/types";

const LABELS: Record<AlbumStatus, string> = {
  scanning: "Scanning",
  "auto-matched": "Auto-matched",
  "needs-review": "Needs review",
  confirmed: "Confirmed",
  skipped: "Skipped",
  applied: "Applied",
  error: "Error",
};

export function StatusChip({ status, confidence }: { status: AlbumStatus; confidence?: number }) {
  return (
    <span className={`chip status-${status.replace(/[^a-z]/g, "")}`}>
      {LABELS[status]}
      {status === "auto-matched" && confidence !== undefined
        ? ` · ${Math.round(confidence * 100)}%`
        : ""}
    </span>
  );
}
