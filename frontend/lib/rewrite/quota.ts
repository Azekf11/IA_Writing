import type { SupabaseClient } from "@supabase/supabase-js";
import type { ErrorCode } from "./types";

// The limits themselves live in the database (public.quota_limits). This file only talks to the
// four functions that move a ticket along: reserve -> start -> finish, or reserve -> release when
// the model was never called. Only the server's client may call them, for the account the route
// read from the verified session, and the database checks that account owns the ticket each time.

type Rpc = Pick<SupabaseClient, "rpc">;

// How an attempt that reached the model ended. Every one of them stays counted.
export type Outcome = "succeeded" | "failed" | "cancelled";

export type Refusal = { ok: false; code: ErrorCode; status: number };

// What the quota functions raise, as the UI should hear it
const REFUSALS: Record<string, { code: ErrorCode; status: number }> = {
  "53400": { code: "too_many_requests", status: 429 },
  "53401": { code: "quota_exceeded", status: 429 },
  "53402": { code: "global_quota_exceeded", status: 429 },
  "53403": { code: "global_quota_exceeded", status: 429 },
  // No account. A missing or expired session stops earlier, at the route's sign-in check.
  "28000": { code: "unauthorized", status: 401 },
  // The account was deleted while its session was still valid: its counter has no owner
  "23503": { code: "unauthorized", status: 401 },
};

// Anything unexpected is a refusal too: when the check itself fails, nobody calls the model
const FAILED: Refusal = { ok: false, code: "server_error", status: 500 };

// The error fields that are safe to log: a code, never a message
const codeOf = (error: unknown): string =>
  (error as { code?: string } | null)?.code || "unknown";

function refusal(label: string, error: unknown): Refusal {
  const known = REFUSALS[codeOf(error)];
  if (known) return { ok: false, ...known };
  console.error(`${label} failed`, codeOf(error));
  return FAILED;
}

// Takes one of the account's attempts before anything is spent
export async function reserveQuota(
  server: Rpc,
  account: string,
): Promise<{ ok: true; ticket: string } | Refusal> {
  try {
    const { data, error } = await server.rpc("reserve_quota", { account });
    if (error) return refusal("reserve_quota", error);
    if (typeof data === "string" && data) return { ok: true, ticket: data };
    console.error("reserve_quota failed", "no ticket");
  } catch (error) {
    console.error("reserve_quota failed", codeOf(error));
  }
  return FAILED;
}

// Starts the attempt: clears it for the style search and the model. The app-wide ceilings count here.
// Anything but ok means: do not call the model.
export async function startRewrite(
  server: Rpc,
  account: string,
  ticket: string,
): Promise<{ ok: true } | Refusal> {
  try {
    const { data, error } = await server.rpc("start_rewrite", {
      account,
      reservation: ticket,
    });
    if (error) return refusal("start_rewrite", error);
    if (data === true) return { ok: true };
    console.error("start_rewrite failed", "ticket not live");
  } catch (error) {
    console.error("start_rewrite failed", codeOf(error));
  }
  return FAILED;
}

// Closes a started ticket and frees its slot. When this fails, the database closes the ticket
// itself once its lifetime has passed, and the attempt stays counted either way.
export async function finishRewrite(
  server: Rpc,
  account: string,
  ticket: string,
  outcome: Outcome,
): Promise<void> {
  try {
    const { error } = await server.rpc("finish_rewrite", {
      account,
      reservation: ticket,
      outcome,
    });
    if (error) console.error("finish_rewrite failed", codeOf(error));
  } catch (error) {
    console.error("finish_rewrite failed", codeOf(error));
  }
}

// Gives the attempt back. The database only agrees for a ticket that never started, so calling
// this once the model may have been called gives nothing back.
export async function releaseQuota(
  server: Rpc,
  account: string,
  ticket: string,
): Promise<void> {
  try {
    const { error } = await server.rpc("release_quota", {
      account,
      reservation: ticket,
    });
    if (error) console.error("release_quota failed", codeOf(error));
  } catch (error) {
    console.error("release_quota failed", codeOf(error));
  }
}
