import type { View } from "@slack/types";
import type { IncidentRecord } from "../memory/types.js";

/** Action + view IDs for the resolve-and-remember flow. */
export const ACTION_MARK_RESOLVED = "triage_mark_resolved";
export const VIEW_MARK_RESOLVED = "triage_resolve_submit";

/**
 * The incident context carried from the verdict card, through the modal, to the
 * point we write it into memory. Kept small so it fits a button value /
 * private_metadata (both have length limits).
 */
export interface ResolveContext {
  symptom: string;
  hypothesis: string;
  repo: string | null;
  suspectedOwner: string | null;
  link: string | null;
  channel: string | null;
  threadTs: string | null;
  /** The incident canvas to append the resolution to, if one was created. */
  canvasId: string | null;
}

/** The fields a responder fills in when they close out an incident. */
export interface ResolveFields {
  resolution: string;
  hypothesisWasCorrect: boolean | null;
  resolvedBy: string | null;
}

/** yes/partly/no → a tri-state learning signal. */
function toCorrectness(value: string | undefined): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null; // "partly" or missing
}

/**
 * Build the resolve modal. The incident context rides along in
 * private_metadata so the submit handler can reconstruct the record.
 */
export function buildResolveModal(ctx: ResolveContext): View {
  return {
    type: "modal",
    callback_id: VIEW_MARK_RESOLVED,
    private_metadata: JSON.stringify(ctx),
    title: { type: "plain_text", text: "Resolve incident" },
    submit: { type: "plain_text", text: "Remember it" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Teach Culprit what closed this out so it recognises it next time.\n\n_Symptom:_ ${ctx.symptom}` },
      },
      {
        type: "input",
        block_id: "fix",
        label: { type: "plain_text", text: "What actually fixed it?" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          placeholder: { type: "plain_text", text: "e.g. Re-added PAYMENTS_API_KEY to the prod config" },
        },
      },
      {
        type: "input",
        block_id: "hyp",
        label: { type: "plain_text", text: "Was Culprit's hypothesis correct?" },
        element: {
          type: "radio_buttons",
          action_id: "value",
          options: [
            { text: { type: "plain_text", text: "Yes — that was it" }, value: "yes" },
            { text: { type: "plain_text", text: "Partly" }, value: "partly" },
            { text: { type: "plain_text", text: "No — it was something else" }, value: "no" },
          ],
        },
      },
      {
        type: "input",
        block_id: "who",
        optional: true,
        label: { type: "plain_text", text: "Who resolved it? (handle)" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          placeholder: { type: "plain_text", text: "e.g. dana" },
        },
      },
    ],
  };
}

/** Pull the responder's answers out of a view_submission payload. */
export function parseResolveSubmission(
  values: Record<string, Record<string, { value?: string | null; selected_option?: { value?: string } | null }>>,
): ResolveFields {
  // Cap lengths — this text is embedded, stored, recalled, and re-shown, so it
  // shouldn't be able to carry an oversized/poisoned payload into memory.
  const resolution = (values.fix?.value?.value?.trim() ?? "").slice(0, 1000);
  const correctness = values.hyp?.value?.selected_option?.value;
  const who = (values.who?.value?.value?.trim() ?? "").slice(0, 80);
  return {
    resolution,
    hypothesisWasCorrect: toCorrectness(correctness),
    resolvedBy: who.length > 0 ? who : null,
  };
}

/**
 * Turn the carried context + the responder's answers into a memory record.
 * Pure and deterministic (timestamp + id passed in) so it can be unit-tested.
 */
export function buildResolvedIncident(
  ctx: ResolveContext,
  fields: ResolveFields,
  id: string,
  createdAt: string,
): IncidentRecord {
  return {
    id,
    symptom: ctx.symptom,
    rootCause: ctx.hypothesis,
    resolution: fields.resolution,
    resolvedBy: fields.resolvedBy ?? ctx.suspectedOwner,
    links: ctx.link ? [ctx.link] : [],
    repo: ctx.repo,
    createdAt,
    hypothesisWasCorrect: fields.hypothesisWasCorrect,
    embedding: null,
  };
}
