import { statusColor, statusLabel } from "../lib/palette";

/** Status rendered as a colored dot plus its label, never color alone. */
export function StatusChip({ status, count }: { status: string; count?: number }) {
  return (
    <span className="status-chip">
      <span className="dot" style={{ background: statusColor(status) }} />
      {statusLabel(status)}
      {count != null && <strong>{count}</strong>}
    </span>
  );
}
