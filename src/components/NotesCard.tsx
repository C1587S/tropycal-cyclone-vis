import { useEffect, useRef } from "react";
import { NOTES_CONFIG } from "../notes-config";
import { dark } from "../lib/palette";

/** Persistent, editable notes on a storm, stored as a GitHub Discussion
 * thread via giscus. The thread is keyed on project + storm id so the same
 * notes appear for the storm in every run. Writing requires a GitHub login;
 * reading does not. */
export function NotesCard({ term }: { term: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!NOTES_CONFIG.repo || !ref.current) return;
    const el = ref.current;
    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    const attrs: Record<string, string> = {
      "data-repo": NOTES_CONFIG.repo,
      "data-repo-id": NOTES_CONFIG.repoId,
      "data-category": NOTES_CONFIG.category,
      "data-category-id": NOTES_CONFIG.categoryId,
      "data-mapping": "specific",
      "data-term": term,
      "data-strict": "0",
      "data-reactions-enabled": "1",
      "data-emit-metadata": "0",
      "data-input-position": "top",
      "data-theme": dark() ? "dark" : "light",
      "data-lang": "en",
      "data-loading": "lazy",
    };
    for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [term]);

  if (!NOTES_CONFIG.repo) {
    return (
      <p className="notice">
        Notes are not configured yet. Set up the public notes repo and fill in src/notes-config.ts
        (instructions are in that file), then redeploy.
      </p>
    );
  }
  return <div ref={ref} />;
}
