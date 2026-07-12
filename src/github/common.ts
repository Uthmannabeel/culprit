import type { AppConfig } from "../config.js";

/**
 * Shared GitHub REST plumbing — one copy of the headers and repo parsing so
 * the evidence readers, the issue writer, and the import script can't drift.
 */

export function ghHeaders(config: AppConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${config.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "culprit-triage",
    ...extra,
  };
}

/** GitHub owner/repo segments are a narrow charset — anything else would inject into the URL path. */
const REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Split and validate an owner/repo string, URL-encoding each segment. Repo
 * names reach this from user messages and env config; a value like
 * `foo?per_page=1/bar` must not smuggle query params into the API path.
 */
export function splitRepo(repo: string): [string, string] {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0 || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(name)) {
    throw new Error(`Invalid repo "${repo}" — expected owner/repo`);
  }
  return [encodeURIComponent(owner), encodeURIComponent(name)];
}
