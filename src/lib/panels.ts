/** Normalizes a storm's animation entry into a uniform list of videos.
 *
 * New-pipeline entries carry a `panels` dict keyed by mp4-name suffix
 * ("main" for <sid>.mp4); legacy entries describe only the main/domain
 * pair through top-level fields. Either way the player gets the same
 * shape, and sync against the shared `times` axis is
 * frame = timeIndex - (times.length - frames), i.e. every video is
 * aligned to the end of the frame sequence, which is how the encoder
 * relates them (`dropped` counts the leading frames the main video lacks).
 */

import type { AnimEntry, AnimPanel } from "./data";

export interface PanelVideo {
  key: string;
  /** mp4 name suffix, "" for the main video */
  suffix: string;
  label: string;
  fps: number;
  frames: number;
  /** panels-block entries come from the fixed-scale render pipeline */
  fixedScale: boolean;
}

const PANEL_ORDER = ["surface", "speed", "wind", "pressure", "currents", "friction"];
const REGION_ORDER = ["regional", "domain"];

function order(p: AnimPanel): [number, number] {
  const pi = PANEL_ORDER.indexOf(p.panel);
  const ri = REGION_ORDER.indexOf(p.region);
  return [pi === -1 ? PANEL_ORDER.length : pi, ri === -1 ? REGION_ORDER.length : ri];
}

export function panelVideos(
  entry: AnimEntry | undefined,
  hasMp4: boolean,
  hasDomainMp4: boolean,
): PanelVideo[] {
  if (entry?.panels && Object.keys(entry.panels).length) {
    return Object.entries(entry.panels)
      .map(([key, p]) => ({
        key,
        suffix: key === "main" ? "" : `_${key}`,
        label: `${p.panel} ${p.region}`,
        fps: p.fps,
        frames: p.frames,
        fixedScale: true,
      }))
      .sort((a, b) => {
        const [pa, ra] = order(entry.panels![a.key]);
        const [pb, rb] = order(entry.panels![b.key]);
        return pa - pb || ra - rb || a.key.localeCompare(b.key);
      });
  }
  const out: PanelVideo[] = [];
  if (hasMp4) {
    out.push({
      key: "main",
      suffix: "",
      label: "surface",
      fps: entry?.fps ?? 0,
      frames: entry?.frames ?? 0,
      fixedScale: false,
    });
  }
  if (hasDomainMp4) {
    out.push({
      key: "domain",
      suffix: "_domain",
      label: "full domain",
      fps: entry?.domain_fps ?? entry?.fps ?? 0,
      frames: entry?.domain_frames ?? 0,
      fixedScale: false,
    });
  }
  return out;
}

/** currentTime for one video at master time index `idx` on the shared
 * `times` axis; null when the entry cannot be synchronised. */
export function panelSeekTime(entry: AnimEntry | undefined, video: PanelVideo, idx: number): number | null {
  const times = entry?.times;
  if (!times?.length || !video.fps || !video.frames) return null;
  const frame = idx - Math.max(0, times.length - video.frames);
  if (frame < 0) return 0;
  return (Math.min(frame, video.frames - 1) + 0.5) / video.fps;
}
