import type { App } from "@slack/bolt";
import { isAuthorizedUser, isIssueRepoAllowed, type AppConfig } from "../config.js";
import { runTriage } from "../triage/brain.js";
import { createGithubIssue, findSimilarIssue } from "../github/issues.js";
import { listOpenIssues } from "../github/evidence.js";
import { audit } from "../audit.js";
import { ACTION_CREATE_ISSUE, renderTriageBlocks } from "./blocks.js";
import {
  alreadyFiledUrl,
  decodeIssuePayload,
  decodeResolveContext,
  markDuplicateWarned,
  markFiled,
  wasDuplicateWarned,
} from "./draftStore.js";
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
import { buildHomeView } from "./home.js";
import {
  formatThreadContext,
  parseIdList,
  parseMemoryCommand,
  parseRepo,
  shouldAutoTriage,
  stripMentions,
  type MemoryCommand,
} from "./parse.js";
import { friendlyTriageError } from "../triage/progress.js";

type SlackClient = App["client"];

/**
 * One page covers virtually every incident thread. conversations.replies
 * returns oldest-first, so a too-small limit would fetch only the START of a
 * long thread and starve the formatter of the freshest (most useful) messages.
 */
const THREAD_REPLIES_FETCH_LIMIT = 100;
/** How many open issues to scan for the duplicate-issue warning. */
const DUP_CHECK_OPEN_ISSUES = 20;

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
  console.error(`[${context}]`, err instanceof Error ? err.message : err);
}

/**
 * Resolve a Slack user ID to a human-readable name (best-effort). Without this
 * the verdict card, canvas, and LLM prompt all show a raw "U0ABC…" id.
 */
async function displayName(client: SlackClient, userId: string | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  try {
    const res = await client.users.info({ user: userId });
    return res.user?.profile?.display_name || res.user?.real_name || userId;
  } catch {
    return userId;
  }
}

/**
 * Pull the prior thread discussion as triage context (best-effort). When
 * Culprit is mentioned mid-discussion, the thread above usually holds the best
 * clues (what was tried, error snippets, timings).
 */
async function fetchThreadContext(
  client: SlackClient,
  channel: string,
  threadTs: string,
  triggerTs: string,
): Promise<string | undefined> {
  try {
    const replies = await client.conversations.replies({ channel, ts: threadTs, limit: THREAD_REPLIES_FETCH_LIMIT });
    const context = formatThreadContext(
      (replies.messages ?? []) as Array<{ text?: string; ts?: string }>,
      triggerTs,
    );
    return context || undefined;
  } catch (err) {
    logError("thread-context", err);
    return undefined;
  }
}

/** Handle "@Culprit memory" / "@Culprit forget <id>" instead of a triage. */
async function handleMemoryCommand(args: {
  config: AppConfig;
  memory: IncidentMemory;
  command: MemoryCommand;
  channel: string;
  threadTs: string;
  userId: string | undefined;
  client: SlackClient;
}): Promise<void> {
  const { config, memory, command, channel, threadTs, userId, client } = args;
  if (command.type === "stats") {
    const s = await memory.stats();
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Memory: ${s.incidents} incident${s.incidents === 1 ? "" : "s"} remembered, ${s.resolved} with a logged resolution (hypothesis correct: ${s.hypothesisCorrect}, partially: ${s.hypothesisPartial}, incorrect: ${s.hypothesisIncorrect}). Remove an entry with \`forget <id>\`.`,
    });
    return;
  }

  // Deleting institutional memory is privileged — any member being able to
  // wipe it is how a shared workspace loses its compounding asset.
  if (!isAuthorizedUser(config, userId)) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "⚠️ Only authorized users can remove memories (see AUTHORIZED_USERS in the config).",
    });
    return;
  }

  const removed = await memory.forget(command.id);
  if (removed) await audit(config, "memory_forgotten", { id: command.id, actor: userId ?? null });
  // Attribute the deletion publicly — memory moderation should leave a trace.
  const actor = userId ? ` (removed by <@${userId}>)` : "";
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: removed
      ? `Removed \`${command.id}\` from memory — it will no longer be recalled${actor}.`
      : `No memory entry with id \`${command.id}\`. Send \`memory\` to see what's stored.`,
  });
}

