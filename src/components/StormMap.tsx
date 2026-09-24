import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBasemap, type GaugePoint, type Track } from "../lib/data";
import { chartTheme, rampCss, WIND_RAMP } from "../lib/palette";

/** fixed top of the wind colour scale, matching the fleet's wind panels */
const WIND_MAX_MS = 70;

/** Phase-shifted [2,2] dash patterns: stepping through them marches the
 * dashes toward the end of the line, i.e. the direction of travel, since
 * track coordinates are in time order. MapLibre has no dash offset, so the
 * ants are made by cycling the pattern itself. */
const ANTS: number[][] = [
  [0, 2, 2],
  [0.5, 2, 1.5],
  [1, 2, 1],
  [1.5, 2, 0.5],
  [2, 2],
  [0, 0.5, 2, 1.5],
  [0, 1, 2, 1],
  [0, 1.5, 2, 0.5],
];
const ANTS_STEP_MS = 150;

/** Hollow square icon for the observed track's end (canvas-drawn: symbol
 * glyphs would need a glyph server the offline fallback style lacks). */
function squareIcon(stroke: string, fill: string): ImageData {
  const px = 28;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 5;
  ctx.fillRect(4, 4, px - 8, px - 8);
  ctx.strokeRect(4, 4, px - 8, px - 8);
  return ctx.getImageData(0, 0, px, px);
}

/** One selectable point overlay: [lon, lat, value, id] tuples colored by a
 * sequential ramp. The project supplies the semantics (label, caption).
 * `total` is the full population size; when it exceeds points.length the
 * export was capped to the top N by value, and the UI says so. */
export interface MapPointLayer {
  key: string;
  label: string;
  points: GaugePoint[];
  total?: number;
  ramp: string[];
  caption: string;
  /** fixed top of the color scale (e.g. shared across compared runs);
   * defaults to the layer's own max */
  scaleMax?: number;
  /** signed values on a diverging ramp over [-scaleMax, +scaleMax] */
  diverging?: boolean;
  /** legend unit, defaults to metres */
  unit?: string;
}

interface Props {
  layers: MapPointLayer[];
  /** semi-transparent layers drawn UNDER the value dots and toggled
   * independently of the exclusive layer group (e.g. Δvolume cells),
   * on by default */
  overlays?: MapPointLayer[];
  /** background context dots (e.g. dry gauges), drawn small and muted */
  context?: [number, number][] | null;
  track?: Track | null;
  /** simulated window as epoch seconds; highlights that segment of the track */
  windowT?: [number, number] | null;
  /** several simulated windows overlaid in distinct colors (run comparison);
   * takes precedence over windowT */
  windows?: { label: string; color: string; t: [number, number] }[];
}

/** World basemap with land, admin borders, state names and city labels.
 * Free and keyless (OpenFreeMap); when unreachable the map falls back to the
 * bundled CONUS coastline so it still works offline. */
const WORLD_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_EXTENT: [number, number, number, number] = [-100, -65, 24, 48];

function linesToGeojson(lines: [number, number][][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((coords) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    })),
  };
}

function pointsToGeojson(points: GaugePoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(([lon, lat, v, id]) => ({
      type: "Feature",
      properties: { v, id },
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

function dotsToGeojson(points: [number, number][]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map(([lon, lat]) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lon, lat] },
    })),
  };
}

/** Color stops for a data-driven circle color over [min, max]. */
function rampStops(ramp: string[], min: number, max: number): (number | string)[] {
  const out: (number | string)[] = [];
  ramp.forEach((hex, i) => {
    out.push(min + (i / (ramp.length - 1)) * (max - min), hex);
  });
  return out;
}

function fmtUtc(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/** Linear position on the track at epoch second t, clamped to its span. */
function trackPositionAt(track: Track, t: number): [number, number] | null {
  const pts = track.points;
  if (!pts.length) return null;
  if (t <= pts[0][0]) return [pts[0][1], pts[0][2]];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return [last[1], last[2]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] >= t) {
      const [t0, lon0, lat0] = pts[i - 1];
      const [t1, lon1, lat1] = pts[i];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return [lon0 + f * (lon1 - lon0), lat0 + f * (lat1 - lat0)];
    }
  }
  return [last[1], last[2]];
}

/** The count detail shown under a layer button's name. */
function layerSub(l: MapPointLayer): string | null {
  if (!l.points.length) return null;
  if (l.total != null && l.total > l.points.length) {
    return `top ${l.points.length.toLocaleString()} of ${l.total.toLocaleString()}`;
  }
  return l.points.length.toLocaleString();
}

