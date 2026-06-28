import type { AppConfig } from "../config.js";

/**
 * Read-only GitHub evidence helpers used by the Gemini brain. These use the
 * REST API and only require the token's `Contents: read` permission — commits
 * (and their diffs) are enough to surface "what changed recently", including
 * changes that landed via a merged PR.
 */

function ghHeaders(config: AppConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "culprit-triage",
  };
}

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo "${repo}" — expected owner/repo`);
  return [owner, name];
}

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

/** Most recent commits on the default branch. */
export async function listRecentCommits(config: AppConfig, repo: string, perPage = 12): Promise<CommitSummary[]> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(config, `/repos/${owner}/${name}/commits?per_page=${Math.min(perPage, 30)}`)) as Array<{
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
  const c = (await ghGet(config, `/repos/${owner}/${name}/commits/${sha}`)) as {
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

/** Decoded contents of a file at the default branch. */
export async function getFileContents(config: AppConfig, repo: string, path: string): Promise<string> {
  const [owner, name] = splitRepo(repo);
  const data = (await ghGet(config, `/repos/${owner}/${name}/contents/${path}`)) as {
    content?: string;
    encoding?: string;
  };
  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf8").slice(0, 6000);
  }
  return "(no readable content)";
}
