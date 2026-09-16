import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { StatusChip } from "../components/StatusChip";
import { getProjects, getRegistry, type ProjectMeta, type Registry } from "../lib/data";

export function HomePage() {
  const [projects, setProjects] = useState<ProjectMeta[]>();
  const [registries, setRegistries] = useState<Record<string, Registry>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    getProjects().then(
      (ps) => {
        setProjects(ps);
        for (const p of ps) {
          getRegistry(p.id).then(
            (reg) => setRegistries((r) => ({ ...r, [p.id]: reg })),
            () => undefined,
          );
        }
      },
      (e) => setError(String(e)),
    );
  }, []);

  return (
    <main className="page-body">
      {error && <p className="notice">Failed to load projects: {error}</p>}
      {!projects && !error && <p className="muted">Loading…</p>}
      {projects?.map((p) => (
        <section key={p.id} className="section">
          <div className="page-title">
            <h1>{p.title}</h1>
            {p.description && <span className="muted">{p.description}</span>}
          </div>
          <div className="run-cards section">
            {[...(registries[p.id]?.runs ?? [])].reverse().map((r) => (
              <Link className="run-card" key={r.name} to={`/p/${p.id}/run/${r.name}`}>
                <div className="name">{r.name}</div>
                <div className="facts">
                  <span>{r.n_storms} storms</span>
                  <span>{r.counts?.ok ?? "–"} ok</span>
                  <span>{r.core_hours != null ? `${Math.round(r.core_hours)} core-h` : ""}</span>
                  <span className="muted">{r.generated?.slice(0, 10)}</span>
                </div>
                <div className="facts" style={{ marginTop: 10 }}>
                  {Object.entries(r.counts ?? {}).map(([k, v]) => (
                    <StatusChip key={k} status={k} count={v} />
                  ))}
                </div>
              </Link>
            ))}
            {registries[p.id] && registries[p.id].runs.length === 0 && (
              <p className="notice">No runs assembled yet.</p>
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
