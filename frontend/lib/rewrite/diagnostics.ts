import type { Outcome } from "./quota";
import type { ErrorCode } from "./types";

// What one attempt leaves in the logs: the name of the model the route asked for (the default or
// ANTHROPIC_MODEL), durations, the state it ended in, why the model stopped, the token counts the API
// reported, and how many excerpts it used and edits it kept and dropped. Apart from that configured
// name, only numbers and closed lists of words go in, so a text, an excerpt, a raw answer or a key has
// no way into a log line.
export type AttemptReport = {
  model?: string;
  stopReason?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  // Session, quota and style search
  prepMs?: number;
  modelMs?: number;
  // From the start of the model call, on a stream
  firstEditMs?: number;
  references?: number;
  edits?: number;
  dropped?: number;
};

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// The API's own words; anything else is reported as other rather than copied
const STOP_REASONS = new Set([
  "end_turn",
  "max_tokens",
  "stop_sequence",
  "tool_use",
  "pause_turn",
  "refusal",
]);

const whole = (value: unknown) =>
  typeof value === "number" ? Math.round(value) : undefined;

// Reads what a model answer says about itself, whole or as far as it got
export function noteAnswer(
  report: AttemptReport,
  message?: { stop_reason?: string | null; usage?: Usage },
) {
  if (!message) return;
  report.stopReason = message.stop_reason;
  report.inputTokens = whole(message.usage?.input_tokens);
  // The output count comes with the stop reason, in the answer's last event. Before it the field is
  // only what the first event announced, so an answer cut short has no count to report.
  report.outputTokens = message.stop_reason
    ? whole(message.usage?.output_tokens)
    : undefined;
  report.cacheReadTokens = whole(message.usage?.cache_read_input_tokens);
  report.cacheWriteTokens = whole(message.usage?.cache_creation_input_tokens);
}

// One line per request that reached the quota, ending in `state`: how a started attempt ended,
// released when it was given back, or the code it was refused with
export function logAttempt(
  state: Outcome | ErrorCode | "released",
  report: AttemptReport = {},
) {
  const stop = report.stopReason;
  console.info(
    "Rewrite attempt",
    JSON.stringify({
      state,
      model: report.model,
      stop_reason: stop && (STOP_REASONS.has(stop) ? stop : "other"),
      input_tokens: whole(report.inputTokens),
      output_tokens: whole(report.outputTokens),
      cache_read_tokens: whole(report.cacheReadTokens),
      cache_write_tokens: whole(report.cacheWriteTokens),
      prep_ms: whole(report.prepMs),
      model_ms: whole(report.modelMs),
      first_edit_ms: whole(report.firstEditMs),
      references: whole(report.references),
      edits: whole(report.edits),
      dropped: whole(report.dropped),
    }),
  );
}
