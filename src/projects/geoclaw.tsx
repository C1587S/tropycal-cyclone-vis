import { useEffect, useMemo, useState } from "react";
import { AnimPlayer } from "../components/AnimPlayer";
import { ParamsCard } from "../components/ParamsCard";
import { SeriesChart } from "../components/SeriesChart";
import { StatusChip } from "../components/StatusChip";
import { StormMap, type MapPointLayer } from "../components/StormMap";
import type { EChartsOption } from "echarts";
import { EChart } from "../components/EChart";
import {
  catalogueName,
  getAnimIndex,
  getParams,
  getSeries,
  getStability,
  getStormDetail,
  getTrack,
  type AnimEntry,
  type GaugePoint,
  type StabilityBudget,
  type StormDetail,
  type StormParams,
  type StormSeries,
  type Track,
} from "../lib/data";
import { fmtCount, fmtMem, fmtMeters, fmtRuntime, fmtWhen } from "../lib/format";
import { BLUE_RAMP, chartTheme, DIVERGING_RAMP, ORANGE_RAMP } from "../lib/palette";
import { GeoclawCompareBody } from "./geoclawCompare";
import type { ProjectView, StormBodyProps } from "./types";

/** GeoClaw storm surge: the project's metric vocabulary and storm page. */
export const geoclaw: ProjectView = {
  id: "geoclaw",

  runTiles: (r) => [
    { label: "Storms", value: String(r.n_storms), detail: `${r.counts?.ok ?? 0} ok` },
    { label: "Animations", value: String(r.n_mp4 ?? "–"), detail: `${r.n_coarse_only ?? 0} coarse-only` },
    ...(r.sl_init_m
      ? [
          {
            label: "sl_init median",
            value: fmtMeters(r.sl_init_m.median),
            detail: `${fmtMeters(r.sl_init_m.min)} – ${fmtMeters(r.sl_init_m.max)}`,
          },
        ]
      : []),
  ],

  stormColumns: [
    { key: "name", label: "Storm", render: (s) => s.name },
    { key: "season", label: "Season", num: true },
    { key: "status", label: "Status", render: (s) => <StatusChip status={s.status} /> },
    { key: "peak_surge_m", label: "Peak surge", num: true, render: (s) => fmtMeters(s.peak_surge_m) },
    { key: "peak_depth_m", label: "Peak depth", num: true, render: (s) => fmtMeters(s.peak_depth_m) },
    { key: "wet_gauges", label: "Wet gauges", num: true, render: (s) => fmtCount(s.wet_gauges) },
    { key: "runtime_seconds", label: "Runtime", num: true, render: (s) => fmtRuntime(s.runtime_seconds) },
    { key: "memory_mb", label: "Memory", num: true, render: (s) => fmtMem(s.memory_mb) },
    { key: "n_retries", label: "Retries", num: true, render: (s) => fmtCount(s.n_retries) },
    { key: "sl_init_m", label: "sl_init", num: true, render: (s) => fmtMeters(s.sl_init_m) },
    { key: "has_mp4", label: "Anim", render: (s) => (s.has_mp4 ? "▶" : "") },
  ],

  defaultSort: "peak_surge_m",

  StormBody: GeoclawStormBody,
  CompareBody: GeoclawCompareBody,
};

