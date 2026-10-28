// Shapes shared by the API route and the UI

export type Edit = {
  id: string;
  original: string;
  replacement: string;
  reason: string;
  // Offsets of `original` in the submitted text
  start: number;
  end: number;
};

// Authors whose excerpts guided the rewrite, shown to the user for transparency
export type ReferenceCredit = { author: string; title: string };

export type RewriteResponse = { edits: Edit[]; references: ReferenceCredit[] };

// Stable codes: the UI maps each one to a translated message
export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "quota_exceeded"
  | "not_configured"
  | "refused"
  | "busy"
  | "upstream_error"
  | "server_error";

export type ErrorResponse = { error: ErrorCode };
