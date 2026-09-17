import { useEffect, useMemo, useRef, useState } from "react";
import { animUrl, type AnimEntry } from "../lib/data";
import { panelSeekTime, panelVideos } from "../lib/panels";
import { fmtRelHours } from "../lib/format";

interface Props {
  project: string;
  run: string;
  sid: string;
  entry?: AnimEntry;
  hasMp4: boolean;
  hasDomainMp4: boolean;
}

/** A storm's animation panels, any subset on screen at once, driven by one
 * slider on the simulation clock (seconds relative to closest approach).
 * Legacy storms expose their main/domain pair the same way; multi-panel
 * storms add wind, pressure, currents and zoom panels from the index's
 * `panels` block. */
export function AnimPlayer({ project, run, sid, entry, hasMp4, hasDomainMp4 }: Props) {
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const videos = useMemo(() => panelVideos(entry, hasMp4, hasDomainMp4), [entry, hasMp4, hasDomainMp4]);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const preferred = ["main", "domain"].filter((k) => videos.some((v) => v.key === k));
    setSelected(preferred.length ? preferred : videos.slice(0, 1).map((v) => v.key));
  }, [videos]);

  const times = entry?.times ?? [];
  const canSync = times.length > 1 && videos.some((v) => v.fps > 0);

  // open at closest approach (t = 0), not at the start of the window
  useEffect(() => {
    let best = 0;
    for (let j = 1; j < times.length; j++) {
      if (Math.abs(times[j]) < Math.abs(times[best])) best = j;
    }
    setIdx(best);
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, run, sid, entry]);

  useEffect(() => {
    if (!playing || !canSync) return;
    const id = setInterval(() => setIdx((v) => (v + 1) % times.length), 200);
    return () => clearInterval(id);
  }, [playing, canSync, times.length]);

  useEffect(() => {
    if (!canSync) return;
    for (const v of videos) {
      if (!selected.includes(v.key)) continue;
      const el = videoRefs.current[v.key];
      const t = panelSeekTime(entry, v, idx);
      if (el && t != null) el.currentTime = t;
    }
  }, [idx, canSync, videos, selected, entry]);

  if (!videos.length) {
    return <p className="notice">No animation was rendered for this storm.</p>;
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      }
      return videos.map((v) => v.key).filter((k) => prev.includes(k) || k === key);
    });
  };

  const shown = videos.filter((v) => selected.includes(v.key));

  return (
    <div>
      {videos.length > 1 && (
        <div className="seg-group wrap" role="group" aria-label="panels" style={{ marginBottom: 10 }}>
          {videos.map((v) => (
            <button key={v.key} className={selected.includes(v.key) ? "active" : ""} onClick={() => toggle(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="panel-grid">
        {shown.map((v) => (
          <div key={v.key}>
            {shown.length > 1 && (
              <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>
                {v.label}
              </div>
            )}
            <video
              ref={(el) => {
                videoRefs.current[v.key] = el;
              }}
              src={animUrl(project, run, sid, v.suffix)}
              muted
              playsInline
              preload="auto"
              controls={!canSync}
              style={{ width: "100%", borderRadius: 6, background: "#000" }}
            />
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
            max={times.length - 1}
            value={Math.min(idx, times.length - 1)}
            onChange={(e) => {
              setPlaying(false);
              setIdx(Number(e.target.value));
            }}
          />
          <span className="time-label">{fmtRelHours(times[Math.min(idx, times.length - 1)] ?? 0)}</span>
        </div>
      )}
      {canSync && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          time is relative to closest approach
        </div>
      )}
    </div>
  );
}
