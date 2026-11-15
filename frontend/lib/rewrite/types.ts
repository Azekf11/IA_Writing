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

// A review made in the browser rather than by the model: the site's own sample, or the free check of the box
export type ReviewSource = "sample" | "check";

// Authors whose excerpts guided the rewrite, shown to the user for transparency
export type ReferenceCredit = { author: string; title: string };

export type RewriteResponse = {
  edits: Edit[];
  references: ReferenceCredit[];
  // Only a stream can end early and still have edits to show
  partial?: boolean;
};

// Stable codes: the UI maps each one to a translated message
export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "quota_exceeded"
  | "global_quota_exceeded"
  | "too_many_requests"
  | "not_configured"
  | "refused"
  | "busy"
  | "provider_unavailable"
  | "upstream_error"
  | "no_usable_edit"
  | "server_error";

export type ErrorResponse = { error: ErrorCode };

// What the page may say about the limits. `used` is the asking session's own count and null for a
// visitor. The app-wide counts stay on the server: only whether rewriting is open leaves it.
export type Allowance = { limit: number; used: number | null; open: boolean };

// Null when the site cannot say: the line then goes away
export type AllowanceResponse = { allowance: Allowance | null };
