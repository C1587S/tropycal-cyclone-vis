"""Assemble viewer data for one GeoClaw run from the cluster mount.

The viewer serves multiple projects; everything this script writes lives
under ``public/data/<project>/`` (default project: geoclaw), and the script
registers the project in ``public/data/projects.json``.

Reads a report directory produced by coastal-core's build_report.py and
restructures it for the web app:

- ``<project>/runs/<run>/manifest.json``  slim manifest: the run block plus
  per-storm scalars. The two large point lists (wet_gauge_points,
  surge_gauge_points) are split out so the initial page load stays small.
- ``<project>/runs/<run>/storms/<sid>.json.gz``  per-storm map payload: the
  point lists plus the dry/excluded background dots from gauges/<sid>.json.
- ``<project>/runs/<run>/anim/``  the run's mp4 pair per storm and index.json.
- ``<project>/runs/<run>/params.json``  geoclaw_params_json lifted from each
  storm's compact NetCDF attributes (slow over the mount; incremental).
- ``<project>/runs/<run>/series/<sid>.json.gz``  gauge water-level time series
  for selected storms, top gauges chosen from the manifest point lists.
- ``<project>/catalogues/<cat>/tracks/<sid>.json``  observed IBTrACS track per
  storm, run-independent.
- ``<project>/index.json``  registry of assembled runs.

Everything is idempotent: rerunning refreshes in place, params extraction
skips storms already present unless --force.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import sys
import time
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = REPO_ROOT / "public" / "data"


def cil_root() -> Path:
    """The cluster filesystem root: /project/cil on the cluster itself,
    /Volumes/cil where it is mounted, or $CIL_ROOT."""
    for cand in (os.environ.get("CIL_ROOT"), "/project/cil", "/Volumes/cil"):
        if cand and Path(cand).exists():
            return Path(cand)
    raise SystemExit("cluster filesystem not found; set CIL_ROOT")


CIL = cil_root()

PROJECT_META = {
    "geoclaw": {
        "id": "geoclaw",
        "title": "GeoClaw storm surge",
        "description": (
            "Historical Atlantic tropical cyclones simulated with GeoClaw: "
            "coastal surge, gauge water levels, tracks, run diagnostics."
        ),
    },
}

TRACKS_ZARR = str(
    CIL / "coastal/tropical-cyclones/inputs/impactlab-data/coastal/"
    "data/int/tracks/historical/ibtracs/20240318/ALL.zarr"
)
BASEMAP_SRC = CIL / "coastal/tropical-cyclones/reports/basemap.json"

# Keys split out of the slim manifest into the per-storm detail file.
DETAIL_KEYS = ("wet_gauge_points", "surge_gauge_points")

SERIES_TOP_SURGE = 10  # gauges ranked by peak surge
SERIES_TOP_DEPTH = 5  # gauges ranked by peak inundation depth

# h above this counts as wet; same value as build_report.py's WET_THRESHOLD_M
WET_THRESHOLD_M = 0.05

# Gauge-animation export: hourly frames of surge (eta - sl_init) at the same
# ocean gauges the static map shows, quantized to one byte per gauge per
# frame on a scale FIXED across storms and runs so animations are comparable.
GANIM_SCALE_MAX_M = 5.0
GANIM_CADENCE_S = 3600
GANIM_NULL = 255  # quantized sentinel for "no reading this hour"


def log(msg: str) -> None:
    print(msg, flush=True)


def write_json(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"), allow_nan=False)
    path.write_text(text)
    return len(text)


def write_json_gz(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()
    data = gzip.compress(raw, 9)
    path.write_bytes(data)
    return len(data)


def load_manifest(report_dir: Path) -> dict:
    return json.loads((report_dir / "manifest.json").read_text())


def assemble_manifest(run: str, manifest: dict, out_dir: Path, scope: dict) -> None:
    slim_storms = []
    for s in manifest["storms"]:
        slim_storms.append({k: v for k, v in s.items() if k not in DETAIL_KEYS})
    run_block = {**manifest["run"], "scope": scope}
    n = write_json(out_dir / "manifest.json", {"run": run_block, "storms": slim_storms})
    log(f"{run}: slim manifest {n / 1e6:.2f} MB, {len(slim_storms)} storms, scope {scope}")


def assemble_storm_details(run: str, manifest: dict, report_dir: Path, out_dir: Path) -> None:
    storms_dir = out_dir / "storms"
    total = 0
    for s in manifest["storms"]:
        sid = s["sid"]
        detail = {"sid": sid}
        for k in DETAIL_KEYS:
            if s.get(k):
                detail[k] = s[k]
        gauge_path = report_dir / "gauges" / f"{sid}.json"
        if gauge_path.exists():
            detail.update(json.loads(gauge_path.read_text()))
        total += write_json_gz(storms_dir / f"{sid}.json.gz", detail)
    log(f"{run}: storm details {total / 1e6:.1f} MB gz")


def assemble_anim(run: str, anim_src: Path, out_dir: Path, sids: set[str]) -> None:
    anim_out = out_dir / "anim"
    anim_out.mkdir(parents=True, exist_ok=True)
    index_path = anim_src / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    write_json(anim_out / "index.json", {k: v for k, v in index.items() if k in sids})
    copied = 0
    for f in sorted(anim_src.glob("*.mp4")):
        if f.stem.replace("_domain", "") not in sids:
            continue
        dest = anim_out / f.name
        if not dest.exists() or dest.stat().st_size != f.stat().st_size:
            # copyfile, not copy2: copystat cannot replicate SMB file flags on macOS
            shutil.copyfile(f, dest)
            copied += 1
    log(f"{run}: anim copied {copied} new mp4s")


def assemble_params(run: str, manifest: dict, compact_dirs: list[Path], out_dir: Path, force: bool) -> None:
    """Lift geoclaw_params_json and related attrs from each storm's NetCDF.

    Roughly 3-4 s per file over the SMB mount, hence incremental: storms
    already present in params.json are skipped unless --force.
    """
    import xarray as xr

    params_path = out_dir / "params.json"
    existing: dict = {}
    if params_path.exists() and not force:
        existing = json.loads(params_path.read_text())

    by_sid: dict[str, Path] = {}
    for d in compact_dirs:
        for f in sorted(d.glob("*.nc")):
            by_sid[f.stem] = f  # later dirs win, same precedence as build_report

    sids = [s["sid"] for s in manifest["storms"]]
    todo = [sid for sid in sids if sid not in existing and sid in by_sid]
    log(f"{run}: params for {len(todo)} storms ({len(existing)} cached)")
    t0 = time.time()
    for i, sid in enumerate(todo):
        try:
            with xr.open_dataset(by_sid[sid]) as ds:
                rec = {"params_version": str(ds.attrs.get("params_version", ""))}
                raw = ds.attrs.get("geoclaw_params_json")
                if raw:
                    rec["params"] = json.loads(raw)
                for k in ("gauge_window_t0", "gauge_window_tfinal", "wallclock_seconds", "stable"):
                    v = ds.attrs.get(k, "")
                    if v != "" and v is not None:
                        rec[k] = float(v)
                existing[sid] = rec
        except Exception as exc:  # noqa: BLE001 -- record and continue, one bad file must not kill the pass
            existing[sid] = {"error": f"{type(exc).__name__}: {exc}"}
        if (i + 1) % 20 == 0:
            write_json(params_path, existing)
            rate = (i + 1) / (time.time() - t0)
            log(f"  {i + 1}/{len(todo)} ({rate:.1f}/s)")
    write_json(params_path, existing)
    log(f"{run}: params.json {params_path.stat().st_size / 1e3:.0f} KB, {len(existing)} storms")


def _finite_series(t_s: np.ndarray, *ys: np.ndarray):
    """Compress to the samples where any series is finite (gauges report on
    their own staggered hourly clocks; the union axis is mostly NaN)."""
    mask = np.zeros(len(t_s), dtype=bool)
    for y in ys:
        mask |= np.isfinite(y)
    return t_s[mask], [y[mask] for y in ys]


def _round_list(a: np.ndarray, nd: int = 3) -> list:
    return [None if not np.isfinite(v) else round(float(v), nd) for v in a]


def assemble_series(run: str, manifest: dict, compact_dirs: list[Path], out_dir: Path, sids: list[str]) -> None:
    """Export water-level series for selected storms at their top gauges."""
    import pandas as pd
    import xarray as xr

    by_sid: dict[str, Path] = {}
    for d in compact_dirs:
        for f in sorted(d.glob("*.nc")):
            by_sid[f.stem] = f
    storms = {s["sid"]: s for s in manifest["storms"]}

    for sid in sids:
        if sid not in by_sid or sid not in storms:
            log(f"{run}: {sid} not in run, skipping series")
            continue
        s = storms[sid]
        want: list[tuple[str, str, float]] = []  # (gauge_id, kind, peak)
        for lon, lat, val, gid in sorted(s.get("surge_gauge_points", []), key=lambda p: -p[2])[:SERIES_TOP_SURGE]:
            want.append((gid, "surge", val))
        seen = {g for g, _, _ in want}
        for lon, lat, val, gid in sorted(s.get("wet_gauge_points", []), key=lambda p: -p[2])[:SERIES_TOP_DEPTH]:
            if gid not in seen:
                want.append((gid, "depth", val))
        if not want:
            log(f"{run}: {sid} has no ranked gauges, skipping series")
            continue

        t0 = time.time()
        with xr.open_dataset(by_sid[sid]) as ds:
            gids = ds["geoclaw_id"].values.astype(str)
            idx = {g: i for i, g in enumerate(gids)}
            cols = [idx[g] for g, _, _ in want if g in idx]
            sub = ds.isel(geoclaw_id=cols)[["h", "eta", "gauge_lon", "gauge_lat"]].load()
            times = pd.to_datetime(ds["t"].values)
        t_s = (times.astype("int64") // 10**9).to_numpy()

        gauges = []
        for j, (gid, kind, peak) in enumerate([w for w in want if w[0] in idx]):
            h = sub["h"].values[:, j]
            eta = sub["eta"].values[:, j]
            tt, (hh, ee) = _finite_series(t_s, h, eta)
            gauges.append(
                {
                    "id": gid,
                    "kind": kind,
                    "peak": peak,
                    "lon": round(float(sub["gauge_lon"].values[j]), 3),
                    "lat": round(float(sub["gauge_lat"].values[j]), 3),
                    "t": [int(v) for v in tt],
                    "h": _round_list(hh),
                    "eta": _round_list(ee),
                }
            )
        payload = {"sid": sid, "sl_init_m": s.get("sl_init_m"), "gauges": gauges}
        n = write_json_gz(out_dir / "series" / f"{sid}.json.gz", payload)
        log(f"{run}: series {sid} {len(gauges)} gauges {n / 1e3:.0f} KB gz in {time.time() - t0:.0f} s")


def assemble_ganim(run: str, manifest: dict, compact_dirs: list[Path], out_dir: Path,
                   sids: list[str] | None, force: bool) -> None:
    """Hourly surge frames per storm for the in-browser gauge animation.

    Uses the same gauge population as the static surge map (the manifest's
    surge_gauge_points, already filtered and capped by build_report), reads
    eta from the compact NetCDF, masks dry steps (eta is topography while a
    cell is dry), and takes each gauge's last wet reading within each hour.
    Values are surge anomalies (eta - sl_init) quantized to a byte on the
    fixed 0..GANIM_SCALE_MAX_M scale; GANIM_NULL means no reading.
    Incremental: existing files are kept unless --force.
    """
    import pandas as pd
    import xarray as xr

    by_sid: dict[str, Path] = {}
    for d in compact_dirs:
        for f in sorted(d.glob("*.nc")):
            by_sid[f.stem] = f
    storms = {s["sid"]: s for s in manifest["storms"]}
    targets = sids or [s["sid"] for s in manifest["storms"] if s.get("surge_gauge_points")]

    done = skipped = 0
    t_start = time.time()
    for sid in targets:
        out = out_dir / "ganim" / f"{sid}.json.gz"
        if out.exists() and not force:
            skipped += 1
            continue
        s = storms.get(sid)
        pts = (s or {}).get("surge_gauge_points") or []
        sl = (s or {}).get("sl_init_m")
        if not pts or sl is None or sid not in by_sid:
            continue
        with xr.open_dataset(by_sid[sid]) as ds:
            gids = ds["geoclaw_id"].values.astype(str)
            idx = {g: i for i, g in enumerate(gids)}
            keep = [p for p in pts if p[3] in idx]
            cols = [idx[p[3]] for p in keep]
            eta = ds["eta"].values[:, cols]
            h = ds["h"].values[:, cols]
            t = (pd.to_datetime(ds["t"].values).astype("int64") // 10**9).to_numpy()
        eta = np.where(h > WET_THRESHOLD_M, eta, np.nan)

        t0 = int(t[0] // GANIM_CADENCE_S * GANIM_CADENCE_S)
        times = list(range(t0 + GANIM_CADENCE_S, int(t[-1]) + GANIM_CADENCE_S, GANIM_CADENCE_S))
        frames = []
        for ft in times:
            window = np.flatnonzero((t > ft - GANIM_CADENCE_S) & (t <= ft))
            vals = np.full(len(cols), np.nan)
            for j in window:  # a handful of steps per hour; later steps win
                row = eta[j]
                vals = np.where(np.isfinite(row), row, vals)
            surge = vals - sl
            q = np.where(
                np.isfinite(surge),
                np.clip(np.round(surge / GANIM_SCALE_MAX_M * (GANIM_NULL - 1)), 0, GANIM_NULL - 1),
                GANIM_NULL,
            ).astype(int)
            frames.append([int(v) for v in q])
        payload = {
            "sid": sid,
            "scale_max": GANIM_SCALE_MAX_M,
            "lon": [round(float(p[0]), 3) for p in keep],
            "lat": [round(float(p[1]), 3) for p in keep],
            "times": times,
            "frames": frames,
        }
        n = write_json_gz(out, payload)
        done += 1
        log(f"{run}: ganim {sid} {len(keep)} gauges x {len(times)} frames {n / 1e3:.0f} KB gz")
    if done or skipped:
        log(f"{run}: ganim {done} exported, {skipped} cached in {time.time() - t_start:.0f} s")


def assemble_tracks(manifest: dict, catalogue_name: str, project_root: Path) -> None:
    """Observed IBTrACS tracks for every storm in the manifest (run-independent)."""
    import pandas as pd
    import xarray as xr

    out = project_root / "catalogues" / catalogue_name / "tracks"
    ds = xr.open_zarr(TRACKS_ZARR, consolidated=True)
    zarr_sids = ds["sid"].values.astype(str)
    pos = {sid: i for i, sid in enumerate(zarr_sids)}
    sids = [s["sid"] for s in manifest["storms"]]
    missing = [sid for sid in sids if sid not in pos]
    if missing:
        log(f"tracks: {len(missing)} sids not in zarr: {missing[:5]}")
    rows = [pos[sid] for sid in sids if sid in pos]
    sel = ds[["datetime", "longstore", "latstore", "v_total", "pstore", "rmstore", "numobs", "name", "season"]]
    sel = sel.isel(storm=rows).load()

    total = 0
    for k, sid in enumerate([sid for sid in sids if sid in pos]):
        n = int(sel["numobs"].values[k])
        dt = pd.to_datetime(sel["datetime"].values[k, :n])
        points = []
        for j in range(n):
            lon, lat = float(sel["longstore"].values[k, j]), float(sel["latstore"].values[k, j])
            if not (np.isfinite(lon) and np.isfinite(lat)):
                continue
            v = sel["v_total"].values[k, j]
            p = sel["pstore"].values[k, j]
            r = sel["rmstore"].values[k, j]
            points.append(
                [
                    int(dt[j].timestamp()),
                    round(lon, 3),
                    round(lat, 3),
                    None if not np.isfinite(v) else round(float(v), 1),
                    None if not np.isfinite(p) else round(float(p), 1),
                    None if not np.isfinite(r) else round(float(r), 1),
                ]
            )
        total += write_json(
            out / f"{sid}.json",
            {
                "sid": sid,
                "name": str(sel["name"].values[k]),
                "season": int(sel["season"].values[k]),
                "columns": ["t", "lon", "lat", "v_total_ms", "pressure_mb", "rmw_km"],
                "points": points,
            },
        )
    log(f"tracks: {len(rows)} storms, {total / 1e6:.1f} MB into {out}")


def derive_scope(manifest: dict, catalogue_name: str) -> dict:
    """What domain this run covers, read from what the pipeline records.

    The catalogue's sibling .meta.txt (written by geoclaw_runner's catalogue
    builder) records filter_region and filter_basin explicitly; when it is
    absent the same tokens are recovered from the catalogue filename
    (<region>_<basin>_<era>_<version>) and the storm records. All current
    GeoClaw runs simulate observed IBTrACS storms, hence kind=historical;
    synthetic-track projects (Emanuel sets) will set kind=synthetic with
    gcm/scenario from their own metadata (stats.txt: Model/Type/Years).
    """
    scope = {"kind": "historical", "source": "IBTrACS"}

    cat_path = Path(manifest["run"]["catalogue"].replace("/project/cil", str(CIL)))
    meta_path = cat_path.parent / (cat_path.stem + ".meta.txt")
    meta: dict[str, str] = {}
    if meta_path.exists():
        for line in meta_path.read_text().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()

    tokens = catalogue_name.split("_")
    scope["region"] = (meta.get("filter_region") or (tokens[0] if tokens else "")).upper()
    scope["basin"] = (meta.get("filter_basin") or (tokens[1] if len(tokens) > 1 else "")).upper()

    seasons = [s.get("season") for s in manifest["storms"] if s.get("season")]
    if seasons:
        scope["seasons"] = [int(min(seasons)), int(max(seasons))]
    return scope


def register_project(project: str) -> None:
    """Ensure the project appears in the top-level projects.json."""
    path = DATA_ROOT / "projects.json"
    projects = json.loads(path.read_text()) if path.exists() else []
    if not any(p.get("id") == project for p in projects):
        projects.append(PROJECT_META.get(project, {"id": project, "title": project}))
        write_json(path, projects)


def update_registry(run: str, manifest: dict, catalogue_name: str, project_root: Path, scope: dict) -> None:
    reg_path = project_root / "index.json"
    registry = json.loads(reg_path.read_text()) if reg_path.exists() else {"runs": []}
    r = manifest["run"]
    entry = {
        "name": run,
        "generated": r.get("generated"),
        "catalogue": catalogue_name,
        "n_storms": r.get("n_storms"),
        "counts": r.get("counts"),
        "core_hours": r.get("core_hours"),
        "n_mp4": r.get("n_mp4"),
        "scope": scope,
    }
    registry["runs"] = [e for e in registry["runs"] if e["name"] != run] + [entry]
    registry["runs"].sort(key=lambda e: e.get("generated") or "")
    write_json(reg_path, registry)
    log(f"registry: {[e['name'] for e in registry['runs']]}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--project", default="geoclaw", help="project id under public/data/")
    p.add_argument("--run", required=True, help="run name, e.g. per_storm_v2")
    p.add_argument("--report-dir", required=True, help="report dir holding manifest.json and gauges/")
    p.add_argument("--anim-dir", help="dir holding <sid>.mp4 pairs and index.json for this run")
    p.add_argument("--compact", help="comma-separated compact dirs, lowest precedence first")
    p.add_argument("--steps", default="manifest,details,anim",
                   help="comma list of: manifest,details,anim,params,tracks,series,ganim")
    p.add_argument("--series-sids", default="", help="comma list of sids for the series step")
    p.add_argument("--ganim-sids", default="", help="restrict the ganim step to these sids")
    p.add_argument("--force", action="store_true", help="recompute params already cached")
    args = p.parse_args()

    report_dir = Path(args.report_dir)
    manifest = load_manifest(report_dir)
    catalogue_name = Path(manifest["run"]["catalogue"]).stem
    project_root = DATA_ROOT / args.project
    out_dir = project_root / "runs" / args.run
    steps = {s.strip() for s in args.steps.split(",") if s.strip()}
    compact_dirs = [Path(d) for d in (args.compact or manifest["run"].get("compact", "")).replace(
        "/project/cil", str(CIL)).split(",") if d]

    basemap_dest = DATA_ROOT / "basemap.json"
    if not basemap_dest.exists() and Path(BASEMAP_SRC).exists():
        basemap_dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(BASEMAP_SRC, basemap_dest)

    register_project(args.project)
    if "manifest" in steps:
        scope = derive_scope(manifest, catalogue_name)
        assemble_manifest(args.run, manifest, out_dir, scope)
        update_registry(args.run, manifest, catalogue_name, project_root, scope)
    if "details" in steps:
        assemble_storm_details(args.run, manifest, report_dir, out_dir)
    if "anim" in steps:
        if not args.anim_dir:
            p.error("--anim-dir is required for the anim step")
        assemble_anim(args.run, Path(args.anim_dir), out_dir, {s["sid"] for s in manifest["storms"]})
    if "params" in steps:
        assemble_params(args.run, manifest, compact_dirs, out_dir, args.force)
    if "tracks" in steps:
        assemble_tracks(manifest, catalogue_name, project_root)
    if "series" in steps:
        sids = [s.strip() for s in args.series_sids.split(",") if s.strip()]
        assemble_series(args.run, manifest, compact_dirs, out_dir, sids)
    if "ganim" in steps:
        sids = [s.strip() for s in args.ganim_sids.split(",") if s.strip()] or None
        assemble_ganim(args.run, manifest, compact_dirs, out_dir, sids, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
