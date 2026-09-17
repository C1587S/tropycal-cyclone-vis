import { useEffect, useMemo, useRef, useState } from "react";
import { StatusChip } from "../components/StatusChip";
import { StormMap, type MapPointLayer } from "../components/StormMap";
import {
  animUrl,
  catalogueName,
  getAnimIndex,
  getParams,
  getStormDetail,
  getTrack,
  type AnimEntry,
  type GaugePoint,
  type StormDetail,
  type StormParams,
  type StormRec,
  type Track,
} from "../lib/data";
import { fmtCount, fmtMem, fmtMeters, fmtRelHours, fmtRuntime, fmtWhen } from "../lib/format";
import { BLUE_RAMP, DIVERGING_RAMP, seriesColor } from "../lib/palette";
import type { CompareBodyProps } from "./types";

interface MetricRow {
  label: string;
  value: (s: StormRec) => React.ReactNode;
  /** comparable form; rows where runs disagree are highlighted */
  raw: (s: StormRec) => string;
}

const ROWS: MetricRow[] = [
  { label: "status", value: (s) => <StatusChip status={s.status} />, raw: (s) => s.status },
  { label: "peak surge", value: (s) => fmtMeters(s.peak_surge_m), raw: (s) => fmtMeters(s.peak_surge_m) },
  { label: "peak surge time", value: (s) => fmtWhen(s.peak_surge_time), raw: (s) => s.peak_surge_time ?? "" },
  {
    label: "peak depth",
    value: (s) => {
      const cellB = s.peak_gauge?.b_at_peak_m;
      const suspect = cellB != null && cellB < -1.0;
      return (
        <>
          {fmtMeters(s.peak_depth_m)}
          {suspect && (
            <span title="reporting cell below MSL at peak" style={{ color: "#ec835a" }}>
              {" "}
              ⚠
            </span>
          )}
        </>
      );
    },
    raw: (s) => fmtMeters(s.peak_depth_m),
  },
  { label: "raw peak depth", value: (s) => fmtMeters(s.raw_peak_depth_m), raw: (s) => fmtMeters(s.raw_peak_depth_m) },
  { label: "sl_init", value: (s) => fmtMeters(s.sl_init_m), raw: (s) => fmtMeters(s.sl_init_m) },
  { label: "wet gauges", value: (s) => fmtCount(s.wet_gauges), raw: (s) => String(s.wet_gauges ?? "") },
  { label: "surge gauges", value: (s) => fmtCount(s.n_surge_points_total), raw: (s) => String(s.n_surge_points_total ?? "") },
  // raw at displayed (minute) precision: window bounds jitter by a second
  // or two between runs from output cadence, which is not a difference
  { label: "window start", value: (s) => fmtWhen(s.t_start), raw: (s) => fmtWhen(s.t_start) },
  { label: "window end", value: (s) => fmtWhen(s.t_end), raw: (s) => fmtWhen(s.t_end) },
  { label: "timesteps", value: (s) => fmtCount(s.n_timesteps), raw: (s) => String(s.n_timesteps ?? "") },
  { label: "runtime", value: (s) => fmtRuntime(s.runtime_seconds), raw: (s) => fmtRuntime(s.runtime_seconds) },
  { label: "memory", value: (s) => fmtMem(s.memory_mb), raw: (s) => fmtMem(s.memory_mb) },
  { label: "retries", value: (s) => fmtCount(s.n_retries), raw: (s) => String(s.n_retries ?? "") },
  { label: "coarse only", value: (s) => (s.coarse_only ? "yes" : "no"), raw: (s) => String(!!s.coarse_only) },
  { label: "slurm array", value: (s) => (s.array_job ? `${s.array_job}[${s.array_index}]` : "–"), raw: (s) => s.array_job ?? "" },
];

/** Per-gauge surge difference between two runs, joined on the gauge id
 * (gauge placement is deterministic, so ids are stable across runs). Only
 * gauges present in both runs' exported point sets contribute. */