function GeoclawStormBody({ projectId, runId, sid, manifest, storm }: StormBodyProps) {
  const [detail, setDetail] = useState<StormDetail | null>();
  const [series, setSeries] = useState<StormSeries | null>();
  const [animIndex, setAnimIndex] = useState<Record<string, AnimEntry> | null>();
  const [params, setParams] = useState<Record<string, StormParams> | null>();
  const [track, setTrack] = useState<Track | null>();
  const [stability, setStability] = useState<StabilityBudget | null>();

  useEffect(() => {
    setDetail(undefined);
    setSeries(undefined);
    setTrack(undefined);
    setStability(undefined);
    getStormDetail(projectId, runId, sid).then(setDetail, () => setDetail(null));
    getSeries(projectId, runId, sid).then(setSeries);
    getAnimIndex(projectId, runId).then(setAnimIndex);
    getParams(projectId, runId).then(setParams);
    getStability(projectId, sid).then(setStability);
    getTrack(projectId, catalogueName(manifest.run.catalogue), sid).then(setTrack);
  }, [projectId, runId, sid, manifest]);

  const windowT = useMemo<[number, number] | null>(() => {
    if (!storm.t_start || !storm.t_end) return null;
    return [Date.parse(storm.t_start + "Z") / 1000, Date.parse(storm.t_end + "Z") / 1000];
  }, [storm]);

  const notTriggered = storm.status === "not_triggered";

  const mapLayers = useMemo<MapPointLayer[]>(
    () => [
      {
        key: "surge",
        label: "surge",
        points: detail?.surge_gauge_points ?? [],
        total: storm.n_surge_points_total,
        ramp: BLUE_RAMP,
        caption: "peak sea-surface rise above sl_init, ocean gauges",
      },
      {
        key: "depth",
        label: "depth",
        points: detail?.wet_gauge_points ?? [],
        total: storm.wet_gauges,
        ramp: ORANGE_RAMP,
        caption: "peak inundation depth, land gauges",
      },
    ],
    [detail, storm],
  );

  // drawn under the surge dots rather than instead of them
  const mapOverlays = useMemo<MapPointLayer[]>(
    () =>
      stability
        ? [
            {
              key: "dvolume",
              label: "Δvolume",
              points: stability.cum_cells.map(
                ([ix, iy, dv]) =>
                  [
                    ix * stability.base_dx - 180 + stability.base_dx / 2,
                    iy * stability.base_dx - 90 + stability.base_dx / 2,
                    (dv / stability.v0) * 1e9,
                    "cell",
                  ] as GaugePoint,
              ),
              ramp: DIVERGING_RAMP,
              diverging: true,
              unit: "×10⁻⁹ V₀",
              caption:
                "Δvolume: where the simulation gained (red) or lost (blue) water volume over its whole run, per 1° cell, from the raw archive",
            },
          ]
        : [],
    [stability],
  );

  return (
    <>
      {!notTriggered && (
      <div className="tile-row">
        <div className="tile">
          <div className="label">Peak surge</div>
          <div className="value">{fmtMeters(storm.peak_surge_m)}</div>
          <div className="detail">{fmtWhen(storm.peak_surge_time)}</div>
        </div>
        <PeakDepthTile storm={storm} />
        <div className="tile">
          <div className="label">sl_init</div>
          <div className="value">{fmtMeters(storm.sl_init_m)}</div>
          <div className="detail">
            {storm.sl_init_spread_m != null ? `±${(storm.sl_init_spread_m * 1000).toFixed(0)} mm spread` : ""}
          </div>
        </div>
        <div className="tile">
          <div className="label">Runtime</div>
          <div className="value">{fmtRuntime(storm.runtime_seconds)}</div>
          <div className="detail">
            {storm.n_retries ? `${storm.n_retries} retries · ` : ""}
            {fmtMem(storm.memory_mb)}
          </div>
        </div>
        <div className="tile">
          <div className="label">Wet gauges</div>
          <div className="value">{fmtCount(storm.wet_gauges)}</div>
          <div className="detail">of {fmtCount(storm.n_land_gauges)} land</div>
        </div>
        <div className="tile">
          <div className="label">Window</div>
          <div className="value" style={{ fontSize: 15 }}>
            {fmtWhen(storm.t_start)}
          </div>
          <div className="detail">to {fmtWhen(storm.t_end)}</div>
        </div>
      </div>
      )}

      {notTriggered ? (
        <div className="storm-grid section">
          <div className="card">
            <h2>Track (not simulated)</h2>
            <StormMap layers={mapLayers} overlays={mapOverlays} context={detail?.dry} track={track} windowT={windowT} />
          </div>
          <div className="card">
            <h2>Why there is no simulation</h2>
            <NotTriggeredCard storm={storm} track={track} params={params?.[sid]} />
          </div>
        </div>
      ) : (
        <div className="storm-grid section">
          <div className="card">
            <h2>Animation</h2>
            <AnimPlayer
              project={projectId}
              run={runId}
              sid={sid}
              entry={animIndex?.[sid]}
              hasMp4={!!storm.has_mp4}
              hasDomainMp4={!!storm.has_domain_mp4}
            />
          </div>
          <div className="card">
            <h2>Surge map &amp; track</h2>
            <StormMap layers={mapLayers} overlays={mapOverlays} context={detail?.dry} track={track} windowT={windowT} />
          </div>
        </div>
      )}

      {!notTriggered && (
        <div className="card section">
          <h2>Water level at top gauges</h2>
          {series === undefined && <p className="muted">Loading series…</p>}
          {series === null && (
            <p className="notice">
              Gauge time series not exported for this storm yet (run scripts/assemble.py with
              --steps series --series-sids {sid}).
            </p>
          )}
          {series && <SeriesChart series={series} />}
        </div>
      )}

      <div className="storm-grid section">
        <div className="card">
          <h2>GeoClaw parameters</h2>
          <ParamsCard params={params?.[sid]} />
        </div>
        <div className="card">
          <h2>Diagnostics</h2>
          <table className="kv-table">
            <tbody>
              <Row k="status (audited)" v={storm.status} />
              <Row k="status (NetCDF attr)" v={storm.nc_status ?? "–"} />
              <Row k="timesteps" v={fmtCount(storm.n_timesteps)} />
              <Row k="gauges" v={fmtCount(storm.n_gauges)} />
              <Row
                k="land / surge gauges"
                v={`${fmtCount(storm.n_land_gauges)} / ${fmtCount(storm.n_surge_gauges)}`}
              />
              <Row
                k="excluded land gauges"
                v={`${fmtCount(storm.n_excluded_gauges)} (${((storm.excluded_fraction ?? 0) * 100).toFixed(1)} %)`}
              />
              <Row
                k="peak-depth cell elevation at peak"
                v={storm.peak_gauge?.b_at_peak_m != null ? `${storm.peak_gauge.b_at_peak_m.toFixed(2)} m` : "–"}
              />
              <Row k="NaN fraction" v={storm.nan_fraction != null ? storm.nan_fraction.toFixed(4) : "–"} />
              <Row k="coarse only (AMR never refined)" v={storm.coarse_only ? "yes" : "no"} />
              <Row k="outlier flag" v={storm.outlier_flag ? "yes" : "no"} />
              <Row k="slurm array" v={storm.array_job ? `${storm.array_job}[${storm.array_index}]` : "–"} />
              <Row
                k="compact file size"
                v={storm.file_size_bytes ? `${(storm.file_size_bytes / 1e6).toFixed(1)} MB` : "–"}
              />
              <Row k="IBTrACS observations" v={fmtCount(storm.numobs)} />
              {stability === null && (
                <Row
                  k="volume budget"
                  v="not computed for this storm yet (only a few storms have one so far; scripts/volume_budget.py produces it from the raw archive)"
                />
              )}
            </tbody>
          </table>
          {stability && (
            <StabilityChart
              stability={stability}
              gaugeWindow={
                params?.[sid]?.gauge_window_t0 != null && params?.[sid]?.gauge_window_tfinal != null
                  ? [params[sid].gauge_window_t0!, params[sid].gauge_window_tfinal!]
                  : null
              }
            />
          )}
        </div>
      </div>
    </>
  );
}

