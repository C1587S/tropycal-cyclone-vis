/** Data access for the assembled viewer dataset under /data.
 *
 * The dataset is namespaced by project (`/data/<project>/…`); projects.json
 * at the top level lists them. All per-run assets follow shared file
 * conventions — point overlays as [lon, lat, value, id] tuples, animations
 * as mp4 + frame-time index, params as a per-storm key-value map — so new
 * projects reuse the same fetchers and components.
 */

export interface ProjectMeta {
  id: string;
  title: string;
  description?: string;
}

/** What a run covers: clipping region, basin, observed-season span, and
 * whether its storms are observed history or synthetic futures (in which
 * case gcm/scenario identify the climate pathway). Derived by assemble.py
 * from the catalogue metadata / track-set metadata, not invented. */
export interface RunScope {
  kind: "historical" | "synthetic";
  source?: string;
  region?: string;
  basin?: string;
  seasons?: [number, number];
  gcm?: string;
  scenario?: string;
}

export interface RunSummary {
  name: string;
  generated?: string;
  catalogue: string;
  n_storms: number;
  counts: Record<string, number>;
  core_hours?: number;
  n_mp4?: number;
  scope?: RunScope;
}

export interface Registry {
  runs: RunSummary[];
}

export interface PeakGauge {
  geoclaw_id: string;
  lon: number;
  lat: number;
  topo_m?: number;
  b_at_peak_m?: number;
  eta_at_peak_m?: number;
  depth_m?: number;
}

export interface StormRec {
  sid: string;
  name: string;
  season: number;
  status: string;
  category?: string;
  nc_status?: string;
  numobs?: number;
  runtime_seconds?: number;
  memory_mb?: number;
  n_retries?: number;
  n_procs?: number;
  n_timesteps?: number;
  n_gauges?: number;
  n_land_gauges?: number;
  n_surge_gauges?: number;
  n_swap_gauges?: number;
  n_excluded_gauges?: number;
  excluded_fraction?: number;
  excluded_by_band?: Record<string, { n: number; excluded: number }>;
  wet_gauges?: number;
  n_surge_points_total?: number;
  peak_depth_m?: number;
  raw_peak_depth_m?: number;
  peak_surge_m?: number;
  peak_time?: string;
  peak_surge_time?: string;
  peak_gauge?: PeakGauge;
  peak_surge_gauge?: PeakGauge;
  sl_init_m?: number;
  sl_init_spread_m?: number;
  n_deep_gauges?: number;
  t_start?: string;
  t_end?: string;
  nan_fraction?: number;
  coarse_only?: boolean;
  b_varying_fraction?: number;
  outlier_flag?: boolean;
  has_mp4?: boolean;
  has_domain_mp4?: boolean;
  anim_fig?: string | null;
  file_size_bytes?: number;
  array_job?: string | null;
  array_index?: number | null;
  triggered?: number;
}

export interface RunManifest {
  run: {
    name: string;
    generated: string;
    catalogue: string;
    compact?: string;
    jobids?: string[];
    n_storms: number;
    counts: Record<string, number>;
    n_mp4: number;
    n_coarse_only: number;
    n_outlier_flagged: number;
    core_hours: number;
    wall_hours?: number;
    wet_threshold_m?: number;
    outlier_threshold_m?: number;
    runtime_seconds?: { mean?: number; p50?: number; min?: number; max?: number };
    memory_mb?: { min: number; max: number } | null;
    sl_init_m?: { min?: number; median?: number; max?: number } | null;
    scope?: RunScope;
  };
  storms: StormRec[];
}

/** [lon, lat, value_m, gauge_id] */
export type GaugePoint = [number, number, number, string];

export interface StormDetail {
  sid: string;
  wet_gauge_points?: GaugePoint[];
  surge_gauge_points?: GaugePoint[];
  dry?: [number, number][];
  excluded?: [number, number][];
}

export interface SeriesGauge {
  id: string;
  kind: "surge" | "depth";
  peak: number;
  lon: number;
  lat: number;
  t: number[]; // epoch seconds
  h: (number | null)[];
  eta: (number | null)[];
}

