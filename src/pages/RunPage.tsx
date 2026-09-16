import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EChart } from "../components/EChart";
import { ScopeChips } from "../components/ScopeChips";
import { getManifest, type RunManifest, type StormRec } from "../lib/data";
import { chartTheme } from "../lib/palette";
import { PROJECT_VIEWS } from "../projects";

const RUNTIME_BINS = [
  { label: "<1 min", max: 60 },
  { label: "1–5 min", max: 300 },
  { label: "5–15 min", max: 900 },
  { label: "15–60 min", max: 3600 },
  { label: "1–3 h", max: 10800 },
  { label: ">3 h", max: Infinity },
];

function runtimeHistogram(storms: StormRec[]): EChartsOption {
  const t = chartTheme();
  const counts = RUNTIME_BINS.map(() => 0);
  for (const s of storms) {
    const rt = s.runtime_seconds;
    if (rt == null) continue;
    counts[RUNTIME_BINS.findIndex((b) => rt < b.max)]++;
  }
  return {
    backgroundColor: "transparent",
    grid: { left: 44, right: 12, top: 18, bottom: 28 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "category",
      data: RUNTIME_BINS.map((b) => b.label),
      axisLine: { lineStyle: { color: t.baseline } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.textMuted, fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        data: counts,
        itemStyle: { color: t.series1, borderRadius: [4, 4, 0, 0] },
        barCategoryGap: "35%",
        name: "storms",
      },
    ],
  };
}

export function RunPage() {
  const { projectId = "", runId = "" } = useParams();
  const view = PROJECT_VIEWS[projectId];
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [manifest, setManifest] = useState<RunManifest>();
  const [error, setError] = useState<string>();
  const [sortKey, setSortKey] = useState<keyof StormRec | undefined>(view?.defaultSort);
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const query = searchParams.get("q") ?? "";
  const statusFilter = searchParams.get("status") ?? "all";

  useEffect(() => {
    setManifest(undefined);
    getManifest(projectId, runId).then(setManifest, (e) => setError(String(e)));
  }, [projectId, runId]);

  const filtered = useMemo(() => {
    if (!manifest) return [];
    const q = query.trim().toLowerCase();
    let rows = manifest.storms;
    if (statusFilter !== "all") rows = rows.filter((s) => s.status === statusFilter);
    if (q) rows = rows.filter((s) => s.name.toLowerCase().includes(q) || s.sid.includes(q));
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortKey] as number | string | undefined;
      const bv = b[sortKey] as number | string | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
    });
  }, [manifest, query, statusFilter, sortKey, sortDir]);

  if (!view) return <main className="page-body"><p className="notice">Unknown project: {projectId}</p></main>;
  if (error) return <main className="page-body"><p className="notice">Failed to load run {runId}: {error}</p></main>;
  if (!manifest) return <main className="page-body"><p className="muted">Loading run…</p></main>;

  const r = manifest.run;
  const statuses = Object.keys(r.counts ?? {});

  const setParam = (key: string, value: string, def: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === def) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="page-body">
      <div className="page-title">
        <h1>{r.name}</h1>
        <ScopeChips scope={r.scope} />
        <span className="muted">
          generated {r.generated?.slice(0, 10)}
          {r.catalogue ? ` · catalogue ${r.catalogue.split("/").pop()}` : ""}
          {r.jobids?.length ? ` · jobs ${r.jobids.join(", ")}` : ""}
        </span>
      </div>

      <div className="tile-row">
        {view.runTiles(r).map((tile) => (
          <div className="tile" key={tile.label}>
            <div className="label">{tile.label}</div>
            <div className="value">{tile.value}</div>
            {tile.detail && <div className="detail">{tile.detail}</div>}
          </div>
        ))}
      </div>

      <div className="card section">
        <h2>Runtime distribution</h2>
        <EChart option={runtimeHistogram(manifest.storms)} height={220} />
      </div>

      <div className="card section">
        <h2>Storms</h2>
        <div className="toolbar">
          <input
            type="search"
            placeholder="Search name or SID"
            value={query}
            onChange={(e) => setParam("q", e.target.value, "")}
          />
          <div className="seg-group" role="group" aria-label="status filter">
            <button className={statusFilter === "all" ? "active" : ""} onClick={() => setParam("status", "all", "all")}>
              all {manifest.storms.length}
            </button>
            {statuses.map((st) => (
              <button
                key={st}
                className={statusFilter === st ? "active" : ""}
                onClick={() => setParam("status", st, "all")}
              >
                {st.replace(/_/g, " ")} {r.counts?.[st]}
              </button>
            ))}
          </div>
          <span className="muted">{filtered.length} shown</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="storm-table">
            <thead>
              <tr>
                {view.stormColumns.map((c) => (
                  <th
                    key={c.key}
                    className={(c.num ? "num " : "") + (sortKey === c.key ? "sorted" : "")}
                    onClick={() => {
                      if (sortKey === c.key) setSortDir(sortDir === 1 ? -1 : 1);
                      else {
                        setSortKey(c.key);
                        setSortDir(c.num ? -1 : 1);
                      }
                    }}
                  >
                    {c.label}
                    {sortKey === c.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.sid} onClick={() => navigate(`/p/${projectId}/run/${runId}/storm/${s.sid}`)}>
                  {view.stormColumns.map((c) => (
                    <td key={c.key} className={c.num ? "num" : ""}>
                      {c.render ? c.render(s) : String(s[c.key] ?? "–")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
