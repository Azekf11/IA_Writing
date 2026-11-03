import { EventReader, STREAM_TYPE } from "./protocol";
import type { Strength } from "./schema";
import type {
  Edit,
  ErrorCode,
  ReferenceCredit,
  RewriteResponse,
} from "./types";

// "network" only exists in the browser: the connection failed, and the server may or may not have
// counted the attempt
export type ClientErrorCode = ErrorCode | "network";

// Written as a record so the compiler refuses a code that has no entry here
const CODES: Record<ClientErrorCode, true> = {
  invalid_request: true,
  unauthorized: true,
  quota_exceeded: true,
  global_quota_exceeded: true,
  too_many_requests: true,
  not_configured: true,
  refused: true,
  busy: true,
  upstream_error: true,
  server_error: true,
  network: true,
};

export const KNOWN_ERROR_CODES = Object.keys(CODES) as ClientErrorCode[];

export class RewriteRequestError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
  }
}

export type RewriteInput = {
  text: string;
  locale: string;
  strength?: Strength;
  voice?: string;
};

// What the page learns while the model is still writing
export type RewriteHandlers = {
  onStart?: (references: ReferenceCredit[]) => void;
  onEdit?: (edit: Edit) => void;
  signal?: AbortSignal;
};

const asCode = (value: unknown): ClientErrorCode =>
  KNOWN_ERROR_CODES.includes(value as ClientErrorCode)
    ? (value as ClientErrorCode)
    : "upstream_error";

const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

// Asks for a rewrite and hears about every edit as soon as it is ready.
// Resolves with the full result; rejects with a RewriteRequestError.
export async function fetchEdits(
  input: RewriteInput,
  handlers: RewriteHandlers = {},
): Promise<RewriteResponse> {
  let response: Response;
  try {
    response = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, stream: true }),
      signal: handlers.signal,
    });
  } catch (error) {
    // Cancelling is the caller's own doing, not a failure to report
    if (isAbort(error)) throw error;
    throw new RewriteRequestError("network");
  }

  const type = response.headers.get("content-type") ?? "";
  if (response.ok && type.includes(STREAM_TYPE) && response.body) {
    return readStream(response.body, handlers);
  }

  // Refusals (no session, quota, bad input) come back as plain JSON before any streaming starts
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RewriteRequestError(asCode(body?.error));
  if (!body || !Array.isArray(body.edits)) {
    throw new RewriteRequestError("upstream_error");
  }
  return body as RewriteResponse;
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  handlers: RewriteHandlers,
): Promise<RewriteResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events = new EventReader();
  const edits: Edit[] = [];
  let references: ReferenceCredit[] = [];
  let finished = false;
  let partial = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      for (const event of events.push(text)) {
        if (event.type === "start") {
          references = event.references;
          handlers.onStart?.(references);
        } else if (event.type === "edit") {
          edits.push(event.edit);
          handlers.onEdit?.(event.edit);
        } else if (event.type === "error") {
          throw new RewriteRequestError(asCode(event.error));
        } else {
          finished = true;
          partial = event.partial === true;
        }
      }
    }
  } catch (error) {
    if (error instanceof RewriteRequestError || isAbort(error)) throw error;
    throw new RewriteRequestError("network");
  }

  // The connection ended before the server said it was done
  if (!finished) throw new RewriteRequestError("network");
  return {
    edits: edits.sort((a, b) => a.start - b.start),
    references,
    partial,
  };
}