async function resolveStyle(): Promise<maplibregl.StyleSpecification> {
  try {
    const res = await fetch(WORLD_STYLE_URL, { signal: AbortSignal.timeout(6000) });
    if (res.ok) return (await res.json()) as maplibregl.StyleSpecification;
  } catch {
    // fall through to the bundled style
  }
  const t = chartTheme();
  const basemap = await getBasemap();
  return {
    version: 8,
    sources: {
      states: { type: "geojson", data: linesToGeojson(basemap.state_lines) as never },
      countries: { type: "geojson", data: linesToGeojson(basemap.country_lines) as never },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": t.surface } },
      { id: "states", type: "line", source: "states", paint: { "line-color": t.grid, "line-width": 0.8 } },
      { id: "countries", type: "line", source: "countries", paint: { "line-color": t.baseline, "line-width": 1.1 } },
    ],
  };
}

class RecenterControl implements maplibregl.IControl {
  private container?: HTMLDivElement;
  constructor(private onClick: () => void) {}
  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Recenter on storm";
    btn.setAttribute("aria-label", "Recenter on storm");
    btn.textContent = "⌖";
    btn.style.fontSize = "17px";
    btn.onclick = () => this.onClick();
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove(): void {
    this.container?.remove();
  }
}

/** MapLibre map of one storm: selectable point overlays and the observed
 * track (simulated window highlighted) over a world basemap. */
