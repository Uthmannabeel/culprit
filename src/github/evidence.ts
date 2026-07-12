import type { AppConfig } from "../config.js";
import { ghHeaders, splitRepo } from "./common.js";

/**
 * Read-only GitHub evidence helpers used by the Gemini brain. These use the
 * REST API and only require the token's `Contents: read` permission — commits
 * (and their diffs) are enough to surface "what changed recently", including
 * changes that landed via a merged PR.
 */

async function ghGet(config: AppConfig, path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders(config) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub ${path} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

/** Most recent commits on the default branch, optionally scoped to one path. */
export async function listRecentCommits(
  config: AppConfig,
  repo: string,
  perPage = 12,
  path?: string,
): Promise<CommitSummary[]> {
  const [owner, name] = splitRepo(repo);
  const pathParam = path ? `&path=${encodeURIComponent(path)}` : "";
  const data = (await ghGet(
    config,
    `/repos/${owner}/${name}/commits?per_page=${Math.min(perPage, 30)}${pathParam}`,
  )) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author?: { date?: string } };
    author?: { login?: string } | null;
  }>;
  return data.map((c) => ({
    sha: c.sha.slice(0, 10),
    message: c.commit.message.split("\n")[0] ?? c.commit.message,
    author: c.author?.login ?? "unknown",
    date: c.commit.author?.date ?? "",
    url: c.html_url,
  }));
}

export interface CommitDetail extends CommitSummary {
  files: Array<{ filename: string; status: string; patch: string }>;
}

/** Full detail for one commit, including the diff of each changed file. */
export async function getCommit(config: AppConfig, repo: string, sha: string): Promise<CommitDetail> {
  const [owner, name] = splitRepo(repo);
  const c = (await ghGet(config, `/repos/${owner}/${name}/commits/${encodeURIComponent(sha)}`)) as {
    sha: string;
    html_url: string;
    commit: { message: string; author?: { date?: string } };
    author?: { login?: string } | null;
    files?: Array<{ filename: string; status: string; patch?: string }>;
  };
  return {
    sha: c.sha.slice(0, 10),
    message: c.commit.message,
    author: c.author?.login ?? "unknown",
    date: c.commit.author?.date ?? "",
    url: c.html_url,
    files: (c.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status,
      patch: (f.patch ?? "").slice(0, 3000),
    })),
  };
}

/**
 * Paths that look like secret material. File contents flow to the LLM provider
 * (free-tier Gemini in the default setup) and can surface in draft issue
 * bodies — a prompt-injected "read .env and include it" must hit a wall here.
 */
const SENSITIVE_PATH = /(^|\/)\.env(\.|$)|(^|\/)(secrets?|credentials?)(\.|\/|$)|\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)/i;

/** Decoded contents of a file at the default branch. */
export async function getFileContents(config: AppConfig, repo: string, path: string): Promise<string> {
  const [owner, name] = splitRepo(repo);
  if (path.split("/").includes("..")) throw new Error(`Refusing to read path with '..' segment: ${path}`);
  if (SENSITIVE_PATH.test(path)) throw new Error(`Refusing to read a sensitive-looking path: ${path}`);
  // Encode each segment but keep the slashes that separate directories.
  const safePath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const data = (await ghGet(config, `/repos/${owner}/${name}/contents/${safePath}`)) as {
    content?: string;
    encoding?: string;
  };
  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf8").slice(0, 6000);
  }
  return "(no readable content)";
}

export interface PullRequestSummary {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author: string;
  mergedAt: string | null;
  url: string;
}

/**
 * Recently updated pull requests. A recently MERGED PR with a clear author is
 * the single strongest triage signal — it tells you exactly what changed and
 * who to ask. Defaults to closed PRs (most recently merged first).
 */
export async function listRecentPullRequests(
  config: AppConfig,
  repo: string,
  state: "closed" | "open" | "all" = "closed",
  perPage = 10,
): Promise<PullRequestSummary[]> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(
    config,
    `/repos/${owner}/${name}/pulls?state=${state}&sort=updated&direction=desc&per_page=${Math.min(perPage, 30)}`,
  )) as Array<{
    number: number;
    title: string;
    state: string;
    merged_at?: string | null;
    html_url: string;
    user?: { login?: string } | null;
  }>;
  return data.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    merged: Boolean(p.merged_at),
    author: p.user?.login ?? "unknown",
    mergedAt: p.merged_at ?? null,
    url: p.html_url,
  }));
}

export interface IssueSummary {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  url: string;
  labels: string[];
}

