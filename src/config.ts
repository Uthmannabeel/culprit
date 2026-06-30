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

    // Which LLM drives the triage brain.
    LLM_PROVIDER: z.enum(["anthropic", "gemini"]).default("anthropic"),

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
    MEMORY_RECALL_K: z.coerce.number().int().positive().max(10).default(3),
    // Tuned for gemini-embedding-001, whose cosine floor for unrelated text is
    // ~0.55. 0.70 keeps recall precise — a wrong "we've seen this" is worse than
    // none. Lower it if you switch to a model with wider score separation.
    MEMORY_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.7),

    GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required to read repo context"),
    GITHUB_DEFAULT_REPO: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, "GITHUB_DEFAULT_REPO must look like owner/repo")
      .optional(),

    GITHUB_MCP_MODE: z.enum(["remote", "local"]).default("remote"),
    GITHUB_MCP_URL: z.string().url().default("https://api.githubcopilot.com/mcp/"),

    TRIAGE_MAX_STEPS: z.coerce.number().int().positive().max(20).default(6),
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
