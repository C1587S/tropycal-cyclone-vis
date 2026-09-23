import type { ReactNode } from "react";
import type { RunManifest, StormRec } from "../lib/data";

/** One tile in the run-overview header. */
export interface RunTile {
  label: string;
  value: string;
  detail?: string;
}

/** One column of the run-overview storm table. */
export interface StormColumn {
  key: keyof StormRec;
  label: string;
  num?: boolean;
  render?: (s: StormRec) => ReactNode;
}

export interface StormBodyProps {
  projectId: string;
  runId: string;
  sid: string;
  manifest: RunManifest;
  storm: StormRec;
}

export interface CompareBodyProps {
  projectId: string;
  sid: string;
  /** selected run names, in display order */
  runs: string[];
  /** loaded manifests keyed by run name */
  manifests: Record<string, RunManifest>;
}

/** Everything project-specific the generic pages need. Storm-centric
 * projects (runs of storms) supply the run-table vocabulary and storm-page
 * body; projects with a different shape supply a Landing page instead and
 * skip the run/storm machinery. The shell — navigation, filtering, sorting,
 * cross-run links — is shared where it applies. */
export interface ProjectView {
  id: string;
  runTiles?: (run: RunManifest["run"]) => RunTile[];
  stormColumns?: StormColumn[];
  /** default sort column for the storm table */
  defaultSort?: keyof StormRec;
  StormBody?: (props: StormBodyProps) => ReactNode;
  /** side-by-side view of one storm across runs */
  CompareBody?: (props: CompareBodyProps) => ReactNode;
  /** custom project page at /p/<id> for non-run-shaped projects */
  Landing?: (props: { projectId: string }) => ReactNode;
}
