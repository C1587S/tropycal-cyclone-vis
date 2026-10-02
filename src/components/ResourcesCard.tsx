import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { RunManifest, StormRec } from "../lib/data";
import { fmtHoursHuman, fmtMem, fmtRuntime } from "../lib/format";
import { chartTheme } from "../lib/palette";
import { EChart } from "./EChart";

/** What the run cost and how the allocation was shaped: humanized wall/core
 * time, per-storm cores and memory, and runtime/memory charts showing every
 * storm individually (how you spot the one nine-hour outlier), with a binned
 * distribution as the alternate view. Hovering a storm's bar highlights the
 * same storm in the sibling chart, so compute time and memory read together. */
export function ResourcesCard({ manifest, stormUrl }: {
  manifest: RunManifest;
  stormUrl: (sid: string) => string;
}) {
  const r = manifest.run;
  const storms = manifest.storms;
  const [hoverSid, setHoverSid] = useState<string | null>(null);
  // clicking a bar pins the storm, so its numbers stay readable after the
  // pointer moves on; hovering reads over the pin without clearing it
  const [pinnedSid, setPinnedSid] = useState<string | null>(null);
  const shownSid = hoverSid ?? pinnedSid;
  const shown = shownSid ? storms.find((s) => s.sid === shownSid) : undefined;

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
          <div className="label">Elapsed</div>
          <div className="value">{fmtHoursHuman(r.elapsed_hours ?? undefined)}</div>
          <div className="detail">
            {r.elapsed_hours != null
              ? "first task start to last task end"
              : "needs Start/End in the sacct caches"}
          </div>
        </div>
        <div className="tile">
          <div className="label">Task time, summed</div>
          <div className="value">{fmtHoursHuman(r.task_hours ?? r.wall_hours)}</div>
          <div className="detail">
            {(r.task_hours ?? r.wall_hours) != null
              ? `${Math.round(r.task_hours ?? r.wall_hours ?? 0)} h summed over array tasks (~20 ran at a time)`
              : ""}
          </div>
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
      <div className="pin-strip">
        {shown ? (
          <>
            <Link to={stormUrl(shown.sid)} className="pin-name">
              {shown.name}
            </Link>
            <span className="muted">{shown.season}</span>
            <span>
              runtime <strong>{fmtRuntime(shown.runtime_seconds)}</strong>
            </span>
            <span>
              memory <strong>{fmtMem(shown.memory_mb)}</strong>
            </span>
            {pinnedSid === shown.sid && !hoverSid && (
              <span className="muted">pinned (click its bar again to unpin)</span>
            )}
          </>
        ) : (
          <span className="muted">hover a bar to read a storm here; click to pin it</span>
        )}
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
          hoverSid={hoverSid}
          pinnedSid={pinnedSid}
          onHoverSid={setHoverSid}
          onPinSid={(sid) => setPinnedSid((p) => (p === sid ? null : sid))}
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
          hoverSid={hoverSid}
          pinnedSid={pinnedSid}
          onHoverSid={setHoverSid}
          onPinSid={(sid) => setPinnedSid((p) => (p === sid ? null : sid))}
        />
      </div>
    </div>
  );
}

interface Bin {
  label: string;
  max: number;
}

function MetricChart({ title, storms, value, fmt, bins, colorKey, hoverSid, pinnedSid, onHoverSid, onPinSid }: {
  title: string;
  storms: StormRec[];
  value: (s: StormRec) => number | null;
  fmt: (v: number) => string;
  bins: Bin[];
  colorKey: "series1" | "series2";
  hoverSid: string | null;
  pinnedSid: string | null;
  onHoverSid: (sid: string | null) => void;
  onPinSid: (sid: string) => void;
}) {
  // per storm by default: the bins hide which storm is which
  const [mode, setMode] = useState<"bins" | "storms">("storms");
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
      // no tooltip here: the strip above the charts shows the hovered storm
      xAxis: {
        type: "category",
        data: ranked.map((x) => x.s.sid),
        axisLabel: { show: false },
        axisLine: axis.axisLine,
        axisTick: { show: false },
        name: `storms, largest first (click to pin)`,
        nameLocation: "middle",
        nameGap: 12,
        nameTextStyle: { color: t.textMuted, fontSize: 11 },
      },
      yAxis: {
        type: "log",
        splitLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.textMuted, fontSize: 11, formatter: (v: number) => fmt(v) },
      },
      series: [
        {
          type: "bar",
          name: title,
          // the storm hovered or pinned in either chart reads in primary ink
          // in both, so compute time and memory line up for one storm
          data: ranked.map((x) => ({
            value: x.v,
            itemStyle: x.s.sid === hoverSid || x.s.sid === pinnedSid ? { color: t.textPrimary } : { color },
          })),
          barCategoryGap: "10%",
        },
      ],
    };
  }, [mode, ranked, bins, color, t, fmt, title, hoverSid, pinnedSid]);

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
          if (mode === "storms" && ranked[p.dataIndex]) onPinSid(ranked[p.dataIndex].s.sid);
        }}
        onHover={(p) => {
          if (mode === "storms" && ranked[p.dataIndex]) onHoverSid(ranked[p.dataIndex].s.sid);
        }}
        onHoverEnd={() => onHoverSid(null)}
      />
    </div>
  );
}
