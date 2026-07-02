import type { AppConfig } from "../config.js";
import { lexicalSimilarity } from "../memory/similarity.js";

export interface DraftIssue {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Find an open issue that likely already tracks the same problem, so the
 * Create-issue button can warn before filing a duplicate. Title-overlap based;
 * intentionally conservative (warn only on a clear rhyme).
 */
export function findSimilarIssue<T extends { title: string }>(issues: T[], draftTitle: string): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const issue of issues) {
    const score = lexicalSimilarity(issue.title, draftTitle);
    if (score > bestScore) {
      best = issue;
      bestScore = score;
    }
  }
  return bestScore >= 0.35 ? best : null;
}

export interface CreatedIssue {
  number: number;
  htmlUrl: string;
}

/**
 * File a GitHub issue via the REST API. We use REST (not MCP) for the
 * write-path so issue creation is deterministic and independent of MCP tool
 * naming — the agentic loop only ever READS over MCP.
 */
export async function createGithubIssue(
  config: AppConfig,
  repo: string,
  draft: DraftIssue,
): Promise<CreatedIssue> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo "${repo}" — expected owner/repo`);

  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub issue creation failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { number: number; html_url: string };
  return { number: json.number, htmlUrl: json.html_url };
}
