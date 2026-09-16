import type { StormParams } from "../lib/data";

/** GeoClaw configuration that produced this storm's simulation, lifted from
 * the compact NetCDF's geoclaw_params_json attribute. */
export function ParamsCard({ params }: { params?: StormParams | null }) {
  if (!params) {
    return <p className="notice">Parameters not extracted for this storm yet.</p>;
  }
  if (params.error) {
    return <p className="notice">Parameter extraction failed: {params.error}</p>;
  }
  const entries = Object.entries(params.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div>
      {params.params_version && (
        <p className="secondary" style={{ marginTop: 0 }}>
          params version <strong>{params.params_version}</strong>
        </p>
      )}
      <table className="kv-table">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{v === null ? "null" : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
