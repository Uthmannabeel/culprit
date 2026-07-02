import "dotenv/config";
import { z } from "zod";

/**
 * Central, validated configuration. We fail fast at startup with a clear
 * message if a required secret is missing — never trust the environment to be
 * complete (see ECC security rules: validate required secrets at startup).
 */
const EnvSchema = z
  .object({
    SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required (xoxb-...)"),
    SLACK_APP_TOKEN: z.string().min(1, "SLACK_APP_TOKEN is required (xapp-...) for Socket Mode"),

    // Which LLM drives the triage brain. Defaults to the free-tier Gemini path,
    // which is the fully-wired, proven configuration (memory recall + evidence).
    LLM_PROVIDER: z.enum(["anthropic", "gemini"]).default("gemini"),

    // Anthropic (used when LLM_PROVIDER=anthropic) — gathers evidence over the GitHub MCP server.
    ANTHROPIC_API_KEY: z.string().optional(),
    TRIAGE_MODEL: z.string().default("claude-opus-4-8"),

    // Gemini (used when LLM_PROVIDER=gemini) — free tier; gathers evidence via the GitHub API.
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
    // Embedding model for incident memory recall (free tier).
    EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),

    // Incident memory — Culprit's institutional knowledge of past incidents.
    INCIDENTS_DB_PATH: z.string().default("data/incidents.json"),
    // Maintain a living Slack Canvas per incident (needs canvases:write scope).
    CANVAS_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    MEMORY_RECALL_K: z.coerce.number().int().positive().max(10).default(3),
    // Tuned for gemini-embedding-001, whose cosine floor for unrelated text is
    // ~0.55. 0.70 keeps embedding recall precise — a wrong "we've seen this" is
    // worse than none. Lower it if you switch to a model with wider separation.
    MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),
    // Separate, much lower floor for the lexical (Jaccard) fallback — its scores
    // for genuinely-related incidents sit far below the embedding floor, so
    // reusing MEMORY_MIN_SCORE here would silently disable offline recall.
    MEMORY_MIN_SCORE_LEXICAL: z.coerce.number().min(0).max(1).default(0.12),

    GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required to read repo context"),
    GITHUB_DEFAULT_REPO: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, "GITHUB_DEFAULT_REPO must look like owner/repo")
      .optional(),
    // Comma-separated extra owner/repo values Culprit may FILE ISSUES into, beyond
    // GITHUB_DEFAULT_REPO. Prevents a reporter from directing the bot's token at an
    // arbitrary repo. Empty + no default repo = unrestricted (single-user/dev only).
    GITHUB_ALLOWED_REPOS: z.string().optional(),

    // Additional MCP servers to use as evidence sources, e.g.
    // "sentry=https://mcp.sentry.dev/mcp, logs=https://logs.internal/mcp".
    // Per-source bearer auth via EVIDENCE_MCP_AUTH_<NAME> env vars.
    EVIDENCE_MCP_SERVERS: z.string().optional(),

    GITHUB_MCP_MODE: z.enum(["remote", "local"]).default("remote"),
    GITHUB_MCP_URL: z.string().url().default("https://api.githubcopilot.com/mcp/"),

    // Channels Culprit watches for alerts (comma-separated channel IDs). A
    // top-level message posted there — e.g. by a Sentry/PagerDuty webhook — is
    // auto-triaged without needing an @mention.
    ALERT_CHANNELS: z.string().optional(),

    // Cap on simultaneous triages across the workspace, so a burst of mentions
    // can't exhaust the LLM quota mid-incident.
    MAX_CONCURRENT_TRIAGES: z.coerce.number().int().positive().max(20).default(3),

    TRIAGE_MAX_STEPS: z.coerce.number().int().positive().max(20).default(8),

    // Append-only JSONL trail of write actions (issue filed / resolution logged / forget).
    AUDIT_LOG_PATH: z.string().default("data/audit.jsonl"),
    // Optional HTTP health endpoint (GET / -> JSON). Unset/empty = disabled.
    HEALTH_PORT: z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : v),
      z.coerce.number().int().positive().max(65535).optional(),
    ),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.LLM_PROVIDER === "anthropic" && !cfg.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ANTHROPIC_API_KEY"], message: "required when LLM_PROVIDER=anthropic" });
    }
    if (cfg.LLM_PROVIDER === "gemini" && !cfg.GEMINI_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["GEMINI_API_KEY"], message: "required when LLM_PROVIDER=gemini" });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

/**
 * Whether Culprit may file an issue into `repo`. Restricts the bot's write token
 * to GITHUB_DEFAULT_REPO + GITHUB_ALLOWED_REPOS so a reporter can't point it at
 * an arbitrary repository. If no allowlist is configured at all, permits it
 * (single-user/dev convenience — set a default repo in shared workspaces).
 */
export function isIssueRepoAllowed(config: AppConfig, repo: string): boolean {
  const allowed = new Set<string>();
  if (config.GITHUB_DEFAULT_REPO) allowed.add(config.GITHUB_DEFAULT_REPO.toLowerCase());
  for (const r of (config.GITHUB_ALLOWED_REPOS ?? "").split(",")) {
    const trimmed = r.trim().toLowerCase();
    if (trimmed) allowed.add(trimmed);
  }
  return allowed.size === 0 || allowed.has(repo.toLowerCase());
}

/** Parse and cache the environment. Throws a readable error if invalid. */
export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the values.`);
  }
  cached = parsed.data;
  return cached;
}