export interface StormSeries {
  sid: string;
  sl_init_m?: number;
  gauges: SeriesGauge[];
}

export interface Track {
  sid: string;
  name: string;
  season: number;
  columns: string[];
  /** [epoch_s, lon, lat, v_total_ms|null, pressure_mb|null, rmw_km|null] */
  points: [number, number, number, number | null, number | null, number | null][];
}

export interface AnimEntry {
  fps: number;
  frames: number;
  domain_fps?: number;
  domain_frames?: number;
  dropped?: number;
  start_t?: number;
  times?: number[];
  fig?: string;
}

export interface StormParams {
  params_version?: string;
  params?: Record<string, unknown>;
  gauge_window_t0?: number;
  gauge_window_tfinal?: number;
  wallclock_seconds?: number;
  stable?: number;
  error?: string;
}

export interface Basemap {
  extent: [number, number, number, number];
  state_lines: [number, number][][];
  country_lines: [number, number][][];
  labels: { x: number; y: number; text: string; kind: string }[];
}

/** Data location: a remote base (e.g. a Hugging Face dataset's resolve URL)
 * via VITE_DATA_BASE, falling back to /data served alongside the app. */
const configured = (import.meta.env.VITE_DATA_BASE as string | undefined)?.replace(/\/+$/, "");
const BASE = configured || import.meta.env.BASE_URL + "data";

const cache = new Map<string, Promise<unknown>>();

async function decode(res: Response): Promise<unknown> {
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // gzip magic: the dev server or CDN may or may not transparently decompress
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function fetchJson<T>(path: string, revalidate = false): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    // registry-like files change on every publish; revalidate them against
    // the CDN's etag instead of trusting the browser cache
    p = fetch(`${BASE}/${path}`, revalidate ? { cache: "no-cache" } : undefined).then((res) => {
      if (!res.ok) {
        cache.delete(path);
        throw new Error(`fetch ${path}: HTTP ${res.status}`);
      }
      return decode(res);
    });
    cache.set(path, p);
  }
  return p as Promise<T>;
}

/** Fetch that resolves to null on 404, for optional per-storm assets. */
async function fetchOptional<T>(path: string): Promise<T | null> {
  try {
    return await fetchJson<T>(path);
  } catch {
    return null;
  }
}

export const getProjects = () => fetchJson<ProjectMeta[]>("projects.json", true);
export const getRegistry = (project: string) => fetchJson<Registry>(`${project}/index.json`, true);
export const getManifest = (project: string, run: string) =>
  fetchJson<RunManifest>(`${project}/runs/${run}/manifest.json`, true);
export const getStormDetail = (project: string, run: string, sid: string) =>
  fetchJson<StormDetail>(`${project}/runs/${run}/storms/${sid}.json.gz`);
export const getSeries = (project: string, run: string, sid: string) =>
  fetchOptional<StormSeries>(`${project}/runs/${run}/series/${sid}.json.gz`);
export const getAnimIndex = (project: string, run: string) =>
  fetchOptional<Record<string, AnimEntry>>(`${project}/runs/${run}/anim/index.json`);
export const getParams = (project: string, run: string) =>
  fetchOptional<Record<string, StormParams>>(`${project}/runs/${run}/params.json`);
export const getTrack = (project: string, catalogue: string, sid: string) =>
  fetchOptional<Track>(`${project}/catalogues/${catalogue}/tracks/${sid}.json`);
export const getBasemap = () => fetchJson<Basemap>("basemap.json");

export const animUrl = (project: string, run: string, sid: string, domain = false) =>
  `${BASE}/${project}/runs/${run}/anim/${sid}${domain ? "_domain" : ""}.mp4`;

/** Catalogue name from a manifest's absolute catalogue path. */
export function catalogueName(cataloguePath: string): string {
  const base = cataloguePath.split("/").pop() ?? cataloguePath;
  return base.replace(/\.parquet$/, "");
}
