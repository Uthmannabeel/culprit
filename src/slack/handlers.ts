import type { App } from "@slack/bolt";
import { isIssueRepoAllowed, type AppConfig } from "../config.js";
import { runTriage } from "../triage/brain.js";
import { createGithubIssue } from "../github/issues.js";
import { ACTION_CREATE_ISSUE, renderTriageBlocks } from "./blocks.js";
import { alreadyFiledUrl, decodeIssuePayload, markFiled } from "./draftStore.js";
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

import { parseRepo, stripMentions } from "./parse.js";

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
 * Resolve a Slack user ID to a human-readable name (best-effort). Without this
 * the verdict card, canvas, and LLM prompt all show a raw "U0ABC…" id.
 */
async function displayName(client: App["client"], userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const res = await client.users.info({ user: userId });
    return res.user?.profile?.display_name || res.user?.real_name || userId;
  } catch {
    return userId;
  }
}

/**
 * Register all Slack listeners on the Bolt app: the @mention / DM triggers that
 * run a triage, and the button action that files the drafted issue.
 */
export function registerHandlers(app: App, config: AppConfig): void {
  // One triage per thread at a time — a second mention while one is running
  // would silently kick off a duplicate investigation.
  const inFlight = new Set<string>();

  const handleReport = async (args: {
    text: string;
    channel: string;
    threadTs: string;
    userId?: string;
    client: App["client"];
  }) => {
    const { text, channel, threadTs, userId, client } = args;
    const report = stripMentions(text);
    if (!report) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Tell me what's broken and I'll investigate. Add `repo:owner/name` to target a specific repo.",
      });
      return;
    }

    const repo = parseRepo(report, config.GITHUB_DEFAULT_REPO);
    if (!repo) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "I need a repo to investigate. Add `repo:owner/name` to your message (or set GITHUB_DEFAULT_REPO).",
      });
      return;
    }

    const flightKey = `${channel}:${threadTs}`;
    if (inFlight.has(flightKey)) {
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: "Already investigating — updates will land in this thread." });
      return;
    }
    inFlight.add(flightKey);

    const ack = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Investigating \`${repo}\` — checking past incidents and recent changes…`,
    });

    try {
      const reporter = await displayName(client, userId);
      const result = await runTriage(
        config,
        { report, repo, reportedBy: reporter },
        async (note) => {
          if (ack.ts) await client.chat.update({ channel, ts: ack.ts, text: `${note}…` });
        },
      );
      const canvas = config.CANVAS_ENABLED
        ? await createIncidentCanvas(client, {
            title: `Incident: ${result.summary}`.slice(0, 120),
            markdown: buildIncidentCanvasMarkdown(result, repo, report, reporter),
            channel,
          })
        : null;
      const blocks = renderTriageBlocks(
        result,
        repo,
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
    } finally {
      inFlight.delete(flightKey);
    }
  };

  // Triggered by @mention in a channel.
  app.event("app_mention", async ({ event, client }) => {
    await handleReport({
      text: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      userId: event.user,
      client,
    });
  });

  // Greet users who open Culprit's assistant panel — the manifest subscribes to
  // this event; without a handler the panel just sits silent, which reads as broken.
  app.event("assistant_thread_started", async ({ event, client }) => {
    const thread = (event as { assistant_thread?: { channel_id?: string; thread_ts?: string } }).assistant_thread;
    if (!thread?.channel_id || !thread.thread_ts) return;
    await client.chat.postMessage({
      channel: thread.channel_id,
      thread_ts: thread.thread_ts,
      text: "Tell me what's broken — e.g. `checkout is throwing 500s repo:owner/name` — and I'll investigate: past incidents, recent changes, likely owner, and a draft issue.",
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
      userId: m.user,
      client,
    });
  });

  // Button: file the drafted issue on GitHub.
  app.action(ACTION_CREATE_ISSUE, async ({ ack, body, client, action }) => {
    await ack();
    const channel = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    const rawValue = (action as { value?: string }).value;

    // Idempotency: Slack can't disable a clicked button — a second click should
    // point at the existing issue, not file a duplicate.
    const existing = alreadyFiledUrl(rawValue);
    if (existing) {
      if (channel) {
        await client.chat.postMessage({ channel, thread_ts: threadTs, text: `Already filed — <${existing}|view the issue>.` });
      }
      return;
    }

    const payload = decodeIssuePayload(rawValue);
    if (!payload) {
      // Oversized drafts are held in-process; a restart between the verdict and
      // the click loses them. Tell the user how to recover instead of going silent.
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "⚠️ That draft has expired (I was restarted since posting it). Re-run the triage and click again.",
        });
      }
      return;
    }

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
      markFiled(rawValue, created.htmlUrl);
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `Issue <${created.htmlUrl}|#${created.number}> filed in \`${payload.repo}\`.`,
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
        const fix = record.resolution ? ` — "${record.resolution}"` : "";
        await client.chat.postMessage({
          channel: ctx.channel,
          thread_ts: ctx.threadTs ?? undefined,
          text: `Resolution logged${fix}. Culprit will recall this if a similar incident is reported.`,
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
