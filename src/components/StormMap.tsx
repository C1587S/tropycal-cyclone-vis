import maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBasemap, type Basemap, type GaugePoint, type Track } from "../lib/data";
import { chartTheme, rampCss } from "../lib/palette";

/** One selectable point overlay: [lon, lat, value, id] tuples colored by a
 * sequential ramp. The project supplies the semantics (label, caption). */
export interface MapPointLayer {
  key: string;
  label: string;
  points: GaugePoint[];
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
}

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

function createMap(
  container: HTMLDivElement,
  basemap: Basemap,
  t: ReturnType<typeof chartTheme>,
): maplibregl.Map {
  return new maplibregl.Map({
    container,
    attributionControl: false,
    // keeps the canvas readable after each frame, so screenshots and
    // right-click "save image" capture the map instead of a cleared buffer
    preserveDrawingBuffer: true,
    style: {
      version: 8,
      sources: {
        states: { type: "geojson", data: linesToGeojson(basemap.state_lines) },
        countries: { type: "geojson", data: linesToGeojson(basemap.country_lines) },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": t.surface } },
        {
          id: "states",
          type: "line",
          source: "states",
          paint: { "line-color": t.grid, "line-width": 0.8 },
        },
        {
          id: "countries",
          type: "line",
          source: "countries",
          paint: { "line-color": t.baseline, "line-width": 1.1 },
        },
      ],
    },
    bounds: [basemap.extent[0], basemap.extent[2], basemap.extent[1], basemap.extent[3]],
    fitBoundsOptions: { padding: 20 },
  });
}

/** MapLibre map of one storm: selectable point overlays over the bundled
 * coastline basemap, with an optional track whose simulated window is
 * highlighted. Fully self-contained — no external tile server. */
export function StormMap({ layers, context, track, windowT }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const [basemap, setBasemap] = useState<Basemap>();
  const [layerKey, setLayerKey] = useState(layers[0]?.key);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string>();

  useEffect(() => {
    getBasemap().then(setBasemap, () => setBasemap(undefined));
  }, []);

  const active = layers.find((l) => l.key === layerKey) ?? layers[0];
  const points = active?.points ?? [];
  const maxVal = useMemo(() => Math.max(0.1, ...points.map((p) => p[2])), [points]);

  useEffect(() => {
    if (!containerRef.current || !basemap || mapRef.current) return;
    const t = chartTheme();
    let map: maplibregl.Map;
    try {
      map = createMap(containerRef.current, basemap, t);
    } catch (e) {
      setMapError(e instanceof Error ? e.message : String(e));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = undefined;
      setReady(false);
    };
  }, [basemap]);

  // data layers, rebuilt when the storm or selected overlay changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const t = chartTheme();

    for (const id of ["context", "gauges", "track-full", "track-sim"]) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }

    if (context?.length) {
      map.addSource("context", { type: "geojson", data: dotsToGeojson(context) });
      map.addLayer({
        id: "context",
        type: "circle",
        source: "context",
        paint: { "circle-radius": 1.4, "circle-color": t.grid, "circle-opacity": 0.7 },
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
        paint: { "line-color": t.textMuted, "line-width": 1.3, "line-dasharray": [2, 2] },
      });
      if (windowT) {
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
          "circle-stroke-color": t.surface,
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

      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lons) - 1.5, Math.min(...lats) - 1.5],
          [Math.max(...lons) + 1.5, Math.max(...lats) + 1.5],
        ],
        { padding: 20, duration: 400 },
      );
    } else if (track) {
      const lons = track.points.map((p) => p[1]);
      const lats = track.points.map((p) => p[2]);
      map.fitBounds(
        [
          [Math.min(...lons) - 1, Math.min(...lats) - 1],
          [Math.max(...lons) + 1, Math.max(...lats) + 1],
        ],
        { padding: 20, duration: 400 },
      );
    }
  }, [active, context, track, windowT, points, maxVal, ready]);

  if (mapError) {
    return <p className="notice">The map could not initialize (WebGL unavailable): {mapError}</p>;
  }

  return (
    <div>
      <div ref={containerRef} className="map-container" />
      <div className="map-legend">
        {layers.length > 1 && (
          <div className="seg-group" role="group" aria-label="map metric">
            {layers.map((l) => (
              <button
                key={l.key}
                className={active?.key === l.key ? "active" : ""}
                onClick={() => setLayerKey(l.key)}
              >
                {l.label} {l.points.length ? `(${l.points.length})` : ""}
              </button>
            ))}
          </div>
        )}
        <span>0</span>
        <div className="ramp" style={{ background: active ? rampCss(active.ramp) : undefined }} />
        <span>{maxVal.toFixed(1)} m</span>
        <span className="muted">
          {active?.caption}
          {track ? " · dashed: observed track, solid: simulated window" : ""}
        </span>
      </div>
    </div>
  );
}
