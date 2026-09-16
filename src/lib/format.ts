/** Small display formatters shared across pages. */

export function fmtRuntime(sec?: number | null): string {
  if (sec == null) return "–";
  if (sec < 90) return `${Math.round(sec)} s`;
  if (sec < 5400) return `${(sec / 60).toFixed(0)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

export function fmtMeters(m?: number | null, digits = 2): string {
  return m == null ? "–" : `${m.toFixed(digits)} m`;
}

export function fmtMem(mb?: number | null): string {
  if (mb == null) return "–";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

export function fmtWhen(iso?: string | null): string {
  if (!iso) return "–";
  return iso.slice(0, 16).replace("T", " ");
}

export function fmtCount(n?: number | null): string {
  return n == null ? "–" : n.toLocaleString("en-US");
}

/** Seconds relative to closest approach -> "-132 h" / "+18 h". */
export function fmtRelHours(sec: number): string {
  const h = sec / 3600;
  const sign = h < 0 ? "−" : "+";
  return `${sign}${Math.abs(h).toFixed(0)} h`;
}
