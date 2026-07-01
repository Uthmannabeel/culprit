import { loadConfig, type AppConfig } from "../config.js";
import { IncidentMemory } from "../memory/store.js";
import type { IncidentRecord } from "../memory/types.js";

/**
 * Bootstrap Culprit's memory from history that already exists: the repo's
 * CLOSED issues become recallable incidents (symptom = title + first line of
 * body, link = the issue). This softens the cold-start problem — Culprit can
 * say "this was reported before, see #42" on day one. Imported records carry
 * no resolution until someone logs one, and are never presented as more than
 * a prior report.
 *
 * Run: npm run import:issues            (uses GITHUB_DEFAULT_REPO)
 *      npm run import:issues -- o/repo  (explicit repo)
 */
async function fetchClosedIssues(config: AppConfig, repo: string): Promise<
  Array<{ number: number; title: string; body?: string | null; html_url: string; closed_at?: string | null; pull_request?: unknown }>
> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=closed&per_page=50`, {
    headers: {
      Authorization: `Bearer ${config.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "culprit-triage",
    },
  });
  if (!res.ok) throw new Error(`GitHub issues fetch failed (${res.status})`);
  return (await res.json()) as Array<{
    number: number; title: string; body?: string | null; html_url: string; closed_at?: string | null; pull_request?: unknown;
  }>;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const repo = process.argv[2] ?? config.GITHUB_DEFAULT_REPO;
  if (!repo) throw new Error("Pass owner/repo or set GITHUB_DEFAULT_REPO.");

  const issues = (await fetchClosedIssues(config, repo)).filter((i) => !i.pull_request);
  console.log(`Found ${issues.length} closed issue(s) in ${repo}.`);

  const memory = new IncidentMemory(config);
  await memory.load();
  let imported = 0;
  for (const issue of issues) {
    const firstLine = (issue.body ?? "").split("\n")[0]?.trim() ?? "";
    const record: IncidentRecord = {
      id: `gh-${repo}-issue-${issue.number}`,
      symptom: [issue.title, firstLine].filter(Boolean).join(" — ").slice(0, 400),
      rootCause: "",
      resolution: "", // unknown until someone logs it — never invent a fix
      resolvedBy: null,
      links: [issue.html_url],
      repo,
      createdAt: issue.closed_at ?? "",
      hypothesisWasCorrect: null,
      embedding: null,
    };
    await memory.remember(record);
    imported++;
    console.log(`  + #${issue.number} ${issue.title}`);
  }
  console.log(imported === 0 ? "Nothing to import." : `Imported ${imported} incident(s) into ${config.INCIDENTS_DB_PATH}.`);
}

main().catch((err) => {
  console.error("Import failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
