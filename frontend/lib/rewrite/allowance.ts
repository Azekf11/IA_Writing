import type { SupabaseClient } from "@supabase/supabase-js";
import type { Allowance } from "./types";

type Tables = Pick<SupabaseClient, "from">;

// For one line on a page: it must not hold a function for the route's whole minute. The session check
// before the reads gets as long.
export const READ_MS = 3_000;

function answerOf<Data>(read: { data: Data | null; error: unknown }) {
  if (read.error || read.data === null) throw read.error ?? new Error("empty");
  return read.data;
}

// What the page may say about the limits. The limits and the app-wide counts are closed to browsers,
// so they come through the server's client; the account's own count comes through the session's,
// under RLS. Throws when a read fails.
export async function readAllowance(
  server: Tables,
  session: Tables,
  account: string | null,
  now = new Date(),
): Promise<Allowance> {
  // The windows of start_rewrite: the UTC day, and the calendar month it falls in
  const today = now.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const signal = AbortSignal.timeout(READ_MS);

  const [limits, days, own] = await Promise.all([
    server
      .from("quota_limits")
      .select("user_daily, global_daily, global_monthly")
      .abortSignal(signal)
      .single(),
    server
      .from("usage_global")
      .select("day, count")
      .gte("day", monthStart)
      .abortSignal(signal),
    account
      ? session
          .from("usage")
          .select("count")
          .eq("user_id", account)
          .eq("day", today)
          .abortSignal(signal)
          .maybeSingle()
      : null,
  ]);

  const { user_daily, global_daily, global_monthly } = answerOf(limits);
  const rows = answerOf(days);
  const usedToday = rows.find((row) => row.day === today)?.count ?? 0;
  const usedThisMonth = rows.reduce((sum, row) => sum + row.count, 0);
  if (own?.error) throw own.error;

  return {
    limit: user_daily,
    used: own && (own.data?.count ?? 0),
    open:
      user_daily > 0 &&
      usedToday < global_daily &&
      usedThisMonth < global_monthly,
  };
}
