import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Reference } from "@/lib/style/retrieve";
import { noteAnswer, type AttemptReport } from "./diagnostics";
import { EditStreamParser } from "./edit-stream";
import { buildUserMessage, SYSTEM_PROMPT, type MessageOptions } from "./prompt";
import { ClaudeOutputSchema, type RawEdit } from "./schema";
import type { ErrorCode } from "./types";

// Cheap and fast enough for editing; override with ANTHROPIC_MODEL
const DEFAULT_MODEL = "claude-sonnet-5-5";

// Thinking tokens count against this limit too
const MAX_TOKENS = 8000;

// How long a request may spend up to the end of the model call, out of the route's 60 s limit:
// the rest is there to save the result and close the ticket.
const CALL_MS = 50_000;

// `elapsedMs` is what the request has already used
const deadlineAfter = (elapsedMs: number) =>
  AbortSignal.timeout(Math.max(Math.round(CALL_MS - elapsedMs), 0));

// The SDK's `timeout` stops at the response headers, so it cannot end a stream that stalls or
// runs long: `deadline` covers the whole call. No retries: a retry could not finish in time, and
// each retry would be another paid call. A failed attempt stays counted in the quota.
const callOptions = (deadline: AbortSignal, signal?: AbortSignal) => ({
  timeout: CALL_MS,
  maxRetries: 0,
  signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
});

export class RewriteError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

let cached: Anthropic | undefined;

// Created lazily so a missing key fails at request time, not at build time. The SDK's own logger
// stays off: it prints the raw chunk of a corrupt event, which can quote the user's text.
function getClient(): Anthropic {
  cached ??= new Anthropic({ logLevel: "off" });
  return cached;
}

// Turn SDK failures into codes the UI can translate. Everything here happens after the model was
// called, so no code here says the attempt is free: server_error is for what comes before the
// call. Logs carry a status or a class name, never an error message: one can quote the model's
// answer, and so the user's text.
function toRewriteError(error: unknown): RewriteError {
  if (error instanceof RewriteError) return error;
  // The call was cancelled on purpose: the reader left, or the deadline passed (logged below).
  // Checked first because the SDK's abort and connection errors are APIErrors too.
  if (error instanceof Anthropic.APIUserAbortError) {
    return new RewriteError("upstream_error", 502);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    console.error("Anthropic connection failed", error.name);
    return new RewriteError("upstream_error", 502);
  }
  // 429 is rate limiting, 529 means the API is overloaded. Once a stream is open the same news
  // comes as an event with a type and no status.
  if (
    error instanceof Anthropic.RateLimitError ||
    (error instanceof Anthropic.APIError &&
      (error.status === 529 ||
        error.type === "overloaded_error" ||
        error.type === "rate_limit_error"))
  ) {
    return new RewriteError("busy", 503);
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    // A bad key is our problem, not the user's
    console.error("Anthropic credentials rejected");
    return new RewriteError("upstream_error", 502);
  }
  if (error instanceof Anthropic.APIError) {
    console.error("Anthropic API error", error.status);
    return new RewriteError("upstream_error", 502);
  }
  // Includes the plain AnthropicError the SDK raises when a stream dies partway
  console.error(
    "Unexpected rewrite failure",
    error instanceof Error ? error.name : typeof error,
  );
  return new RewriteError("upstream_error", 502);
}

// The JSON schema the answer must follow. Only the schema: with the helper's parse step, the SDK
// itself would throw on a refusal or a cut-off answer, before we could read why the model stopped.
const { type, schema } = zodOutputFormat(ClaudeOutputSchema);
const OUTPUT_FORMAT = { type, schema };

const requestParams = (
  text: string,
  references: Reference[],
  options: MessageOptions,
) => ({
  model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  max_tokens: MAX_TOKENS,
  system: SYSTEM_PROMPT,
  output_config: {
    effort: "medium" as const,
    format: OUTPUT_FORMAT,
  },
  // Tags mark the text as data; edits are re-checked against the original
  messages: [
    {
      role: "user" as const,
      content: buildUserMessage(text, references, options),
    },
  ],
});

// The edits of a whole answer, or null when it was cut off or does not match the schema
function readEdits(message: Anthropic.Message): RawEdit[] | null {
  const answer = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  try {
    return ClaudeOutputSchema.safeParse(JSON.parse(answer)).data?.edits ?? null;
  } catch {
    return null;
  }
}

export async function requestEdits(
  text: string,
  references: Reference[] = [],
  client: Pick<Anthropic, "messages"> = getClient(),
  options: MessageOptions = {},
  elapsedMs = 0,
  report: AttemptReport = {},
): Promise<RawEdit[]> {
  const deadline = deadlineAfter(elapsedMs);
  const params = requestParams(text, references, options);
  const started = performance.now();
  report.model = params.model;
  try {
    const message = await client.messages.create(params, callOptions(deadline));
    noteAnswer(report, message);

    if (message.stop_reason === "refusal") {
      throw new RewriteError("refused", 422);
    }
    const edits = readEdits(message);
    if (!edits) throw new RewriteError("upstream_error", 502);
    return edits;
  } catch (error) {
    if (deadline.aborted) console.error("Model call reached its deadline");
    throw toRewriteError(error);
  } finally {
    report.modelMs = performance.now() - started;
  }
}

// Same request, but every edit is handed to `onEdit` the moment the model finishes writing it.
// Resolves with all edits once the answer is complete; rejects otherwise, and the edits handed
// over before that remain the caller's to keep.
export async function streamEdits(
  text: string,
  references: Reference[],
  onEdit: (edit: RawEdit) => void,
  options: MessageOptions = {},
  client: Pick<Anthropic, "messages"> = getClient(),
  signal?: AbortSignal,
  elapsedMs = 0,
  report: AttemptReport = {},
): Promise<RawEdit[]> {
  const parser = new EditStreamParser();
  const all: RawEdit[] = [];
  const deadline = deadlineAfter(elapsedMs);
  const params = requestParams(text, references, options);
  const started = performance.now();
  report.model = params.model;
  // The answer so far: a stream that ends early leaves the SDK with no message to ask for
  let soFar: Anthropic.Message | undefined;
  try {
    const stream = client.messages.stream(
      params,
      callOptions(deadline, signal),
    );
    stream.on("streamEvent", (_event, snapshot) => {
      soFar = snapshot;
    });
    stream.on("text", (delta: string) => {
      for (const edit of parser.push(delta)) {
        report.firstEditMs ??= performance.now() - started;
        all.push(edit);
        onEdit(edit);
      }
    });
    const message = await stream.finalMessage();
    noteAnswer(report, message);

    if (message.stop_reason === "refusal") {
      throw new RewriteError("refused", 422);
    }
    // Only a whole answer that follows the schema is complete. So {"edits":[]} means "nothing to
    // change", while {} or a cut-off list does not.
    if (message.stop_reason === "max_tokens" || !readEdits(message)) {
      throw new RewriteError("upstream_error", 502);
    }
    return all;
  } catch (error) {
    // The tokens the service had reported when the stream broke or was cancelled
    noteAnswer(report, soFar);
    if (deadline.aborted) console.error("Model call reached its deadline");
    throw toRewriteError(error);
  } finally {
    report.modelMs = performance.now() - started;
  }
}