function diffPoints(a?: GaugePoint[], b?: GaugePoint[]): GaugePoint[] {
  if (!a?.length || !b?.length) return [];
  const byId = new Map(a.map((p) => [p[3], p[2]]));
  const out: GaugePoint[] = [];
  for (const p of b) {
    const va = byId.get(p[3]);
    if (va !== undefined) out.push([p[0], p[1], +(p[2] - va).toFixed(3), p[3]]);
  }
  return out;
}

/** One storm, several runs: numbers in one table, all runs' surge on one
 * map (per-run layers plus per-gauge difference layers), simulated windows
 * overlaid on the shared observed track, animations synchronised on the
 * simulation clock, and the config diff. */
export function GeoclawCompareBody({ projectId, sid, runs, manifests }: CompareBodyProps) {
  const [details, setDetails] = useState<Record<string, StormDetail | null>>({});
  const [params, setParams] = useState<Record<string, Record<string, StormParams> | null>>({});
  const [animIdx, setAnimIdx] = useState<Record<string, Record<string, AnimEntry> | null>>({});
  const [track, setTrack] = useState<Track | null>();
  const [allParams, setAllParams] = useState(false);

  useEffect(() => {
    for (const run of runs) {
      if (details[run] === undefined) {
        getStormDetail(projectId, run, sid).then(
          (d) => setDetails((p) => ({ ...p, [run]: d })),
          () => setDetails((p) => ({ ...p, [run]: null })),
        );
      }
      if (params[run] === undefined) {
        getParams(projectId, run).then((p) => setParams((prev) => ({ ...prev, [run]: p })));
      }
      if (animIdx[run] === undefined) {
        getAnimIndex(projectId, run).then((a) => setAnimIdx((prev) => ({ ...prev, [run]: a })));
      }
    }
  }, [projectId, sid, runs, details, params, animIdx]);

  useEffect(() => {
    const first = runs.find((r) => manifests[r]);
    if (!first) return;
    getTrack(projectId, catalogueName(manifests[first].run.catalogue), sid).then(setTrack);
  }, [projectId, sid, runs, manifests]);

  const storms = useMemo(() => {
    const out: Record<string, StormRec | undefined> = {};
    for (const run of runs) out[run] = manifests[run]?.storms.find((s) => s.sid === sid);
    return out;
  }, [runs, manifests, sid]);

  const windows = useMemo(
    () =>
      runs.flatMap((run, i) => {
        const s = storms[run];
        if (!s?.t_start || !s?.t_end) return [];
        return [
          {
            label: run,
            color: seriesColor(i),
            t: [Date.parse(s.t_start + "Z") / 1000, Date.parse(s.t_end + "Z") / 1000] as [number, number],
          },
        ];
      }),
    [runs, storms],
  );

  const paramRows = useMemo(() => {
    const perRun = runs.map((run) => params[run]?.[sid]);
    const keys = new Set<string>();
    for (const p of perRun) for (const k of Object.keys(p?.params ?? {})) keys.add(k);
    const rows = [...keys].sort().map((key) => {
      const vals = perRun.map((p) => {
        const v = (p?.params ?? {})[key];
        return v === undefined ? "–" : v === null ? "null" : String(v);
      });
      return { key, vals, differs: new Set(vals).size > 1 };
    });
    const versions = perRun.map((p) => p?.params_version ?? "–");
    rows.unshift({ key: "params_version", vals: versions, differs: new Set(versions).size > 1 });
    return rows;
  }, [runs, params, sid]);

  const nDiff = paramRows.filter((r) => r.differs).length;

  return (
    <>
      <div className="card section">
        <h2>Numbers</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {runs.map((run, i) => (
                  <th key={run}>
                    <span className="dot" style={{ background: seriesColor(i) }} /> {run}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const raws = runs.map((run) => (storms[run] ? row.raw(storms[run]!) : "–"));
                const differs = new Set(raws).size > 1;
                return (
                  <tr key={row.label} className={differs ? "diff" : ""}>
                    <td>{row.label}</td>
                    {runs.map((run) => (
                      <td key={run}>{storms[run] ? row.value(storms[run]!) : "–"}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          highlighted rows differ between runs
        </p>
      </div>

      <div className="card section">
        <h2>Surge in one frame</h2>
        <CompareMap runs={runs} storms={storms} details={details} track={track} windows={windows} />
      </div>

      <div className="card section">
        <h2>Synchronised on the simulation clock</h2>
        <CompareAnims projectId={projectId} sid={sid} runs={runs} storms={storms} animIdx={animIdx} />
      </div>

      <div className="card section">
        <h2>Configuration</h2>
        <div className="toolbar">
          <div className="seg-group" role="group" aria-label="parameter filter">
            <button className={!allParams ? "active" : ""} onClick={() => setAllParams(false)}>
              differences {nDiff}
            </button>
            <button className={allParams ? "active" : ""} onClick={() => setAllParams(true)}>
              all {paramRows.length}
            </button>
          </div>
        </div>
        {nDiff === 0 && !allParams && (
          <p className="notice">No configuration differences between these runs for this storm.</p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {runs.map((run) => (
                  <th key={run}>{run}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paramRows
                .filter((r) => allParams || r.differs)
                .map((r) => (
                  <tr key={r.key} className={r.differs ? "diff" : ""}>
                    <td>{r.key}</td>
                    {r.vals.map((v, i) => (
                      <td key={runs[i]}>{v}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** All runs' peak surge on one map: a layer per run on a shared color
 * scale, plus a per-gauge difference layer for each adjacent pair of
 * selected runs on a diverging scale. The runs' simulated windows draw on
 * the track here too; identical windows collapse to one segment and a
 * sentence instead of indistinguishable overlapping lines. */
function CompareMap({ runs, storms, details, track, windows }: {
  runs: string[];
  storms: Record<string, StormRec | undefined>;
  details: Record<string, StormDetail | null>;
  track?: Track | null;
  windows: { label: string; color: string; t: [number, number] }[];
}) {
  // identical within a minute: window bounds carry seconds-level jitter
  // from the output cadence that is not a real difference between runs
  const spread = (i: 0 | 1) =>
    Math.max(...windows.map((w) => w.t[i])) - Math.min(...windows.map((w) => w.t[i]));
  const identicalWindows = windows.length > 1 && spread(0) <= 60 && spread(1) <= 60;
  const layers = useMemo<MapPointLayer[]>(() => {
    const sharedMax = Math.max(
      0.1,
      ...runs.flatMap((run) => (details[run]?.surge_gauge_points ?? []).map((p) => p[2])),
    );
    const runLayers: MapPointLayer[] = runs.map((run) => ({
      key: run,
      label: run,
      points: details[run]?.surge_gauge_points ?? [],
      total: storms[run]?.n_surge_points_total,
      ramp: BLUE_RAMP,
      scaleMax: sharedMax,
      caption: `peak surge in ${run} (color scale shared across runs)`,
    }));
    // every pair, not just adjacent ones: with three runs the end-to-end
    // comparison (last vs first) is usually the one that matters most
    const deltaLayers: MapPointLayer[] = [];
    for (let i = 1; i < runs.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = runs[j];
        const b = runs[i];
        const pts = diffPoints(details[a]?.surge_gauge_points, details[b]?.surge_gauge_points);
        if (!pts.length) continue;
        const dmax = Math.max(0.1, ...pts.map((p) => Math.abs(p[2])));
        deltaLayers.push({
          key: `delta-${j}-${i}`,
          label: `Δ ${b} − ${a}`,
          points: pts,
          ramp: DIVERGING_RAMP,
          diverging: true,
          scaleMax: dmax,
          caption: `surge difference at the ${pts.length.toLocaleString()} gauges present in both exports (red: higher in ${b})`,
        });
      }
    }
    return [...runLayers, ...deltaLayers];
  }, [runs, storms, details]);

  const first = storms[runs.find((r) => storms[r]) ?? ""];

  return (
    <div>
      {identicalWindows || windows.length <= 1 ? (
        <StormMap layers={layers} track={track} windowT={windows[0]?.t ?? null} />
      ) : (
        <StormMap layers={layers} track={track} windows={windows} />
      )}
      {identicalWindows && (
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          simulated window identical across runs: {fmtWhen(first?.t_start)} to {fmtWhen(first?.t_end)}
        </p>
      )}
      {!identicalWindows && windows.length > 1 && (
        <div className="facts" style={{ marginTop: 8 }}>
          {windows.map((w) => (
            <span key={w.label} className="status-chip">
              <span className="dot" style={{ background: w.color }} />
              {w.label} window
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The same moment across runs: one slider on the simulation clock
 * (seconds relative to closest approach, identical across runs) drives
 * every run's animation column. */
function CompareAnims({ projectId, sid, runs, storms, animIdx }: {
  projectId: string;
  sid: string;
  runs: string[];
  storms: Record<string, StormRec | undefined>;
  animIdx: Record<string, Record<string, AnimEntry> | null>;
}) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);

  const withMp4 = useMemo(() => runs.filter((r) => storms[r]?.has_mp4), [runs, storms]);
  const entries = useMemo(() => {
    const out: Record<string, AnimEntry | undefined> = {};
    for (const run of withMp4) out[run] = animIdx[run]?.[sid];
    return out;
  }, [withMp4, animIdx, sid]);

  const masterTimes = useMemo(() => {
    const all = new Set<number>();
    for (const run of withMp4) for (const t of entries[run]?.times ?? []) all.add(t);
    return [...all].sort((a, b) => a - b);
  }, [withMp4, entries]);

  // open at closest approach (t = 0), not at the start of the window: the
  // first frames are open ocean days before anything happens
  useEffect(() => {
    let best = 0;
    for (let j = 1; j < masterTimes.length; j++) {
      if (Math.abs(masterTimes[j]) < Math.abs(masterTimes[best])) best = j;
    }
    setI(best);
    setPlaying(false);
  }, [sid, masterTimes]);

  useEffect(() => {
    if (!playing || masterTimes.length < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % masterTimes.length), 300);
    return () => clearInterval(id);
  }, [playing, masterTimes.length]);

  useEffect(() => {
    const T = masterTimes[i];
    if (T == null) return;
    for (const run of withMp4) {
      const e = entries[run];
      const v = videoRefs.current[run];
      if (!e?.times?.length || !v) continue;
      let idx = -1;
      for (let j = 0; j < e.times.length && e.times[j] <= T; j++) idx = j;
      const mainFrame = idx - (e.dropped ?? 0);
      v.currentTime = mainFrame >= 0 ? (Math.min(mainFrame, (e.frames ?? 1) - 1) + 0.5) / e.fps : 0;
    }
  }, [i, masterTimes, withMp4, entries]);

  if (!withMp4.length) {
    return <p className="notice">None of the selected runs has an animation for this storm.</p>;
  }

  const canSync = masterTimes.length > 1 && withMp4.some((r) => entries[r]?.times?.length);

  return (
    <div>
      <div className="anim-columns" style={{ "--cols": runs.length } as React.CSSProperties}>
        {runs.map((run) => (
          <div key={run}>
            <div className="secondary" style={{ fontWeight: 600, marginBottom: 6 }}>
              {run}
            </div>
            {storms[run]?.has_mp4 ? (
              <video
                ref={(el) => {
                  videoRefs.current[run] = el;
                }}
                src={animUrl(projectId, run, sid)}
                muted
                playsInline
                preload="auto"
                controls={!canSync}
                style={{ width: "100%", borderRadius: 6, background: "#000" }}
              />
            ) : (
              <p className="notice">No animation in this run.</p>
            )}
          </div>
        ))}
      </div>
      {canSync && (
        <div className="anim-controls">
          <button className="btn" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={masterTimes.length - 1}
            value={i}
            onChange={(e) => {
              setPlaying(false);
              setI(Number(e.target.value));
            }}
          />
          <span className="time-label">{fmtRelHours(masterTimes[i] ?? 0)}</span>
        </div>
      )}
      {canSync && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          time is relative to closest approach, common to all runs. Colour scales are each run's
          own (auto-scaled when the frames were rendered), so colours are not comparable across
          panels until storms are re-rendered with the fixed-scale setplot.
        </div>
      )}
    </div>
  );
}