export function StormMap({ layers, overlays, context, track, windowT, windows }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const recenterRef = useRef<() => void>(() => undefined);
  const antsRef = useRef<number>();
  const onScreenRef = useRef(true);
  const [style, setStyle] = useState<maplibregl.StyleSpecification>();
  const [layerKey, setLayerKey] = useState(layers[0]?.key);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string>();
  const [showTrack, setShowTrack] = useState(true);
  const [hiddenOverlays, setHiddenOverlays] = useState<string[]>([]);
  // opens at "all": the map starts with every filter at its widest, and the
  // floor is opt-in for hiding the centimeter tail of the top-N export
  const [floor, setFloor] = useState(0);

  useEffect(() => {
    resolveStyle().then(setStyle, (e) => setMapError(String(e)));
  }, []);

  const active = layers.find((l) => l.key === layerKey) ?? layers[0];
  const allPoints = active?.points ?? [];
  const points = useMemo(
    () => (floor > 0 ? allPoints.filter((p) => Math.abs(p[2]) >= floor) : allPoints),
    [allPoints, floor],
  );
  const hidden = allPoints.length - points.length;
  const computedMax = useMemo(() => Math.max(0.1, ...points.map((p) => Math.abs(p[2]))), [points]);
  const scaleTop = active?.scaleMax ?? computedMax;
  const scaleMin = active?.diverging ? -scaleTop : 0;

  useEffect(() => {
    if (!containerRef.current || !style || mapRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        attributionControl: { compact: true },
        // keeps the canvas readable after each frame, so screenshots and
        // right-click "save image" capture the map instead of a cleared buffer
        preserveDrawingBuffer: true,
        bounds: [FALLBACK_EXTENT[0], FALLBACK_EXTENT[2], FALLBACK_EXTENT[1], FALLBACK_EXTENT[3]],
        fitBoundsOptions: { padding: 20 },
      });
    } catch (e) {
      setMapError(e instanceof Error ? e.message : String(e));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new RecenterControl(() => recenterRef.current()), "top-right");
    map.on("load", () => {
      setReady(true);
      // the compact attribution control starts expanded; collapse it behind
      // its info button (the credits stay one click away, licence satisfied)
      containerRef.current
        ?.querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
    });
    mapRef.current = map;
    // the ants tick skips repaints while the map is scrolled out of view
    const io = new IntersectionObserver(([e]) => {
      onScreenRef.current = e.isIntersecting;
    });
    io.observe(containerRef.current);
    return () => {
      io.disconnect();
      map.remove();
      mapRef.current = undefined;
      setReady(false);
    };
  }, [style]);

  // data layers, rebuilt when the storm or selected overlay changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const t = chartTheme();

    window.clearInterval(antsRef.current);

    const oldIds = ["context", "gauges", "track-full", "track-sim", "track-pts", "track-ends", "track-a", "track-b"];
    for (let i = 0; i < 8; i++) oldIds.push(`track-win-${i}`);
    for (const l of map.getStyle().layers ?? []) {
      if (l.id.startsWith("ov-")) oldIds.push(l.id);
    }
    for (const id of oldIds) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }

    if (context?.length) {
      map.addSource("context", { type: "geojson", data: dotsToGeojson(context) });
      map.addLayer({
        id: "context",
        type: "circle",
        source: "context",
        paint: { "circle-radius": 1.4, "circle-color": t.baseline, "circle-opacity": 0.55 },
      });
    }

    // overlays sit under the value dots, translucent so both read at once
    for (const ov of overlays ?? []) {
      if (hiddenOverlays.includes(ov.key) || !ov.points.length) continue;
      const id = `ov-${ov.key}`;
      const m = ov.scaleMax ?? Math.max(0.1, ...ov.points.map((p) => Math.abs(p[2])));
      map.addSource(id, { type: "geojson", data: pointsToGeojson(ov.points) });
      map.addLayer({
        id,
        type: "circle",
        source: id,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 5, 11, 7, 30] as never,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "v"],
            ...rampStops(ov.ramp, ov.diverging ? -m : 0, m),
          ] as never,
          "circle-opacity": 0.35,
        },
      });
    }

    if (track && showTrack) {
      const coords = track.points.map((p) => [p[1], p[2]] as [number, number]);
      map.addSource("track-full", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
      });
      map.addLayer({
        id: "track-full",
        type: "line",
        source: "track-full",
        paint: { "line-color": t.textMuted, "line-width": 1.4, "line-dasharray": ANTS[0] },
      });
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        let step = 0;
        antsRef.current = window.setInterval(() => {
          if (!onScreenRef.current) return;
          step = (step + 1) % ANTS.length;
          if (map.getLayer("track-full")) {
            map.setPaintProperty("track-full", "line-dasharray", ANTS[step]);
          }
        }, ANTS_STEP_MS);
      }
      if (windows?.length) {
        windows.forEach((w, i) => {
          const sim = track.points.filter((p) => p[0] >= w.t[0] && p[0] <= w.t[1]);
          if (sim.length < 2) return;
          const id = `track-win-${i}`;
          map.addSource(id, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: sim.map((p) => [p[1], p[2]]) },
            },
          });
          // stagger widths so identical windows remain distinguishable
          map.addLayer({
            id,
            type: "line",
            source: id,
            paint: {
              "line-color": w.color,
              "line-width": 2 + (windows.length - 1 - i) * 2.4,
              "line-opacity": 0.9,
            },
          });
        });
      } else if (windowT) {
        const sim = track.points.filter((p) => p[0] >= windowT[0] && p[0] <= windowT[1]);
        if (sim.length > 1) {
          map.addSource("track-sim", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: sim.map((p) => [p[1], p[2]]) },
            },
          });
          map.addLayer({
            id: "track-sim",
            type: "line",
            source: "track-sim",
            paint: { "line-color": t.textPrimary, "line-width": 2.2 },
          });
        }
      }

      // observed vertices, coloured by wind on the fixed 0-70 m/s scale the
      // fleet's wind panels use; vertices without a wind value stay gray
      map.addSource("track-pts", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: track.points.map(([tt, lon, lat, v, p, rmw]) => ({
            type: "Feature",
            properties: { t: tt, v, p, rmw },
            geometry: { type: "Point", coordinates: [lon, lat] },
          })),
        },
      });
      map.addLayer({
        id: "track-pts",
        type: "circle",
        source: "track-pts",
        paint: {
          "circle-radius": 3.4,
          "circle-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "v"], -1],
            -1,
            t.baseline,
            ...rampStops(WIND_RAMP, 0, WIND_MAX_MS),
          ] as never,
          "circle-stroke-color": "#fcfcfb",
          "circle-stroke-width": 0.7,
        },
      });
      // observed extremes: circle at genesis, square at the last observation
      // (the usual convention); hollow and gray like the dashed line itself,
      // so they read as a different family from the filled window rings
      const first = track.points[0];
      const last = track.points[track.points.length - 1];
      if (first && last) {
        map.addSource("track-a", {
          type: "geojson",
          data: { type: "Feature", properties: { t: first[0] }, geometry: { type: "Point", coordinates: [first[1], first[2]] } },
        });
        map.addLayer({
          id: "track-a",
          type: "circle",
          source: "track-a",
          paint: {
            "circle-radius": 5.5,
            "circle-color": "#fcfcfb",
            "circle-stroke-color": t.textSecondary,
            "circle-stroke-width": 2.2,
          },
        });
        if (!map.hasImage("track-end-square")) {
          map.addImage("track-end-square", squareIcon(t.textSecondary, "#fcfcfb"), { pixelRatio: 2 });
        }
        map.addSource("track-b", {
          type: "geojson",
          data: { type: "Feature", properties: { t: last[0] }, geometry: { type: "Point", coordinates: [last[1], last[2]] } },
        });
        map.addLayer({
          id: "track-b",
          type: "symbol",
          source: "track-b",
          layout: { "icon-image": "track-end-square", "icon-allow-overlap": true },
        });
      }

      const trackPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "track-pts", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "default";
        const pr = f.properties as { t: number; v: number | null; p: number | null; rmw: number | null };
        const wind = pr.v != null ? `${pr.v.toFixed(1)} m/s (${(pr.v * 1.944).toFixed(0)} kt)` : "–";
        trackPopup
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${wind}</strong> observed wind<br/>` +
              `<span style="color:#898781">${fmtUtc(pr.t)} · ` +
              `${pr.p != null ? pr.p.toFixed(0) + " mb" : "–"} · ` +
              `RMW ${pr.rmw != null ? pr.rmw.toFixed(0) + " km" : "–"}</span>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "track-pts", () => {
        map.getCanvas().style.cursor = "";
        trackPopup.remove();
      });
      for (const [layerId, label] of [
        ["track-a", "observed track start"],
        ["track-b", "observed track end"],
      ] as const) {
        map.on("mousemove", layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "default";
          const pr = f.properties as { t: number };
          trackPopup
            .setLngLat(e.lngLat)
            .setHTML(`<strong>${label}</strong><br/><span style="color:#898781">${fmtUtc(pr.t)}</span>`)
            .addTo(map);
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
          trackPopup.remove();
        });
      }
    }

    if (points.length) {
      map.addSource("gauges", { type: "geojson", data: pointsToGeojson(points) });
      map.addLayer({
        id: "gauges",
        type: "circle",
        source: "gauges",
        paint: {
          "circle-radius": active.diverging
            ? (["interpolate", ["linear"], ["get", "v"], scaleMin, 5.5, 0, 2.2, scaleTop, 5.5] as never)
            : (["interpolate", ["linear"], ["get", "v"], 0, 2.2, scaleTop, 5.5] as never),
          "circle-color": [
            "interpolate",
            ["linear"],
            ["get", "v"],
            ...rampStops(active.ramp, scaleMin, scaleTop),
          ] as never,
          "circle-stroke-color": "#fcfcfb",
          "circle-stroke-width": 0.6,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      map.on("mousemove", "gauges", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "default";
        const p = f.properties as { v: number; id: string };
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${p.v.toFixed(2)} m</strong> ${active.label}<br/><span style="color:#898781">${p.id}</span>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "gauges", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
    }

    // where each run's simulated interval starts and ends on the track: the
    // clipped tail is visible directly instead of only as a config number
    if (track && showTrack) {
      const winList = windows?.length
        ? windows
        : windowT
          ? [{ label: "simulated window", color: t.textPrimary, t: windowT }]
          : [];
      const endFeatures: GeoJSON.Feature[] = [];
      for (const w of winList) {
        (["start", "end"] as const).forEach((kind, k) => {
          const pos = trackPositionAt(track, w.t[k]);
          if (!pos) return;
          endFeatures.push({
            type: "Feature",
            properties: { label: w.label, color: w.color, kind, time: w.t[k] },
            geometry: { type: "Point", coordinates: pos },
          });
        });
      }
      if (endFeatures.length) {
        map.addSource("track-ends", {
          type: "geojson",
          data: { type: "FeatureCollection", features: endFeatures },
        });
        map.addLayer({
          id: "track-ends",
          type: "circle",
          source: "track-ends",
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "color"] as never,
            "circle-stroke-color": "#fcfcfb",
            "circle-stroke-width": 2,
          },
        });
        const endPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
        map.on("mousemove", "track-ends", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "default";
          const pr = f.properties as { label: string; kind: string; time: number };
          endPopup
            .setLngLat(e.lngLat)
            .setHTML(
              `<strong>${pr.label}</strong> ${pr.kind}<br/><span style="color:#898781">${fmtUtc(pr.time)}</span>`,
            )
            .addTo(map);
        });
        map.on("mouseleave", "track-ends", () => {
          map.getCanvas().style.cursor = "";
          endPopup.remove();
        });
      }
    }

    // open wide enough to see the whole track, not just the gauge cluster
    const focus: [number, number][] = points.map((p) => [p[0], p[1]] as [number, number]);
    if (track && showTrack) {
      focus.push(...track.points.map((p) => [p[1], p[2]] as [number, number]));
    }
    const fit = () => {
      if (focus.length) {
        const lons = focus.map((c) => c[0]);
        const lats = focus.map((c) => c[1]);
        map.fitBounds(
          [
            [Math.min(...lons) - 1.5, Math.min(...lats) - 1.5],
            [Math.max(...lons) + 1.5, Math.max(...lats) + 1.5],
          ],
          { padding: 20, duration: 400 },
        );
      } else {
        map.fitBounds(
          [
            [FALLBACK_EXTENT[0], FALLBACK_EXTENT[2]],
            [FALLBACK_EXTENT[1], FALLBACK_EXTENT[3]],
          ],
          { padding: 20, duration: 400 },
        );
      }
    };
    recenterRef.current = fit;
    fit();
    return () => window.clearInterval(antsRef.current);
  }, [active, context, track, showTrack, windowT, windows, points, scaleMin, scaleTop, ready, overlays, hiddenOverlays]);

  if (mapError) {
    return <p className="notice">The map could not initialize (WebGL unavailable): {mapError}</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="map-container" />
      <div className="map-legend">
        {layers.length > 1 && layers.some((l) => l.points.length > 0) && (
          <div className="seg-group wrap" role="group" aria-label="map metric">
            {layers.map((l) => (
              <button
                key={l.key}
                className={active?.key === l.key ? "active" : ""}
                onClick={() => setLayerKey(l.key)}
              >
                {l.label}
                {layerSub(l) && <span className="sub">{layerSub(l)}</span>}
              </button>
            ))}
          </div>
        )}
        {allPoints.length > 0 && (
          <div className="seg-group" role="group" aria-label="value floor" title="hide gauges below this value">
            {[0, 0.1, 0.25, 0.5].map((f) => (
              <button key={f} className={floor === f ? "active" : ""} onClick={() => setFloor(f)}>
                {f === 0 ? "all" : `≥${f} m`}
              </button>
            ))}
          </div>
        )}
        {track && (
          <div className="seg-group" role="group" aria-label="track visibility">
            <button className={showTrack ? "active" : ""} onClick={() => setShowTrack(!showTrack)}>
              track
            </button>
          </div>
        )}
        {(overlays ?? [])
          .filter((ov) => ov.points.length)
          .map((ov) => {
            const on = !hiddenOverlays.includes(ov.key);
            const m = ov.scaleMax ?? Math.max(0.1, ...ov.points.map((p) => Math.abs(p[2])));
            return (
              <span key={ov.key} className="sym-legend">
                <div className="seg-group" role="group" aria-label={`${ov.label} overlay`}>
                  <button
                    className={on ? "active" : ""}
                    onClick={() =>
                      setHiddenOverlays((prev) =>
                        on ? [...prev, ov.key] : prev.filter((k) => k !== ov.key),
                      )
                    }
                  >
                    {ov.label}
                  </button>
                </div>
                {on && (
                  <>
                    <span style={{ marginLeft: 6 }}>{ov.diverging ? `−${m.toFixed(1)}` : "0"}</span>
                    <div className="ramp" style={{ background: rampCss(ov.ramp) }} />
                    <span>
                      {ov.diverging ? "+" : ""}
                      {m.toFixed(1)} {ov.unit ?? "m"}
                    </span>
                  </>
                )}
              </span>
            );
          })}
        {points.length > 0 && (
          <span className="sym-legend">
            <span>{scaleMin < 0 ? `−${scaleTop.toFixed(1)}` : "0"}</span>
            <div className="ramp" style={{ background: active ? rampCss(active.ramp) : undefined, margin: "0 6px" }} />
            <span>
              {scaleMin < 0 ? "+" : ""}
              {scaleTop.toFixed(1)} {active?.unit ?? "m"}
            </span>
          </span>
        )}
        {track && showTrack && track.points.some((p) => p[3] != null) && (
          <span className="sym-legend">
            <span style={{ marginLeft: 8 }}>wind 0</span>
            <div className="ramp" style={{ background: rampCss(WIND_RAMP), margin: "0 6px" }} />
            <span>{WIND_MAX_MS} m/s</span>
          </span>
        )}
        {track && showTrack && (
          <span className="sym-legend">
            <span className="sym sym-circle" /> track start
            <span className="sym sym-square" /> track end
            <span className="sym sym-ring" /> window start/end
          </span>
        )}
        <span className="muted">
          {[
            points.length > 0 && active?.caption ? active.caption : null,
            ...(overlays ?? [])
              .filter((ov) => ov.points.length && !hiddenOverlays.includes(ov.key) && ov.caption)
              .map((ov) => ov.caption),
            active?.total != null && active.total > allPoints.length
              ? `showing the ${allPoints.length.toLocaleString()} highest of ${active.total.toLocaleString()} gauges`
              : null,
            hidden > 0 ? `${hidden.toLocaleString()} below ${floor} m hidden` : null,
            track && showTrack
              ? `dashed: observed track (vertices coloured by wind), solid: simulated window${windows?.length ? "s" : ""}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </div>
  );
}
