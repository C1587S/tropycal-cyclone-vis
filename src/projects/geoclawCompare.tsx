import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "../components/StatusChip";
import { StormMap, type MapPointLayer } from "../components/StormMap";
import {
  catalogueName,
  getParams,
  getStormDetail,
  getTrack,
  type StormDetail,
  type StormParams,
  type StormRec,
  type Track,
} from "../lib/data";
import { fmtCount, fmtMem, fmtMeters, fmtRuntime, fmtWhen } from "../lib/format";
import { BLUE_RAMP, ORANGE_RAMP, seriesColor } from "../lib/palette";
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
  { label: "window start", value: (s) => fmtWhen(s.t_start), raw: (s) => s.t_start ?? "" },
  { label: "window end", value: (s) => fmtWhen(s.t_end), raw: (s) => s.t_end ?? "" },
  { label: "timesteps", value: (s) => fmtCount(s.n_timesteps), raw: (s) => String(s.n_timesteps ?? "") },
  { label: "runtime", value: (s) => fmtRuntime(s.runtime_seconds), raw: (s) => fmtRuntime(s.runtime_seconds) },
  { label: "memory", value: (s) => fmtMem(s.memory_mb), raw: (s) => fmtMem(s.memory_mb) },
  { label: "retries", value: (s) => fmtCount(s.n_retries), raw: (s) => String(s.n_retries ?? "") },
  { label: "coarse only", value: (s) => (s.coarse_only ? "yes" : "no"), raw: (s) => String(!!s.coarse_only) },
  { label: "slurm array", value: (s) => (s.array_job ? `${s.array_job}[${s.array_index}]` : "–"), raw: (s) => s.array_job ?? "" },
];

/** One storm, several runs: numbers in one table, surge maps side by side,
 * simulated windows overlaid on the shared observed track, and the config
 * diff — the view that shows what a configuration change did. */
export function GeoclawCompareBody({ projectId, sid, runs, manifests }: CompareBodyProps) {
  const [details, setDetails] = useState<Record<string, StormDetail | null>>({});
  const [params, setParams] = useState<Record<string, Record<string, StormParams> | null>>({});
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
    }
  }, [projectId, sid, runs, details, params]);

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
        <h2>Simulated windows on the observed track</h2>
        <StormMap layers={[]} track={track} windows={windows} />
        <div className="facts" style={{ marginTop: 8 }}>
          {windows.map((w) => (
            <span key={w.label} className="status-chip">
              <span className="dot" style={{ background: w.color }} />
              {w.label}
            </span>
          ))}
        </div>
      </div>

      <div className="compare-maps section">
        {runs.map((run) => {
          const s = storms[run];
          const d = details[run];
          const layers: MapPointLayer[] = [
            {
              key: "surge",
              label: "surge",
              points: d?.surge_gauge_points ?? [],
              total: s?.n_surge_points_total,
              ramp: BLUE_RAMP,
              caption: "peak surge",
            },
            {
              key: "depth",
              label: "depth",
              points: d?.wet_gauge_points ?? [],
              total: s?.wet_gauges,
              ramp: ORANGE_RAMP,
              caption: "peak depth",
            },
          ];
          const windowT: [number, number] | null =
            s?.t_start && s?.t_end
              ? [Date.parse(s.t_start + "Z") / 1000, Date.parse(s.t_end + "Z") / 1000]
              : null;
          return (
            <div className="card" key={run}>
              <h2>{run}</h2>
              {s ? (
                <StormMap layers={layers} context={d?.dry} track={track} windowT={windowT} />
              ) : (
                <p className="notice">Storm not in this run.</p>
              )}
            </div>
          );
        })}
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
