# tropycal-cyclone-vis

Web viewer for tropical cyclone simulation runs, organized by project. The
first project is GeoClaw storm surge (historical Atlantic cyclones: per-storm
surge animations, coastal gauge water levels, tracks, run diagnostics); the
structure anticipates further projects (e.g. synthetic-track wind field
processing) that share the same shape — a run produces per-storm artefacts,
and runs are compared against each other.

Static site, no backend: a Vite + React + TypeScript app reading pre-assembled
JSON/mp4 under `public/data/`, deployed on Vercel. Maps are MapLibre GL over a
bundled coastline basemap (no external tile server); charts are ECharts.

## Layout

```
scripts/assemble.py     assembles public/data/geoclaw from a run's report dir
scripts/smoke.mjs       headless smoke test against a preview server
src/
  pages/                generic shells: project list, run overview, storm page
  projects/             one module per project (columns, tiles, storm body)
  components/           shared: map, animation player, charts, tables
  lib/                  data fetchers, formatters, palette
public/data/
  projects.json         list of projects
  basemap.json          coastline/state lines for the map (shared)
  <project>/
    index.json          registry of assembled runs
    catalogues/<cat>/tracks/<sid>.json    observed track per storm
    runs/<run>/
      manifest.json     slim run manifest (scalars only)
      storms/<sid>.json.gz  point overlays for the map
      series/<sid>.json.gz  time series at selected points (selected storms)
      params.json       model parameters per storm
      anim/             <sid>.mp4, <sid>_domain.mp4, index.json (frame times)
```

URLs mirror the data: `/p/<project>/run/<run>` and
`/p/<project>/run/<run>/storm/<sid>`; filters and view state live in query
params, so any view is shareable by link.

### File conventions shared across projects

- map overlays: lists of `[lon, lat, value, id]`
- time series: `{t: [epoch_s], …series arrays}` compressed to finite samples
- animations: mp4 (plus optional `_domain` pane) with an `index.json` of
  per-frame times, which is what makes cross-run scrubbing alignable
- params: `{sid: {params: {...}, params_version}}`

A new project keeps these file shapes, assembles under `public/data/<id>/`,
and adds one module in `src/projects/` implementing `ProjectView` (run tiles,
table columns, storm-page body) from the shared components.

## Development

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production bundle in dist/
npm run preview    # serve dist/ on :4173
npm run smoke      # needs preview running; screenshots + console/map checks
```

## Adding a GeoClaw run

On a machine with the cluster filesystem mounted at `/Volumes/cil`:

```
python3 scripts/assemble.py \
  --run <run_name> \
  --report-dir /Volumes/cil/home_dirs/dtadeo/coastal-core/reports/<run_name> \
  --anim-dir   /Volumes/cil/home_dirs/dtadeo/coastal-core/reports/anim \
  --steps manifest,details,anim,params,tracks
```

The report directory must be one produced by coastal-core's
`geoclaw_runner/scripts/build_report.py` (manifest.json + gauges/). The params
step reads every storm's compact NetCDF over the mount (slow, cached and
incremental); tracks reads the processed IBTrACS zarr and only needs rerunning
for a new catalogue. Gauge time series are exported per storm on demand:

```
python3 scripts/assemble.py --run <run_name> --report-dir ... \
  --steps series --series-sids 2005236N23285,2008245N17323
```

Then commit `public/data/` changes and push; Vercel redeploys. To move the data
off the repo later (e.g. a Hugging Face dataset), change `BASE` in
`src/lib/data.ts` — the layout is already URL-shaped.

## Deploying

Import the GitHub repo in Vercel; framework preset Vite, defaults are fine
(`vercel.json` provides the SPA rewrite). The deployment URL is reachable by
anyone with the link (intentional — results are shared by link); `noindex`
keeps it out of search engines.
