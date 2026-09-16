import { useEffect, useRef, useState } from "react";
import { animUrl, type AnimEntry } from "../lib/data";
import { fmtRelHours } from "../lib/format";

interface Props {
  project: string;
  run: string;
  sid: string;
  entry?: AnimEntry;
  hasMp4: boolean;
  hasDomainMp4: boolean;
}

/** Paired surge/domain animation driven by one slider.
 *
 * The domain pane covers every plotted frame; the surge pane usually starts
 * later (its first `dropped` frames were dry and not encoded), so the shared
 * slider walks domain frames and maps each one onto the surge video where it
 * exists. Frame times come from anim/index.json and are seconds relative to
 * the storm's closest approach.
 */
export function AnimPlayer({ project, run, sid, entry, hasMp4, hasDomainMp4 }: Props) {
  const mainRef = useRef<HTMLVideoElement>(null);
  const domainRef = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  const canSync = !!entry && hasMp4 && hasDomainMp4 && !!entry.times?.length;
  const nFrames = canSync ? entry!.domain_frames ?? entry!.times!.length : entry?.frames ?? 0;
  const dropped = entry?.dropped ?? 0;

  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [project, run, sid]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % Math.max(1, nFrames)), 200);
    return () => clearInterval(id);
  }, [playing, nFrames]);

  useEffect(() => {
    if (!entry) return;
    const domainFps = entry.domain_fps ?? entry.fps;
    if (domainRef.current && hasDomainMp4) domainRef.current.currentTime = (frame + 0.5) / domainFps;
    if (mainRef.current && hasMp4) {
      const mainFrame = canSync ? frame - dropped : frame;
      if (mainFrame >= 0) mainRef.current.currentTime = (Math.min(mainFrame, (entry.frames ?? 1) - 1) + 0.5) / entry.fps;
      else mainRef.current.currentTime = 0;
    }
  }, [frame, entry, canSync, dropped, hasMp4, hasDomainMp4]);

  if (!hasMp4 && !hasDomainMp4) {
    return <p className="notice">No animation was rendered for this storm.</p>;
  }

  const t = entry?.times?.[frame];

  return (
    <div>
      <div className="anim-panes">
        {hasMp4 && (
          <video ref={mainRef} src={animUrl(project, run, sid)} muted playsInline preload="auto" controls={!entry} />
        )}
        {hasDomainMp4 && (
          <div className={hasMp4 ? "domain-pane" : undefined}>
            <video ref={domainRef} src={animUrl(project, run, sid, true)} muted playsInline preload="auto" controls={!entry} />
            {hasMp4 && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>full domain</div>}
          </div>
        )}
      </div>
      {entry && nFrames > 1 && (
        <div className="anim-controls">
          <button className="btn" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={nFrames - 1}
            value={frame}
            onChange={(e) => {
              setPlaying(false);
              setFrame(Number(e.target.value));
            }}
          />
          <span className="time-label">{t != null ? `${fmtRelHours(t)}` : `${frame + 1}/${nFrames}`}</span>
        </div>
      )}
      {entry && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>time is relative to closest approach</div>}
    </div>
  );
}
