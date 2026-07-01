import { loadConfig } from "../config.js";
import {
  listRecentCommits,
  listRecentPullRequests,
  listOpenIssues,
  listRecentDeployments,
  listRecentWorkflowRuns,
  searchCode,
} from "../github/evidence.js";

/**
 * Exercises every read-only evidence signal against the configured repo so we
 * can confirm — before a live demo — that the GitHub token actually has the
 * permissions each signal needs (Contents, Pull requests, Issues, code search).
 *
 * Run: npm run verify:evidence
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const repo = config.GITHUB_DEFAULT_REPO;
  if (!repo) throw new Error("Set GITHUB_DEFAULT_REPO in .env to verify against a repo.");
  console.log(`Verifying multi-signal evidence against ${repo}\n`);

  const checks: Array<{ label: string; run: () => Promise<unknown> }> = [
    { label: "commits   (Contents:read)", run: () => listRecentCommits(config, repo, 3) },
    { label: "pull reqs (Pull requests:read)", run: () => listRecentPullRequests(config, repo, "closed", 3) },
    { label: "issues    (Issues:read)", run: () => listOpenIssues(config, repo, 3) },
    { label: "deploys   (Deployments:read)", run: () => listRecentDeployments(config, repo, 3) },
    { label: "CI runs   (Actions:read)", run: () => listRecentWorkflowRuns(config, repo, 3) },
    { label: "code      (search + filename fallback)", run: () => searchCode(config, repo, "checkout") },
  ];

  let failures = 0;
  for (const c of checks) {
    try {
      const result = await c.run();
      const count = Array.isArray(result) ? result.length : 0;
      console.log(`✅ ${c.label} — ${count} result(s)`);
      console.log(`   ${JSON.stringify(result).slice(0, 300)}\n`);
    } catch (err) {
      failures++;
      console.log(`❌ ${c.label} — ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  console.log(failures === 0 ? "All signals OK." : `${failures} signal(s) failed — check token scopes above.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Verify failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