/** Total-volume drift of the raw-archive simulation, in units of 1e-6 of
 * the initial volume (the stability threshold's own scale), with the gauge
 * window shaded: change outside it never touches what the run is scored
 * on. Sits with the run metrics rather than as its own card. */
function StabilityChart({ stability, gaugeWindow }: {
  stability: StabilityBudget;
  gaugeWindow: [number, number] | null;
}) {
  const t = chartTheme();
  const pts = stability.times_s.map((ts, i) => [ts / 3600, stability.frac_change[i] * 1e6]);
  const option: EChartsOption = {
    backgroundColor: "transparent",
    grid: { left: 46, right: 14, top: 30, bottom: 34 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${(v as number).toFixed(3)} ×10⁻⁶`,
    },
    xAxis: {
      type: "value",
      name: "hours from closest approach",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { color: t.textMuted, fontSize: 11 },
      axisLabel: { color: t.textMuted, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "ΔV/V₀ ×10⁻⁶",
      nameTextStyle: { color: t.textMuted, fontSize: 11 },
      axisLabel: { color: t.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: t.grid } },
    },
    series: [
      {
        name: "volume drift",
        type: "line",
        data: pts,
        showSymbol: false,
        lineStyle: { width: 2, color: t.series1 },
        itemStyle: { color: t.series1 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#ec835a", type: "dashed", width: 1 },
          label: {
            formatter: "1×10⁻⁶ threshold",
            position: "insideEndTop",
            color: t.textSecondary,
            fontSize: 10,
          },
          data: [{ yAxis: 1 }],
        },
        markArea: gaugeWindow
          ? {
              silent: true,
              itemStyle: { color: "rgba(42,120,214,0.07)" },
              label: { color: t.textMuted, fontSize: 10 },
              data: [
                [
                  { name: "gauge window", xAxis: gaugeWindow[0] / 3600 },
                  { xAxis: gaugeWindow[1] / 3600 },
                ],
              ],
            }
          : undefined,
      },
    ],
  };
  return (
    <div className="section">
      <div className="secondary" style={{ fontWeight: 600, marginBottom: 4 }}>
        Volume drift (raw archive)
      </div>
      <EChart option={option} height={190} />
      <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
        from the archived simulation, which may be a domain-expanded retry of this run · the
        Δvolume map layer shows where the cumulative change sits
      </p>
    </div>
  );
}

/** Whether this storm's peak depth is the OLD raw-column metric (max h at
 * the gauge, including water that was below MSL before the storm) rather
 * than the current MSL-referenced one (h + min(0, b), i.e. min(h, eta)).
 * The manifests encode the difference exactly: under the new metric
 * peak_depth_m is strictly less than the gauge's raw column whenever the
 * cell sits below MSL; under the old metric the two are equal. Runs are
 * mixed until the older reports are regenerated. */
function isRawColumnDepth(storm: StormBodyProps["storm"]): boolean {
  const pg = storm.peak_gauge;
  if (storm.peak_depth_m == null || pg?.depth_m == null) return false;
  return Math.abs(storm.peak_depth_m - pg.depth_m) < 0.005;
}

/** Peak inundation depth. Flags only the old raw-column metric when the
 * reporting cell sits below MSL (that depth includes standing water);
 * MSL-referenced values are labeled as such instead of warned about. */
function PeakDepthTile({ storm }: { storm: StormBodyProps["storm"] }) {
  const cellB = storm.peak_gauge?.b_at_peak_m;
  const belowMsl = cellB != null && cellB < -1.0;
  const rawColumn = isRawColumnDepth(storm);
  const suspect = belowMsl && rawColumn;
  return (
    <div className="tile">
      <div className="label">Peak depth</div>
      <div className="value">
        {fmtMeters(storm.peak_depth_m)}
        {suspect && (
          <span
            title="Old raw-column metric: this run's report predates the MSL reference, so the depth includes water that was below sea level before the storm"
            style={{ color: "#ec835a", marginLeft: 6, fontSize: 15 }}
          >
            ⚠ raw column
          </span>
        )}
      </div>
      <div className="detail">
        {suspect
          ? `includes standing water: cell ${Math.abs(cellB).toFixed(1)} m below MSL · surface at ${fmtMeters(storm.peak_gauge?.eta_at_peak_m)} · regenerate report for the MSL-referenced value`
          : belowMsl || (cellB != null && cellB < 0 && !rawColumn)
            ? `referenced to MSL: column ${fmtMeters(storm.peak_gauge?.depth_m)} in a cell ${Math.abs(cellB ?? 0).toFixed(1)} m below MSL · raw ${fmtMeters(storm.raw_peak_depth_m)}`
            : `raw ${fmtMeters(storm.raw_peak_depth_m)}`}
      </div>
    </div>
  );
}

/** For storms the pipeline declined to simulate: state the gate that
 * rejected them and everything the data records about why. The specific
 * failure (proximity vs wind) lives only in the run logs today — the NetCDF
 * records just triggered=0 — so this shows the observable facts instead:
 * the track's peak intensity and the gate's configured thresholds. */
function NotTriggeredCard({ storm, track, params }: {
  storm: StormBodyProps["storm"];
  track?: Track | null;
  params?: StormParams | null;
}) {
  const peak = useMemo(() => {
    const winds = (track?.points ?? []).map((p) => p[3]).filter((v): v is number => v != null);
    return winds.length ? Math.max(...winds) : null;
  }, [track]);
  const gate = params?.params ?? {};
  const gateKeys = [
    "interval_buffer_min",
    "interval_buffer_max_storm_radius_mult",
    "interval_rmw_buffer_mult",
    "interval_threshold_spd",
  ].filter((k) => gate[k] !== undefined);
  return (
    <div>
      <table className="kv-table">
        <tbody>
          <Row k="observed track points" v={fmtCount(storm.numobs)} />
          <Row
            k="peak observed wind"
            v={peak != null ? `${peak.toFixed(1)} m/s (${(peak * 1.944).toFixed(0)} kt)` : "–"}
          />
          {gateKeys.map((k) => (
            <Row key={k} k={`gate: ${k}`} v={String(gate[k])} />
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12 }}>
        Whether the gate failed on proximity or on wind speed is recorded only in the run logs,
        not in the output files.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td>{k}</td>
      <td>{v}</td>
    </tr>
  );
}
