import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NotesCard } from "../components/NotesCard";
import { StatusChip } from "../components/StatusChip";
import { getManifest, getRegistry, type Registry, type RunManifest } from "../lib/data";
import { PROJECT_VIEWS } from "../projects";

/** Generic storm-page shell: navigation, cross-run links, prev/next. The
 * project module supplies the body (tiles, map, charts, diagnostics). */
export function StormPage() {
  const { projectId = "", runId = "", sid = "" } = useParams();
  const view = PROJECT_VIEWS[projectId];
  const [manifest, setManifest] = useState<RunManifest>();
  const [registry, setRegistry] = useState<Registry>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    getManifest(projectId, runId).then(setManifest, (e) => setError(String(e)));
    getRegistry(projectId).then(setRegistry, () => undefined);
  }, [projectId, runId]);

  const storm = useMemo(() => manifest?.storms.find((s) => s.sid === sid), [manifest, sid]);

  const neighbors = useMemo(() => {
    if (!manifest) return {};
    const i = manifest.storms.findIndex((s) => s.sid === sid);
    return {
      prev: i > 0 ? manifest.storms[i - 1] : undefined,
      next: i >= 0 && i < manifest.storms.length - 1 ? manifest.storms[i + 1] : undefined,
    };
  }, [manifest, sid]);

  const otherRuns = useMemo(
    () => registry?.runs.map((r) => r.name).filter((n) => n !== runId) ?? [],
    [registry, runId],
  );

  if (!view?.StormBody) {
    return <main className="page-body"><p className="notice">No storm view for project: {projectId}</p></main>;
  }
  if (error) return <main className="page-body"><p className="notice">Failed to load {runId}: {error}</p></main>;
  if (!manifest || !storm) return <main className="page-body"><p className="muted">Loading storm…</p></main>;

  return (
    <main className="page-body">
      <div className="page-title">
        <h1>
          {storm.name} <span className="muted">{storm.season}</span>
        </h1>
        <StatusChip status={storm.status} />
        <span className="muted mono">{storm.sid}</span>
        <span style={{ flex: 1 }} />
        {otherRuns.length > 0 && (
          <Link className="btn" to={`/p/${projectId}/compare/${sid}`}>
            compare runs
          </Link>
        )}
        {otherRuns.map((r) => (
          <Link key={r} to={`/p/${projectId}/run/${r}/storm/${sid}`} className="status-chip">
            open in {r}
          </Link>
        ))}
        {neighbors.prev && (
          <Link className="btn" to={`/p/${projectId}/run/${runId}/storm/${neighbors.prev.sid}`}>
            ← {neighbors.prev.name}
          </Link>
        )}
        {neighbors.next && (
          <Link className="btn" to={`/p/${projectId}/run/${runId}/storm/${neighbors.next.sid}`}>
            {neighbors.next.name} →
          </Link>
        )}
      </div>

      <view.StormBody projectId={projectId} runId={runId} sid={sid} manifest={manifest} storm={storm} />

      <div className="card section">
        <h2>Notes</h2>
        <NotesCard term={`${projectId}/storm/${sid}`} />
      </div>
    </main>
  );
}
