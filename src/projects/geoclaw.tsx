import { useEffect, useMemo, useState } from "react";
import { AnimPlayer } from "../components/AnimPlayer";
import { ParamsCard } from "../components/ParamsCard";
import { SeriesChart } from "../components/SeriesChart";
import { StatusChip } from "../components/StatusChip";
import { StormMap, type MapPointLayer } from "../components/StormMap";
import {
  catalogueName,
  getAnimIndex,
  getParams,
  getSeries,
  getStormDetail,
  getTrack,
  type AnimEntry,
  type StormDetail,
  type StormParams,
  type StormSeries,
  type Track,
} from "../lib/data";
import { fmtCount, fmtMem, fmtMeters, fmtRuntime, fmtWhen } from "../lib/format";
import { BLUE_RAMP, ORANGE_RAMP } from "../lib/palette";
import type { ProjectView, StormBodyProps } from "./types";

/** GeoClaw storm surge: the project's metric vocabulary and storm page. */
export const geoclaw: ProjectView = {
  id: "geoclaw",

  runTiles: (r) => [
    { label: "Storms", value: String(r.n_storms), detail: `${r.counts?.ok ?? 0} ok` },
    { label: "Animations", value: String(r.n_mp4 ?? "–"), detail: `${r.n_coarse_only ?? 0} coarse-only` },
    {
      label: "Core hours",
      value: String(Math.round(r.core_hours ?? 0)),
      detail: r.wall_hours != null ? `${Math.round(r.wall_hours)} wall-h` : undefined,
    },
    {
      label: "Runtime p50",
      value: fmtRuntime(r.runtime_seconds?.p50),
      detail: `max ${fmtRuntime(r.runtime_seconds?.max)}`,
    },
    {
      label: "Memory max",
      value: fmtMem(r.memory_mb?.max),
      detail: `min ${fmtMem(r.memory_mb?.min)}`,
    },
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
};

function GeoclawStormBody({ projectId, runId, sid, manifest, storm }: StormBodyProps) {
  const [detail, setDetail] = useState<StormDetail | null>();
  const [series, setSeries] = useState<StormSeries | null>();
  const [animIndex, setAnimIndex] = useState<Record<string, AnimEntry> | null>();
  const [params, setParams] = useState<Record<string, StormParams> | null>();
  const [track, setTrack] = useState<Track | null>();

  useEffect(() => {
    setDetail(undefined);
    setSeries(undefined);
    setTrack(undefined);
    getStormDetail(projectId, runId, sid).then(setDetail, () => setDetail(null));
    getSeries(projectId, runId, sid).then(setSeries);
    getAnimIndex(projectId, runId).then(setAnimIndex);
    getParams(projectId, runId).then(setParams);
    getTrack(projectId, catalogueName(manifest.run.catalogue), sid).then(setTrack);
  }, [projectId, runId, sid, manifest]);

  const windowT = useMemo<[number, number] | null>(() => {
    if (!storm.t_start || !storm.t_end) return null;
    return [Date.parse(storm.t_start + "Z") / 1000, Date.parse(storm.t_end + "Z") / 1000];
  }, [storm]);

  const mapLayers = useMemo<MapPointLayer[]>(
    () => [
      {
        key: "surge",
        label: "surge",
        points: detail?.surge_gauge_points ?? [],
        ramp: BLUE_RAMP,
        caption: "peak sea-surface rise above sl_init, ocean gauges",
      },
      {
        key: "depth",
        label: "depth",
        points: detail?.wet_gauge_points ?? [],
        ramp: ORANGE_RAMP,
        caption: "peak inundation depth, land gauges",
      },
    ],
    [detail],
  );

  return (
    <>
      <div className="tile-row">
        <div className="tile">
          <div className="label">Peak surge</div>
          <div className="value">{fmtMeters(storm.peak_surge_m)}</div>
          <div className="detail">{fmtWhen(storm.peak_surge_time)}</div>
        </div>
        <div className="tile">
          <div className="label">Peak depth</div>
          <div className="value">{fmtMeters(storm.peak_depth_m)}</div>
          <div className="detail">raw {fmtMeters(storm.raw_peak_depth_m)}</div>
        </div>
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
          <StormMap layers={mapLayers} context={detail?.dry} track={track} windowT={windowT} />
        </div>
      </div>

      <div className="card section">
        <h2>Water level at top gauges</h2>
        {series === undefined && <p className="muted">Loading series…</p>}
        {series === null && (
          <p className="notice">
            Gauge time series not exported for this storm yet — run scripts/assemble.py with --steps
            series --series-sids {sid}.
          </p>
        )}
        {series && <SeriesChart series={series} />}
      </div>

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
              <Row k="NaN fraction" v={storm.nan_fraction != null ? storm.nan_fraction.toFixed(4) : "–"} />
              <Row k="coarse only (AMR never refined)" v={storm.coarse_only ? "yes" : "no"} />
              <Row k="outlier flag" v={storm.outlier_flag ? "yes" : "no"} />
              <Row k="slurm array" v={storm.array_job ? `${storm.array_job}[${storm.array_index}]` : "–"} />
              <Row
                k="compact file size"
                v={storm.file_size_bytes ? `${(storm.file_size_bytes / 1e6).toFixed(1)} MB` : "–"}
              />
              <Row k="IBTrACS observations" v={fmtCount(storm.numobs)} />
            </tbody>
          </table>
        </div>
      </div>
    </>
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
