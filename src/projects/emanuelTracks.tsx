import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EChart } from "../components/EChart";
import {
  getEmanuelRegistry,
  getEmanuelSet,
  getEmanuelTrackBundle,
  getIbtracsPeaks,
  type EmanuelSet,
  type EmanuelSetMeta,
  type IbtracsPeaks,
} from "../lib/data";
import { BLUE_RAMP, chartTheme, rampColor, rampCss } from "../lib/palette";
import type { ProjectView } from "./types";

const SCENARIO_LABELS: Record<string, string> = {
  "20th": "20th century",
  ssp245: "SSP2-4.5",
  ssp370: "SSP3-7.0",
  reanal: "reanalysis",
};

const WIND_KINDS = [
  { key: "v_circular", label: "v_circular", note: "rotational wind, what PI is a ceiling on" },
  { key: "v_total", label: "v_total", note: "includes translation" },
];

/** Kerry Emanuel tracksets: selectors over model x scenario-period x
 * vintage, with the wind-vs-PI density and the peak-wind distribution
 * against IBTrACS. The track map lights up when its bundles are published
 * (held back from git until the data moves to Hugging Face). */
export const emanuelTracks: ProjectView = {
  id: "emanuel-tracks",
  Landing: EmanuelLanding,
};

function periodKey(m: { scenario: string; years: [number, number] }): string {
  return `${m.scenario}_${m.years[0]}_${m.years[1]}`;
}

