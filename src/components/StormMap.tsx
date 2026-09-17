import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBasemap, type GaugePoint, type Track } from "../lib/data";
import { chartTheme, rampCss } from "../lib/palette";

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
}

interface Props {
  layers: MapPointLayer[];
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

/** Color stops for a data-driven circle color over [0, max]. */
function rampStops(ramp: string[], max: number): (number | string)[] {
  const out: (number | string)[] = [];
  ramp.forEach((hex, i) => {
    out.push((i / (ramp.length - 1)) * max, hex);
  });
  return out;
}

function layerLabel(l: MapPointLayer): string {
  if (!l.points.length) return l.label;
  if (l.total != null && l.total > l.points.length) {
    return `${l.label} (top ${l.points.length.toLocaleString()} of ${l.total.toLocaleString()})`;
  }
  return `${l.label} (${l.points.length.toLocaleString()})`;
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
export function StormMap({ layers, context, track, windowT, windows }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const recenterRef = useRef<() => void>(() => undefined);
  const [style, setStyle] = useState<maplibregl.StyleSpecification>();
  const [layerKey, setLayerKey] = useState(layers[0]?.key);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string>();

  useEffect(() => {
    resolveStyle().then(setStyle, (e) => setMapError(String(e)));
  }, []);

  const active = layers.find((l) => l.key === layerKey) ?? layers[0];
  const points = active?.points ?? [];
  const maxVal = useMemo(() => Math.max(0.1, ...points.map((p) => p[2])), [points]);

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
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
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

    const oldIds = ["context", "gauges", "track-full", "track-sim"];
    for (let i = 0; i < 8; i++) oldIds.push(`track-win-${i}`);
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

    if (track) {
      const coords = track.points.map((p) => [p[1], p[2]] as [number, number]);
      map.addSource("track-full", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } },
      });
      map.addLayer({
        id: "track-full",
        type: "line",
        source: "track-full",
        paint: { "line-color": t.textMuted, "line-width": 1.4, "line-dasharray": [2, 2] },
      });
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
    }

    if (points.length) {
      map.addSource("gauges", { type: "geojson", data: pointsToGeojson(points) });
      map.addLayer({
        id: "gauges",
        type: "circle",
        source: "gauges",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "v"], 0, 2.2, maxVal, 5.5],
          "circle-color": ["interpolate", ["linear"], ["get", "v"], ...rampStops(active.ramp, maxVal)] as never,
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

    const focus = points.length
      ? points.map((p) => [p[0], p[1]] as [number, number])
      : track
        ? track.points.map((p) => [p[1], p[2]] as [number, number])
        : [];
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
  }, [active, context, track, windowT, windows, points, maxVal, ready]);

  if (mapError) {
    return <p className="notice">The map could not initialize (WebGL unavailable): {mapError}</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="map-container" />
      <div className="map-legend">
        {layers.length > 1 && layers.some((l) => l.points.length > 0) && (
          <div className="seg-group" role="group" aria-label="map metric">
            {layers.map((l) => (
              <button
                key={l.key}
                className={active?.key === l.key ? "active" : ""}
                onClick={() => setLayerKey(l.key)}
              >
                {layerLabel(l)}
              </button>
            ))}
          </div>
        )}
        {points.length > 0 && (
          <>
            <span>0</span>
            <div className="ramp" style={{ background: active ? rampCss(active.ramp) : undefined }} />
            <span>{maxVal.toFixed(1)} m</span>
          </>
        )}
        <span className="muted">
          {points.length > 0 ? active?.caption : ""}
          {active?.total != null && active.total > points.length
            ? ` · showing the ${points.length.toLocaleString()} highest of ${active.total.toLocaleString()} gauges`
            : ""}
          {track
            ? `${points.length ? " · " : ""}dashed: observed track, solid: simulated window${windows?.length ? "s" : ""}`
            : ""}
        </span>
      </div>
    </div>
  );
}
