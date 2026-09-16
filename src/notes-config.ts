/** Giscus configuration for storm notes.
 *
 * Notes live as GitHub Discussions in a separate PUBLIC repo, one thread per
 * storm, shared across runs (the thread is keyed on project + storm id, not
 * on the run). To enable:
 *
 * 1. Create a public repo for notes (e.g. <user>/tropycal-cyclone-notes)
 *    and enable Discussions in its settings.
 * 2. Create a discussion category for notes; type "Announcements" so only
 *    giscus opens threads.
 * 3. Install the giscus app on that repo: https://github.com/apps/giscus
 * 4. On https://giscus.app pick the repo and category; copy the repo id and
 *    category id it shows into the fields below.
 *
 * Empty repo string = the notes card shows setup instructions instead.
 */
export const NOTES_CONFIG = {
  repo: "",
  repoId: "",
  category: "",
  categoryId: "",
};
