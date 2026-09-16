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

/** Everything project-specific the generic pages need: the metric vocabulary
 * of the run table and tiles, and the storm page body. The shell — project /
 * run / storm navigation, filtering, sorting, cross-run links — is shared. */
export interface ProjectView {
  id: string;
  runTiles: (run: RunManifest["run"]) => RunTile[];
  stormColumns: StormColumn[];
  /** default sort column for the storm table */
  defaultSort: keyof StormRec;
  StormBody: (props: StormBodyProps) => ReactNode;
}
