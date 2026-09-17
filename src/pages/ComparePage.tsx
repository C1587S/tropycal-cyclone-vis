import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { getManifest, getRegistry, type Registry, type RunManifest } from "../lib/data";
import { PROJECT_VIEWS } from "../projects";

/** Generic compare shell: one storm, several runs. Owns run selection (in
 * the URL, so a comparison is shareable); the project module renders the
 * side-by-side content. */
export function ComparePage() {
  const { projectId = "", sid = "" } = useParams();
  const view = PROJECT_VIEWS[projectId];
  const [searchParams, setSearchParams] = useSearchParams();
  const [registry, setRegistry] = useState<Registry>();
  const [manifests, setManifests] = useState<Record<string, RunManifest>>({});
  const [error, setError] = useState<string>();

  const allRuns = useMemo(() => registry?.runs.map((r) => r.name) ?? [], [registry]);
  const selected = useMemo(() => {
    const q = searchParams.get("runs");
    const wanted = q ? q.split(",").filter(Boolean) : allRuns;
    return allRuns.filter((r) => wanted.includes(r));
  }, [searchParams, allRuns]);

  useEffect(() => {
    getRegistry(projectId).then(setRegistry, (e) => setError(String(e)));
  }, [projectId]);

  useEffect(() => {
    for (const run of selected) {
      if (manifests[run]) continue;
      getManifest(projectId, run).then(
        (m) => setManifests((prev) => ({ ...prev, [run]: m })),
        () => undefined,
      );
    }
  }, [projectId, selected, manifests]);

  if (!view) return <main className="page-body"><p className="notice">Unknown project: {projectId}</p></main>;
  if (error) return <main className="page-body"><p className="notice">Failed to load runs: {error}</p></main>;
  if (!view.CompareBody) return <main className="page-body"><p className="notice">No compare view for this project.</p></main>;

  const loaded = selected.filter((r) => manifests[r]);
  const storm = loaded.map((r) => manifests[r].storms.find((s) => s.sid === sid)).find(Boolean);

  const toggleRun = (run: string) => {
    const next = selected.includes(run) ? selected.filter((r) => r !== run) : [...allRuns.filter((r) => selected.includes(r) || r === run)];
    const params = new URLSearchParams(searchParams);
    if (next.length === allRuns.length) params.delete("runs");
    else params.set("runs", next.join(","));
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="page-body">
      <div className="page-title">
        <h1>
          {storm ? storm.name : sid} <span className="muted">{storm?.season ?? ""}</span>
        </h1>
        <span className="muted">across runs</span>
        <span className="muted mono">{sid}</span>
        <span style={{ flex: 1 }} />
        <div className="seg-group" role="group" aria-label="runs to compare">
          {allRuns.map((run) => (
            <button
              key={run}
              className={selected.includes(run) ? "active" : ""}
              onClick={() => toggleRun(run)}
            >
              {run}
            </button>
          ))}
        </div>
      </div>
      {loaded.length < selected.length && <p className="muted">Loading manifests…</p>}
      {loaded.length >= 2 ? (
        <view.CompareBody projectId={projectId} sid={sid} runs={loaded} manifests={manifests} />
      ) : (
        loaded.length === selected.length && (
          <p className="notice">Select at least two runs to compare.</p>
        )
      )}
    </main>
  );
}
