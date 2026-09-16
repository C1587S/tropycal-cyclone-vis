import type { RunScope } from "../lib/data";

const BASIN_NAMES: Record<string, string> = {
  NA: "North Atlantic",
  AL: "North Atlantic",
  EP: "East Pacific",
  WP: "West Pacific",
  IO: "North Indian",
  SI: "South Indian",
  SP: "South Pacific",
  SH: "Southern Hemisphere",
};

const SCENARIO_NAMES: Record<string, string> = {
  ssp245: "SSP2-4.5",
  ssp370: "SSP3-7.0",
  ssp585: "SSP5-8.5",
  "20th": "20th century",
  reanal: "reanalysis",
};

function basinLabel(code?: string): string | undefined {
  if (!code) return undefined;
  const name = BASIN_NAMES[code] ?? BASIN_NAMES[code.split("_")[0]];
  return name ? `${name} (${code})` : code;
}

/** What a run covers — where, when, and whether the storms are observed
 * history or synthetic futures. Shown wherever a run is identified, so runs
 * of different domains or kinds cannot be confused. */
export function ScopeChips({ scope }: { scope?: RunScope | null }) {
  if (!scope) return null;
  const synthetic = scope.kind === "synthetic";
  const kindText = synthetic
    ? ["synthetic", scope.gcm?.toUpperCase(), scope.scenario && (SCENARIO_NAMES[scope.scenario] ?? scope.scenario)]
        .filter(Boolean)
        .join(" · ")
    : `historical · ${scope.source ?? "observed"}`;
  return (
    <span className="scope-chips">
      <span className={`scope-chip kind ${synthetic ? "synthetic" : "historical"}`}>{kindText}</span>
      {scope.region && <span className="scope-chip">{scope.region}</span>}
      {scope.basin && <span className="scope-chip">{basinLabel(scope.basin)}</span>}
      {scope.seasons && (
        <span className="scope-chip">
          {scope.seasons[0]}–{scope.seasons[1]}
        </span>
      )}
    </span>
  );
}
