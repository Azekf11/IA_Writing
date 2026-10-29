import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Reference } from "@/lib/style/retrieve";
import { EditStreamParser } from "./edit-stream";
import { buildUserMessage, SYSTEM_PROMPT, type MessageOptions } from "./prompt";
import { ClaudeOutputSchema, type RawEdit } from "./schema";
import type { ErrorCode } from "./types";

// Cheap and fast enough for editing; override with ANTHROPIC_MODEL
const DEFAULT_MODEL = "claude-sonnet-5-5";

// Thinking tokens count against this limit too
const MAX_TOKENS = 8000;

// Stay under the route's 60 s limit. No retries: a retry could not finish in time,
// and the user can simply press the button again (the quota is refunded on failure).
const CALL_OPTIONS = { timeout: 50_000, maxRetries: 0 };

export class RewriteError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

let cached: Anthropic | undefined;

// Created lazily so a missing key fails at request time, not at build time
function getClient(): Anthropic {
  cached ??= new Anthropic();
  return cached;
}

// Turn SDK failures into codes the UI can translate
function toRewriteError(error: unknown): RewriteError {
  if (error instanceof RewriteError) return error;
  // 429 is rate limiting, 529 means the API is overloaded
  if (
    error instanceof Anthropic.RateLimitError ||
    (error instanceof Anthropic.APIError && error.status === 529)
  ) {
    return new RewriteError("busy", 503);
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    // A bad key is our problem, not the user's
    console.error("Anthropic credentials rejected");
    return new RewriteError("server_error", 500);
  }
  if (error instanceof Anthropic.APIError) {
    console.error("Anthropic API error", error.status);
    return new RewriteError("upstream_error", 502);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new RewriteError("upstream_error", 502);
  }
  console.error("Unexpected rewrite failure", error);
  return new RewriteError("server_error", 500);
}

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
    format: zodOutputFormat(ClaudeOutputSchema),
  },
  // Tags mark the text as data; edits are re-checked against the original
  messages: [
    {
      role: "user" as const,
      content: buildUserMessage(text, references, options),
    },
  ],
});

export async function requestEdits(
  text: string,
  references: Reference[] = [],
  client: Pick<Anthropic, "messages"> = getClient(),
  options: MessageOptions = {},
): Promise<RawEdit[]> {
  try {
    const message = await client.messages.parse(
      requestParams(text, references, options),
      CALL_OPTIONS,
    );

    if (message.stop_reason === "refusal") {
      throw new RewriteError("refused", 422);
    }
    // Null means the output was cut off or did not match the schema
    if (!message.parsed_output) {
      throw new RewriteError("upstream_error", 502);
    }
    return message.parsed_output.edits;
  } catch (error) {
    throw toRewriteError(error);
  }
}

// Same request, but every edit is handed to `onEdit` the moment the model finishes writing it.
// Resolves with all edits once the answer is complete.
export async function streamEdits(
  text: string,
  references: Reference[],
  onEdit: (edit: RawEdit) => void,
  options: MessageOptions = {},
  client: Pick<Anthropic, "messages"> = getClient(),
  signal?: AbortSignal,
): Promise<RawEdit[]> {
  const parser = new EditStreamParser();
  const all: RawEdit[] = [];
  try {
    const stream = client.messages.stream(
      requestParams(text, references, options),
      { ...CALL_OPTIONS, signal },
    );
    stream.on("text", (delta) => {
      for (const edit of parser.push(delta)) {
        all.push(edit);
        onEdit(edit);
      }
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      throw new RewriteError("refused", 422);
    }
    // A cut-off answer still holds every edit that was completed before the cut
    if (all.length === 0 && message.stop_reason === "max_tokens") {
      throw new RewriteError("upstream_error", 502);
    }
    return all;
  } catch (error) {
    throw toRewriteError(error);
  }
}