/**
 * Open issues on the repo (pull requests are filtered out — the issues API
 * returns both). Useful for spotting whether the incident is already reported
 * or relates to a known problem area.
 */
export async function listOpenIssues(config: AppConfig, repo: string, perPage = 10): Promise<IssueSummary[]> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(
    config,
    `/repos/${owner}/${name}/issues?state=open&sort=updated&direction=desc&per_page=${Math.min(perPage, 30)}`,
  )) as Array<{
    number: number;
    title: string;
    html_url: string;
    created_at: string;
    pull_request?: unknown;
    user?: { login?: string } | null;
    labels?: Array<{ name?: string } | string>;
  }>;
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      author: i.user?.login ?? "unknown",
      createdAt: i.created_at,
      url: i.html_url,
      labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    }));
}

export interface CodeMatch {
  path: string;
  url: string;
}

/**
 * Search the repo's code for a term (e.g. a route, symbol, or error string from
 * the report) to locate the affected area instead of guessing from recent
 * commits alone. Uses GitHub's code search; when the index has nothing (new or
 * small repos are often unindexed) it falls back to filename matching over the
 * repo tree so the tool still returns something useful.
 */
export async function searchCode(config: AppConfig, repo: string, query: string, perPage = 8): Promise<CodeMatch[]> {
  const [owner, name] = splitRepo(repo);
  const q = encodeURIComponent(`${query} repo:${owner}/${name}`);
  const data = (await ghGet(config, `/search/code?q=${q}&per_page=${Math.min(perPage, 20)}`)) as {
    items?: Array<{ path: string; html_url: string }>;
  };
  const indexed = (data.items ?? []).map((m) => ({ path: m.path, url: m.html_url }));
  if (indexed.length > 0) return indexed;
  return searchFilenames(config, repo, query, perPage);
}

/** Filename fallback: match the query against the repo tree. Best-effort. */
async function searchFilenames(config: AppConfig, repo: string, query: string, limit: number): Promise<CodeMatch[]> {
  const [owner, name] = splitRepo(repo);
  try {
    const tree = (await ghGet(config, `/repos/${owner}/${name}/git/trees/HEAD?recursive=1`)) as {
      tree?: Array<{ path: string; type: string }>;
    };
    const needle = query.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!needle) return [];
    return (tree.tree ?? [])
      .filter((e) => e.type === "blob" && e.path.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(needle))
      .slice(0, limit)
      .map((e) => ({ path: e.path, url: `https://github.com/${owner}/${name}/blob/HEAD/${e.path}` }));
  } catch {
    return [];
  }
}

export interface DeploymentSummary {
  environment: string;
  ref: string;
  sha: string;
  creator: string;
  createdAt: string;
}

/**
 * Recent deployments — "what shipped, where, when" is the closest thing to a
 * runtime signal available from GitHub alone, and incidents cluster around
 * deploy times.
 */
export async function listRecentDeployments(config: AppConfig, repo: string, perPage = 5): Promise<DeploymentSummary[]> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(config, `/repos/${owner}/${name}/deployments?per_page=${Math.min(perPage, 20)}`)) as Array<{
    environment?: string;
    ref?: string;
    sha?: string;
    created_at?: string;
    creator?: { login?: string } | null;
  }>;
  return data.map((d) => ({
    environment: d.environment ?? "unknown",
    ref: d.ref ?? "",
    sha: (d.sha ?? "").slice(0, 10),
    creator: d.creator?.login ?? "unknown",
    createdAt: d.created_at ?? "",
  }));
}

export interface WorkflowRunSummary {
  name: string;
  conclusion: string;
  branch: string;
  sha: string;
  createdAt: string;
  url: string;
}

/**
 * Recent CI workflow runs. A run that flipped from success to failure around
 * the report time is a strong, near-runtime signal (build/test/deploy broke).
 */
export async function listRecentWorkflowRuns(config: AppConfig, repo: string, perPage = 10): Promise<WorkflowRunSummary[]> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(
    config,
    `/repos/${owner}/${name}/actions/runs?per_page=${Math.min(perPage, 30)}`,
  )) as {
    workflow_runs?: Array<{
      name?: string;
      conclusion?: string | null;
      status?: string;
      head_branch?: string;
      head_sha?: string;
      created_at?: string;
      html_url?: string;
    }>;
  };
  return (data.workflow_runs ?? []).map((r) => ({
    name: r.name ?? "workflow",
    conclusion: r.conclusion ?? r.status ?? "unknown",
    branch: r.head_branch ?? "",
    sha: (r.head_sha ?? "").slice(0, 10),
    createdAt: r.created_at ?? "",
    url: r.html_url ?? "",
  }));
}