/** Run one triage and render the verdict (or a friendly error) into the thread. */
async function runTriageAndRender(args: {
  config: AppConfig;
  report: string;
  repo: string;
  channel: string;
  threadTs: string;
  messageTs: string | undefined;
  inExistingThread: boolean | undefined;
  userId: string | undefined;
  client: SlackClient;
}): Promise<void> {
  const { config, report, repo, channel, threadTs, messageTs, inExistingThread, userId, client } = args;
  let ackTs: string | undefined;
  try {
    const ack = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Investigating \`${repo}\` — checking past incidents and recent changes…`,
    });
    ackTs = ack.ts;

    // Reporter name and thread context are independent Slack reads.
    const [reporter, threadContext] = await Promise.all([
      displayName(client, userId),
      inExistingThread ? fetchThreadContext(client, channel, threadTs, messageTs ?? "") : Promise.resolve(undefined),
    ]);

    const result = await runTriage(config, { report, repo, reportedBy: reporter, threadContext }, async (note) => {
      if (ackTs) await client.chat.update({ channel, ts: ackTs, text: `${note}…` });
    });
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
    if (ackTs) {
      await client.chat.update({ channel, ts: ackTs, text: result.summary, blocks });
    } else {
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: result.summary, blocks });
    }
  } catch (err) {
    logError("triage", err);
    const text = `⚠️ ${friendlyTriageError(err)}`;
    try {
      if (ackTs) await client.chat.update({ channel, ts: ackTs, text });
      else await client.chat.postMessage({ channel, thread_ts: threadTs, text });
    } catch (postErr) {
      // Even the error post can fail (archived channel) — never let it escape,
      // the caller's finally must still release the concurrency slot.
      logError("triage-error-post", postErr);
    }
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
  // Workspace-wide cap so a burst of mentions can't exhaust LLM quota.
  let activeTriages = 0;
  // Create-issue clicks currently being filed — closes the double-click window
  // between the "already filed?" check and the GitHub API returning.
  const filingNow = new Set<string>();
  const alertChannels = parseIdList(config.ALERT_CHANNELS);
  const alertBotIds = parseIdList(config.ALERT_BOT_IDS);
  // One shared memory instance — App Home opens and resolve submits shouldn't
  // each re-read the store from disk.
  const memory = new IncidentMemory(config);

  const handleReport = async (args: {
    text: string;
    channel: string;
    threadTs: string;
    /** The triggering message's own ts (excluded from thread context). */
    messageTs?: string;
    /** Set when the report was posted inside an existing thread. */
    inExistingThread?: boolean;
    userId?: string;
    client: SlackClient;
  }) => {
    const { text, channel, threadTs, messageTs, inExistingThread, userId, client } = args;
    const report = stripMentions(text);
    if (!report) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Tell me what's broken and I'll investigate. Add `repo:owner/name` to target a specific repo.",
      });
      return;
    }

    // Memory-management commands: "@Culprit memory" / "@Culprit forget <id>".
    const command = parseMemoryCommand(report);
    if (command) {
      await handleMemoryCommand({ config, memory, command, channel, threadTs, userId, client });
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
    if (activeTriages >= config.MAX_CONCURRENT_TRIAGES) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `I'm at capacity (${config.MAX_CONCURRENT_TRIAGES} investigations running). Try again in a minute.`,
      });
      return;
    }

    // EVERYTHING between acquiring the slot and the finally must be inside the
    // try — if even the ack post throws, a leaked slot would answer "already
    // investigating" forever and eventually wedge the whole bot at capacity.
    inFlight.add(flightKey);
    activeTriages++;
    try {
      await runTriageAndRender({ config, report, repo, channel, threadTs, messageTs, inExistingThread, userId, client });
    } finally {
      inFlight.delete(flightKey);
      activeTriages--;
    }
  };

  // Triggered by @mention in a channel.
  app.event("app_mention", async ({ event, client }) => {
    await handleReport({
      text: event.text ?? "",
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      messageTs: event.ts,
      inExistingThread: Boolean(event.thread_ts),
      userId: event.user,
      client,
    });
  });

  // App Home: usage guide + Culprit's earned track record from logged outcomes.
  app.event("app_home_opened", async ({ event, client }) => {
    if ((event as { tab?: string }).tab !== "home") return;
    try {
      const stats = await memory.stats();
      await client.views.publish({ user_id: event.user, view: buildHomeView(stats) });
    } catch (err) {
      logError("app-home", err);
    }
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

  // Triggered by a direct message — or by an alert landing in a watched channel.
  app.message(async ({ message, client, context }) => {
    const m = message as {
      text?: string;
      channel: string;
      channel_type?: string;
      ts: string;
      thread_ts?: string;
      user?: string;
      bot_id?: string;
      subtype?: string;
    };

    // Plain user messages in a DM (channel_type "im").
    if (!m.subtype && m.channel_type === "im") {
      await handleReport({
        text: m.text ?? "",
        channel: m.channel,
        threadTs: m.thread_ts ?? m.ts,
        messageTs: m.ts,
        inExistingThread: Boolean(m.thread_ts),
        userId: m.user,
        client,
      });
      return;
    }

    // Alert channels: a top-level message (e.g. a Sentry/PagerDuty webhook post)
    // is auto-triaged — no @mention needed. Culprit meets alerts where they land.
    if (shouldAutoTriage(m, alertChannels, context.botId, alertBotIds)) {
      await handleReport({
        text: m.text ?? "",
        channel: m.channel,
        threadTs: m.ts, // reply in the alert's own thread
        userId: m.user,
        client,
      });
    }
  });

  // Button: file the drafted issue on GitHub.
  app.action(ACTION_CREATE_ISSUE, async ({ ack, body, client, action }) => {
    await ack();
    const channel = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    const rawValue = (action as { value?: string }).value;
    const actorId = (body as { user?: { id?: string } }).user?.id;

    // Writing to GitHub under the bot's token is privileged.
    if (!isAuthorizedUser(config, actorId)) {
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "⚠️ Only authorized users can file issues (see AUTHORIZED_USERS in the config).",
        });
      }
      return;
    }

    // Close the double-click race: the "already filed?" check below is only
    // half the guard — two clicks inside the GitHub API's latency window would
    // BOTH pass it. The synchronous in-flight set catches the second one.
    if (rawValue) {
      if (filingNow.has(rawValue)) return;
      filingNow.add(rawValue);
    }
    try {
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

      // Duplicate guard: if an open issue already rhymes with this draft, warn
      // once (with the link) instead of filing; a second click files anyway.
      if (!wasDuplicateWarned(rawValue)) {
        const open = await listOpenIssues(config, payload.repo, DUP_CHECK_OPEN_ISSUES).catch(() => []);
        const similar = findSimilarIssue(open, payload.issue.title);
        if (similar) {
          markDuplicateWarned(rawValue);
          if (channel) {
            await client.chat.postMessage({
              channel,
              thread_ts: threadTs,
              text: `This may already be tracked: <${similar.url}|#${similar.number} ${similar.title.slice(0, 80)}>. Click *Create GitHub issue* again to file anyway.`,
            });
          }
          return;
        }
      }

      try {
        const created = await createGithubIssue(config, payload.repo, payload.issue);
        markFiled(rawValue, created.htmlUrl);
        await audit(config, "issue_filed", { repo: payload.repo, issue: created.number, url: created.htmlUrl, actor: actorId ?? null });
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
    } finally {
      if (rawValue) filingNow.delete(rawValue);
    }
  });

  // Button: open the "what fixed it?" modal so Culprit can learn from the outcome.
  app.action(ACTION_MARK_RESOLVED, async ({ ack, body, client, action }) => {
    await ack();
    const channel = (body as { channel?: { id: string } }).channel?.id;
    const threadTs = (body as { message?: { ts: string } }).message?.ts;
    const actorId = (body as { user?: { id?: string } }).user?.id;

    // Logged resolutions are written into recalled memory — privileged.
    if (!isAuthorizedUser(config, actorId)) {
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "⚠️ Only authorized users can log resolutions (see AUTHORIZED_USERS in the config).",
        });
      }
      return;
    }

    const ctx = decodeResolveContext((action as { value?: string }).value);
    if (!ctx) {
      // A spilled (oversized) context dies with a restart, same as issue drafts.
      if (channel) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "⚠️ That card has expired (I was restarted since posting it). Re-run the triage to log the resolution.",
        });
      }
      return;
    }
    ctx.channel = channel ?? null;
    ctx.threadTs = threadTs ?? null;
    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (triggerId) await client.views.open({ trigger_id: triggerId, view: buildResolveModal(ctx) });
  });

  // Modal submit: write the resolved incident into memory — the learning loop.
  app.view(VIEW_MARK_RESOLVED, async ({ ack, view, client }) => {
    await ack();
    const ctx = safeJsonParse<ResolveContext>(view.private_metadata);
    if (!ctx) return;
    const fields = parseResolveSubmission(view.state.values as Parameters<typeof parseResolveSubmission>[0]);
    const id = `inc-${ctx.threadTs ?? Date.now()}`;
    const record = buildResolvedIncident(ctx, fields, id, new Date().toISOString());

    try {
      await memory.remember(record);
      await audit(config, "resolution_logged", {
        id: record.id,
        repo: ctx.repo,
        resolvedBy: record.resolvedBy,
        hypothesisWasCorrect: record.hypothesisWasCorrect,
      });
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
