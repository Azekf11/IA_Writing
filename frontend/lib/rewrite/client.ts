import type { ErrorCode, RewriteResponse } from "./types";

// "network" only exists in the browser: the request never reached the server
export type ClientErrorCode = ErrorCode | "network";

const KNOWN: ClientErrorCode[] = [
  "invalid_request",
  "unauthorized",
  "quota_exceeded",
  "not_configured",
  "refused",
  "busy",
  "upstream_error",
  "server_error",
  "network",
];

export class RewriteRequestError extends Error {
  constructor(readonly code: ClientErrorCode) {
    super(code);
  }
}

export async function fetchEdits(
  text: string,
  locale: string,
): Promise<RewriteResponse> {
  let response: Response;
  try {
    response = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, locale }),
    });
  } catch {
    throw new RewriteRequestError("network");
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Unknown bodies (proxy errors, HTML pages) fall back to a generic code
    const code = KNOWN.includes(body?.error) ? body.error : "upstream_error";
    throw new RewriteRequestError(code);
  }
  if (!body || !Array.isArray(body.edits)) {
    throw new RewriteRequestError("upstream_error");
  }
  return body as RewriteResponse;
}
