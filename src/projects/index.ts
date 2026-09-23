import { geoclaw } from "./geoclaw";
import type { ProjectView } from "./types";

/** Registry of project view modules. Adding a project to the viewer means
 * assembling its data under public/data/<id>/ and adding its module here. */
export const PROJECT_VIEWS: Record<string, ProjectView> = {
  [geoclaw.id]: geoclaw,
};