function EmanuelLanding({ projectId }: { projectId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [registry, setRegistry] = useState<EmanuelSetMeta[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getEmanuelRegistry(projectId).then((r) => setRegistry(r.sets), (e) => setError(String(e)));
  }, [projectId]);

  const vintages = useMemo(() => [...new Set(registry?.map((s) => s.vintage) ?? [])], [registry]);
  const models = useMemo(() => [...new Set(registry?.map((s) => s.model) ?? [])], [registry]);
  const periods = useMemo(() => {
    const seen = new Map<string, { scenario: string; years: [number, number] }>();
    for (const s of registry ?? []) seen.set(periodKey(s), { scenario: s.scenario, years: s.years });
    return [...seen.entries()];
  }, [registry]);

  const vintage = searchParams.get("vintage") ?? vintages[0];
  const model = searchParams.get("model") ?? "cesm2";
  const period = searchParams.get("period") ?? "20th_2000_2014";

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(k, v);
    setSearchParams(next, { replace: true });
  };

  const selected = useMemo(
    () => registry?.find((s) => s.vintage === vintage && s.model === model && periodKey(s) === period),
    [registry, vintage, model, period],
  );

  if (error) return <main className="page-body"><p className="notice">Failed to load tracksets: {error}</p></main>;
  if (!registry) return <main className="page-body"><p className="muted">Loading tracksets…</p></main>;

  return (
    <main className="page-body">
      <div className="page-title">
        <h1>Emanuel synthetic tracks</h1>
        <span className="muted">{registry.length} tracksets · CONUS Atlantic-Pacific</span>
      </div>

      <div className="toolbar" style={{ marginTop: 10 }}>
        <div className="seg-group wrap" role="group" aria-label="model">
          {models.map((m) => (
            <button key={m} className={m === model ? "active" : ""} onClick={() => setParam("model", m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="seg-group wrap" role="group" aria-label="scenario and period">
          {periods.map(([key, p]) => (
            <button key={key} className={key === period ? "active" : ""} onClick={() => setParam("period", key)}>
              {SCENARIO_LABELS[p.scenario] ?? p.scenario}
              <span className="sub">
                {p.years[0]}–{p.years[1]}
              </span>
            </button>
          ))}
        </div>
        <div className="seg-group" role="group" aria-label="vintage">
          {vintages.map((v) => (
            <button key={v} className={v === vintage ? "active" : ""} onClick={() => setParam("vintage", v)}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {!selected && (
        <p className="notice">
          No trackset for this combination: the reanalysis period exists only for era5/ncep2, and
          the GCMs only have the 20th-century and SSP periods.
        </p>
      )}
      {selected && <SetView projectId={projectId} meta={selected} />}
    </main>
  );
}

function SetView({ projectId, meta }: { projectId: string; meta: EmanuelSetMeta }) {
  const [set, setSet] = useState<EmanuelSet>();
  const [ibtracs, setIbtracs] = useState<Record<string, IbtracsPeaks>>();
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getEmanuelTrackBundle>>>();

  useEffect(() => {
    setSet(undefined);
    setBundle(undefined);
    getEmanuelSet(projectId, meta.id).then(setSet, () => undefined);
    getIbtracsPeaks(projectId).then(setIbtracs, () => undefined);
    getEmanuelTrackBundle(projectId, meta.id).then(setBundle);
  }, [projectId, meta.id]);

  if (!set) return <p className="muted">Loading trackset…</p>;

  const s = set.summary;
  return (
    <>
      <div className="tile-row">
        <div className="tile">
          <div className="label">Storms</div>
          <div className="value">{s.n_storms.toLocaleString()}</div>
          <div className="detail">3 ensembles</div>
        </div>
        <div className="tile">
          <div className="label">Annual frequency</div>
          <div className="value">{s.freq_per_year?.toFixed(2) ?? "–"}</div>
          <div className="detail">calibrated</div>
        </div>
        <div className="tile">
          <div className="label">Peak wind p50</div>
          <div className="value">{s.peak_p50_ms?.toFixed(1)} m/s</div>
          <div className="detail">max {s.peak_max_ms?.toFixed(1)} m/s</div>
        </div>
        <div className="tile">
          <div className="label">PI p99</div>
          <div className="value">{s.vp_p99_ms?.toFixed(0)} m/s</div>
          <div className="detail">max {s.vp_max_ms?.toFixed(0)} m/s ({((s.vp_max_ms ?? 0) / 0.514444).toFixed(0)} kt)</div>
        </div>
        <div className="tile">
          <div className="label">PI above 100 m/s</div>
          <div className="value">{((s.share_vp_gt_100ms ?? 0) * 100).toFixed(2)} %</div>
          <div className="detail">of track points</div>
        </div>
      </div>

      <div className="card section">
        <h2>Wind against potential intensity</h2>
        <DensityChart set={set} />
      </div>

      <div className="card section">
        <h2>Peak wind per storm</h2>
        <PeaksChart set={set} ibtracs={ibtracs} />
      </div>

      <div className="card section">
        <h2>Tracks</h2>
        {bundle === undefined && <p className="muted">Checking for track bundle…</p>}
        {bundle === null && (
          <p className="notice">
            The track map's polyline bundles (~60 MB across all sets) are held out of git until
            the data moves to Hugging Face; this card lights up when they are published.
          </p>
        )}
        {bundle && <p className="notice">Track bundle present; map rendering lands with the HF migration.</p>}
      </div>

      {set.stats && (
        <div className="card section">
          <h2>stats.txt</h2>
          <table className="kv-table">
            <tbody>
              {Object.entries(set.stats).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Rectangular density of wind vs PI on 1 m/s bins, log-coloured, with the
 * 1:1 line. Two stories live here and the caption keeps them apart: points
 * right of the line (wind above the current ceiling) are expected lagged
 * decay; the anomaly is the top of the PI axis, values no ocean produces. */
function DensityChart({ set }: { set: EmanuelSet }) {
  const [kind, setKind] = useState("v_circular");
  const t = chartTheme();
  const cells = set.density[kind] ?? [];

  const option = useMemo<EChartsOption>(() => {
    const cmax = Math.max(1, ...cells.map((c) => c[2]));
    const logMax = Math.log(cmax + 1);
    return {
      backgroundColor: "transparent",
      grid: { left: 62, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: "value",
        name: `${kind} (m/s)`,
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: t.textMuted },
        min: 0,
        max: 160,
        axisLabel: { color: t.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      yAxis: {
        type: "value",
        name: "potential intensity (m/s)",
        nameLocation: "middle",
        nameGap: 38,
        nameRotate: 90,
        nameTextStyle: { color: t.textMuted },
        min: 0,
        max: 220,
        axisLabel: { color: t.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.grid } },
      },
      tooltip: {
        formatter: (p) => {
          const d = (p as unknown as { value: [number, number, number] }).value;
          return `${d[2].toLocaleString()} points<br/>${kind} ${d[0]}–${d[0] + 1} m/s · PI ${d[1]}–${d[1] + 1} m/s`;
        },
      },
      series: [
        {
          type: "custom",
          renderItem: (_params, api) => {
            const x = api.value(0) as number;
            const y = api.value(1) as number;
            const c = api.value(2) as number;
            const p0 = api.coord([x, y + 1]);
            const p1 = api.coord([x + 1, y]);
            return {
              type: "rect",
              shape: { x: p0[0], y: p0[1], width: p1[0] - p0[0], height: p1[1] - p0[1] },
              style: { fill: rampColor(BLUE_RAMP, Math.log(c + 1) / logMax) },
            };
          },
          data: cells,
          progressive: 4000,
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: t.textSecondary, type: "dashed", width: 1.2 },
            label: { formatter: "1:1", color: t.textSecondary, position: "insideEndTop" },
            data: [[{ coord: [0, 0] }, { coord: [160, 160] }]],
          },
        },
      ],
    };
  }, [cells, kind, t]);

  const share = set.summary.share_wind_gt_vp[kind];
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 4 }}>
        <div className="seg-group" role="group" aria-label="wind definition">
          {WIND_KINDS.map((w) => (
            <button key={w.key} className={kind === w.key ? "active" : ""} onClick={() => setKind(w.key)}>
              {w.label}
              <span className="sub">{w.note}</span>
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          0
          <span
            className="ramp"
            style={{ display: "inline-block", width: 90, height: 8, margin: "0 6px", background: rampCss(BLUE_RAMP), borderRadius: 4 }}
          />
          points per 1 m/s cell (log)
        </span>
      </div>
      <EChart option={option} height={380} />
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        {share != null ? `${(share * 100).toFixed(1)} % of points sit right of the 1:1 line (wind above the current ceiling) — expected lagged decay, especially after landfall. ` : ""}
        The anomaly is the top of the PI axis: {((set.summary.share_vp_gt_100ms ?? 0) * 100).toFixed(2)} % of
        points carry PI above 100 m/s (≈194 kt), up to {set.summary.vp_max_ms?.toFixed(0)} m/s
        ({((set.summary.vp_max_ms ?? 0) / 0.514444).toFixed(0)} kt) — values no ocean produces.
        PI converted from knots; winds are m/s at source.
      </p>
    </div>
  );
}

/** Distribution of per-storm peak wind, as share of storms per 1 m/s bin,
 * with the IBTrACS CONUS-relevant catalogue over the same period. */
function PeaksChart({ set, ibtracs }: { set: EmanuelSet; ibtracs?: Record<string, IbtracsPeaks> }) {
  const t = chartTheme();
  const key = `${set.years[0]}_${set.years[1]}`;
  const overlay = ibtracs?.[key]?.n ? ibtracs[key] : ibtracs?.all;
  const overlayIsFallback = !ibtracs?.[key]?.n;

  const option = useMemo<EChartsOption>(() => {
    const n = set.peaks_hist.reduce((a, b) => a + b, 0) || 1;
    const bars = set.peaks_hist.map((c, i) => [i + 0.5, c / n]);
    const on = overlay?.hist.reduce((a, b) => a + b, 0) || 1;
    const line = (overlay?.hist ?? []).map((c, i) => [i + 0.5, c / on]);
    return {
      backgroundColor: "transparent",
      grid: { left: 56, right: 16, top: 30, bottom: 40 },
      legend: { top: 0, textStyle: { color: t.textSecondary, fontSize: 12 } },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `${((v as number) * 100).toFixed(2)} %`,
      },
      xAxis: {
        type: "value",
        name: "peak v_total (m/s)",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: t.textMuted },
        min: 0,
        max: 120,
        axisLabel: { color: t.textMuted, fontSize: 11 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "share of storms",
        nameTextStyle: { color: t.textMuted },
        axisLabel: { color: t.textMuted, fontSize: 11, formatter: (v: number) => `${(v * 100).toFixed(0)} %` },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [
        {
          name: `trackset (${set.summary.n_storms.toLocaleString()} storms)`,
          type: "bar",
          data: bars,
          barWidth: "90%",
          itemStyle: { color: t.series1 },
        },
        {
          name: `IBTrACS ${overlay?.years ? `${overlay.years[0]}–${overlay.years[1]}` : "full record"} (${overlay?.n ?? 0} storms)`,
          type: "line",
          data: line,
          showSymbol: false,
          lineStyle: { width: 2, color: t.series2 },
          itemStyle: { color: t.series2 },
        },
      ],
    };
  }, [set, overlay, t]);

  return (
    <div>
      <EChart option={option} height={300} />
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        both normalised to share of storms per 1 m/s bin; IBTrACS population is the
        CONUS-proximity catalogue{overlayIsFallback ? " — no observed record for this period, full record shown as reference" : " over the same seasons"}
      </p>
    </div>
  );
}
