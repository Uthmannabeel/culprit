import type { App } from "@slack/bolt";
import { isIssueRepoAllowed, type AppConfig } from "../config.js";
import { runTriage } from "../triage/brain.js";
import { createGithubIssue, type DraftIssue } from "../github/issues.js";
import { ACTION_CREATE_ISSUE, renderTriageBlocks } from "./blocks.js";
import { IncidentMemory } from "../memory/store.js";
import {
  ACTION_MARK_RESOLVED,
  VIEW_MARK_RESOLVED,
  buildResolveModal,
  buildResolvedIncident,
  parseResolveSubmission,
  type ResolveContext,
} from "./resolve.js";
import {
  appendResolution,
  buildIncidentCanvasMarkdown,
  buildResolutionCanvasMarkdown,
  createIncidentCanvas,
} from "./canvas.js";

/** Pull an explicit repo out of the message text, else fall back to default. */
function parseRepo(text: string, fallback?: string): string | undefined {
  const explicit = text.match(/\brepo:([^/\s]+\/[^/\s]+)\b/i);
  if (explicit) return explicit[1];
  const url = text.match(/github\.com\/([^/\s]+\/[^/\s]+)/i);
  if (url) return url[1];
  return fallback;
}

/** Strip leading bot mentions like "<@U123>" from the report text. */
function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

/** Parse a JSON interaction payload defensively — never throw on bad input. */
function safeJsonParse<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Log server-side detail; users get a generic message (no internal leakage). */
function logError(context: string, err: unknown): void {
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, err instanceof Error ? err.message : err);
}

/**
 * Register all Slack listeners on the Bolt app: the @mention / DM triggers that
 * run a triage, and the button action that files the drafted issue.
 */
export function registerHandlers(app: App, config: AppConfig): void {
  const handleReport = async (args: {
    text: string;
    channel: string;
    threadTs: string;
    userName?: string;
    client: App["client"];
  }) => {
    const { text, channel, threadTs, userName, client } = args;
    const report = stripMentions(text);
    if (!report) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Tell me what's broken and I'll investigate. Add `repo:owner/name` to target a specific repo.",
      });
      return;
    }

    const ack = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "🔍 Investigating — gathering evidence from GitHub…",
    });

    try {
      const repo = parseRepo(report, config.GITHUB_DEFAULT_REPO);
      const result = await runTriage(
        config,
        { report, repo, reportedBy: userName },
        async (note) => {
          if (ack.ts) await client.chat.update({ channel, ts: ack.ts, text: `🔍 ${note}…` });
        },
      );
      const canvas = config.CANVAS_ENABLED
        ? await createIncidentCanvas(client, {
            title: `Incident: ${result.summary}`.slice(0, 120),
            markdown: buildIncidentCanvasMarkdown(result, repo ?? "unknown", report, userName),
            channel,
          })
        : null;
      const blocks = renderTriageBlocks(
        result,
        repo ?? "unknown",
        report,
        canvas ? { id: canvas.canvasId, url: canvas.url } : undefined,
      );
      if (ack.ts) {
        await client.chat.update({ channel, ts: ack.ts, text: result.summary, blocks });
      } else {
        await client.chat.postMessage({ channel, thread_ts: threadTs, text: result.summary, blocks });
      }
    } catch (err) {
      logError("triage", err);
      const text = "⚠️ I couldn't complete triage on that one. Try again, or check the repo/token setup.";
      if (ack.ts) await client.chat.update({ channel, ts: ack.ts, text });
      else await client.chat.postMessage({ channel, thread_ts: threadTs, text });
    }
  };

  // Triggered by @mention in a channel.
  app.event("app_mention", async ({ event, client }) => {
    await handleReport({
      text: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      userName: event.user,
      client,
    });
  });

  // Triggered by a direct message to the agent.
  app.message(async ({ message, client }) => {
    // Only respond to plain user messages in a DM (channel_type "im").
    if (message.subtype || message.channel_type !== "im") return;
    const m = message as { text?: string; channel: string; ts: string; thread_ts?: string; user?: string };
    await handleReport({
      text: m.text ?? "",
      channel: m.channel,
      threadTs: m.thread_ts ?? m.ts,
      userName: m.user,
      client,
    });
  });

  // Button: file the drafted issue on GitHub.
  app.action(ACTION_CREATE_ISSUE, async ({ ack, body, client, action }) => {
    await ack();
    const channel = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    const payload = safeJsonParse<{ repo: string; issue: DraftIssue }>((action as { value?: string }).value);
    if (!payload?.repo || !payload.issue) return;

    // Confused-deputy guard: only file into repos the operator allowlisted, so a
    // reporter can't aim the bot's token at an arbitrary repository.
    if (!isIssueRepoAllowed(config, payload.repo)) {
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `⚠️ I'm not allowed to file issues in \`${payload.repo}\`. Add it to GITHUB_ALLOWED_REPOS to permit it.`,
        });
      }
      return;
    }

    try {
      const created = await createGithubIssue(config, payload.repo, payload.issue);
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `✅ Filed <${created.htmlUrl}|#${created.number}> in \`${payload.repo}\`.`,
        });
      }
    } catch (err) {
      logError("create-issue", err);
      if (channel) {
        await client.chat.postMessage({ channel, thread_ts: threadTs, text: "⚠️ I couldn't create the issue (check the token's repo/issues access)." });
      }
    }
  });

  // Button: open the "what fixed it?" modal so Culprit can learn from the outcome.
  app.action(ACTION_MARK_RESOLVED, async ({ ack, body, client, action }) => {
    await ack();
    const ctx = safeJsonParse<ResolveContext>((action as { value?: string }).value);
    if (!ctx) return;
    ctx.channel = (body as { channel?: { id: string } }).channel?.id ?? null;
    ctx.threadTs = (body as { message?: { ts: string } }).message?.ts ?? null;
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (triggerId) await client.views.open({ trigger_id: triggerId, view: buildResolveModal(ctx) });
  });

  // Modal submit: write the resolved incident into memory — the learning loop.
  app.view(VIEW_MARK_RESOLVED, async ({ ack, view, client }) => {
    await ack();
    const ctx = safeJsonParse<ResolveContext>(view.private_metadata);
    if (!ctx) return;
    const fields = parseResolveSubmission(view.state.values as never);
    const id = `inc-${ctx.threadTs ?? Date.now()}`;
    const record = buildResolvedIncident(ctx, fields, id, new Date().toISOString());

    try {
      const memory = new IncidentMemory(config);
      await memory.remember(record);
      if (ctx.canvasId) {
        await appendResolution(client, ctx.canvasId, buildResolutionCanvasMarkdown(record));
      }
      if (ctx.channel) {
        const fix = record.resolution ? `: _${record.resolution}_` : ".";
        await client.chat.postMessage({
          channel: ctx.channel,
          thread_ts: ctx.threadTs ?? undefined,
          text: `🧠 Logged to memory${fix}\nNext time something like *${ctx.symptom}* is reported, Culprit will recall this.`,
        });
      }
    } catch (err) {
      logError("resolve-remember", err);
      if (ctx.channel) {
        await client.chat.postMessage({ channel: ctx.channel, thread_ts: ctx.threadTs ?? undefined, text: "⚠️ I couldn't save that to memory just now." });
      }
    }
  });
}
