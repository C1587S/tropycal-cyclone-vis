import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunManifest, StormRec } from "../lib/data";
import { fmtHoursHuman, fmtMem, fmtRuntime } from "../lib/format";
import { chartTheme } from "../lib/palette";
import { EChart } from "./EChart";

/** What the run cost and how the allocation was shaped: humanized wall/core
 * time, per-storm cores and memory, and runtime/memory charts that toggle
 * between a binned distribution and every storm individually — the second
 * view is how you spot the one nine-hour outlier. */
export function ResourcesCard({ manifest, stormUrl }: {
  manifest: RunManifest;
  stormUrl: (sid: string) => string;
}) {
  const r = manifest.run;
  const storms = manifest.storms;

  const stats = useMemo(() => {
    const mems = storms.map((s) => s.memory_mb).filter((v): v is number => v != null).sort((a, b) => a - b);
    const procs = [...new Set(storms.map((s) => s.n_procs).filter((v) => v != null))];
    const q = (arr: number[], p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : undefined);
    return {
      memP50: q(mems, 0.5),
      memP90: q(mems, 0.9),
      memMax: mems.at(-1),
      nWithMem: mems.length,
      procs: procs.length === 1 ? String(procs[0]) : procs.length ? `${Math.min(...(procs as number[]))}–${Math.max(...(procs as number[]))}` : "–",
    };
  }, [storms]);

  return (
    <div className="card section">
      <h2>Resources</h2>
      <div className="tile-row" style={{ margin: "4px 0 14px" }}>
        <div className="tile">
          <div className="label">Core hours</div>
          <div className="value">{r.core_hours != null ? Math.round(r.core_hours).toLocaleString() : "–"}</div>
          <div className="detail">≈ {fmtHoursHuman(r.core_hours)} of one core</div>
        </div>
        <div className="tile">
          <div className="label">Wall time</div>
          <div className="value">{fmtHoursHuman(r.wall_hours)}</div>
          <div className="detail">{r.wall_hours != null ? `${Math.round(r.wall_hours)} h across all jobs` : ""}</div>
        </div>
        <div className="tile">
          <div className="label">Cores per storm</div>
          <div className="value">{stats.procs}</div>
          <div className="detail">{storms.length} storms</div>
        </div>
        <div className="tile">
          <div className="label">Memory p50</div>
          <div className="value">{fmtMem(stats.memP50)}</div>
          <div className="detail">
            p90 {fmtMem(stats.memP90)} · max {fmtMem(stats.memMax)}
          </div>
        </div>
        <div className="tile">
          <div className="label">Runtime p50</div>
          <div className="value">{fmtRuntime(r.runtime_seconds?.p50)}</div>
          <div className="detail">max {fmtRuntime(r.runtime_seconds?.max)}</div>
        </div>
      </div>
      <div className="chart-duo">
        <MetricChart
          title="Runtime"
          storms={storms}
          value={(s) => s.runtime_seconds ?? null}
          fmt={(v) => fmtRuntime(v)}
          bins={[
            { label: "<1 min", max: 60 },
            { label: "1–5 min", max: 300 },
            { label: "5–15 min", max: 900 },
            { label: "15–60 min", max: 3600 },
            { label: "1–3 h", max: 10800 },
            { label: ">3 h", max: Infinity },
          ]}
          colorKey="series1"
          stormUrl={stormUrl}
        />
        <MetricChart
          title="Memory"
          storms={storms}
          value={(s) => s.memory_mb ?? null}
          fmt={(v) => fmtMem(v)}
          bins={[
            { label: "<1 GB", max: 1024 },
            { label: "1–2 GB", max: 2048 },
            { label: "2–4 GB", max: 4096 },
            { label: "4–8 GB", max: 8192 },
            { label: "8–16 GB", max: 16384 },
            { label: ">16 GB", max: Infinity },
          ]}
          colorKey="series2"
          stormUrl={stormUrl}
        />
      </div>
    </div>
  );
}

interface Bin {
  label: string;
  max: number;
}

function MetricChart({ title, storms, value, fmt, bins, colorKey, stormUrl }: {
  title: string;
  storms: StormRec[];
  value: (s: StormRec) => number | null;
  fmt: (v: number) => string;
  bins: Bin[];
  colorKey: "series1" | "series2";
  stormUrl: (sid: string) => string;
}) {
  const [mode, setMode] = useState<"bins" | "storms">("bins");
  const navigate = useNavigate();
  const t = chartTheme();
  const color = t[colorKey];

  const ranked = useMemo(
    () =>
      storms
        .map((s) => ({ s, v: value(s) }))
        .filter((x): x is { s: StormRec; v: number } => x.v != null)
        .sort((a, b) => b.v - a.v),
    [storms, value],
  );

  const option = useMemo<EChartsOption>(() => {
    const axis = {
      axisLine: { lineStyle: { color: t.baseline } },
      axisTick: { show: false },
      axisLabel: { color: t.textMuted, fontSize: 11 },
    };
    if (mode === "bins") {
      const counts = bins.map(() => 0);
      for (const { v } of ranked) counts[bins.findIndex((b) => v < b.max)]++;
      return {
        backgroundColor: "transparent",
        grid: { left: 40, right: 8, top: 14, bottom: 26 },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        xAxis: { type: "category", data: bins.map((b) => b.label), ...axis },
        yAxis: { type: "value", splitLine: { lineStyle: { color: t.grid } }, axisLabel: axis.axisLabel },
        series: [{ type: "bar", name: "storms", data: counts, itemStyle: { color, borderRadius: [4, 4, 0, 0] }, barCategoryGap: "35%" }],
      };
    }
    return {
      backgroundColor: "transparent",
      grid: { left: 52, right: 8, top: 14, bottom: 26 },
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const { s, v } = ranked[(p as { dataIndex: number }).dataIndex];
          return `<strong>${s.name}</strong> ${s.season}<br/>${fmt(v)}`;
        },
      },
      xAxis: {
        type: "category",
        data: ranked.map((x) => x.s.sid),
        axisLabel: { show: false },
        axisLine: axis.axisLine,
        axisTick: { show: false },
        name: `storms, largest first (click to open)`,
        nameLocation: "middle",
        nameGap: 12,
        nameTextStyle: { color: t.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: "log",
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.textMuted, fontSize: 11, formatter: (v: number) => fmt(v) },
      },
      series: [{ type: "bar", name: title, data: ranked.map((x) => x.v), itemStyle: { color }, barCategoryGap: "10%" }],
    };
  }, [mode, ranked, bins, color, t, fmt, title]);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <span className="secondary" style={{ fontWeight: 600 }}>{title}</span>
        <div className="seg-group" role="group" aria-label={`${title} view`}>
          <button className={mode === "bins" ? "active" : ""} onClick={() => setMode("bins")}>
            distribution
          </button>
          <button className={mode === "storms" ? "active" : ""} onClick={() => setMode("storms")}>
            per storm
          </button>
        </div>
      </div>
      <EChart
        option={option}
        height={200}
        onClick={(p) => {
          if (mode === "storms" && ranked[p.dataIndex]) navigate(stormUrl(ranked[p.dataIndex].s.sid));
        }}
      />
    </div>
  );
}
