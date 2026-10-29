import { after } from "next/server";
import { RewriteError, requestEdits } from "@/lib/rewrite/claude";
import { DAILY_LIMIT, MAX_IN_FLIGHT } from "@/lib/rewrite/limits";
import { guardEdits } from "@/lib/rewrite/guard";
import { locateEdits } from "@/lib/rewrite/locate";
import { RewriteRequestSchema } from "@/lib/rewrite/schema";
import type {
  ErrorCode,
  ErrorResponse,
  RewriteResponse,
} from "@/lib/rewrite/types";
import { findReferences } from "@/lib/style/retrieve";
import { createClient } from "@/lib/supabase/server";

// Claude can take a while on long texts
export const maxDuration = 60;

// 5000 characters of JSON-escaped text stay far below this; bigger bodies are abuse
const MAX_BODY_BYTES = 40_000;

function fail(code: ErrorCode, status: number) {
  return Response.json({ error: code } satisfies ErrorResponse, { status });
}

export async function POST(request: Request) {
  // Read as text first so the size check happens before any parsing
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) return fail("invalid_request", 413);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Falls through to the schema check below
  }
  const parsed = RewriteRequestSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", 400);

  // Fail closed: without auth there is no quota, so no one can spend the key
  const supabase = await createClient();
  if (!process.env.ANTHROPIC_API_KEY || !supabase) {
    return fail("not_configured", 503);
  }

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return fail("unauthorized", 401);

  const { text, locale } = parsed.data;

  // The two lookups do not depend on each other, so they share one round trip
  const [quota, references] = await Promise.all([
    supabase.rpc("reserve_quota", {
      daily_limit: DAILY_LIMIT,
      max_in_flight: MAX_IN_FLIGHT,
    }),
    findReferences(supabase, text, locale),
  ]);
  const { data: reservation, error: quotaError } = quota;
  // 53400 is what reserve_quota raises when this user already has too many rewrites running
  if (quotaError?.code === "53400") return fail("too_many_requests", 429);
  if (quotaError) {
    console.error("Quota check failed", quotaError.code);
    return fail("server_error", 500);
  }
  if (!reservation) return fail("quota_exceeded", 429);

  try {
    const rawEdits = await requestEdits(text, references);
    const { kept, dropped } = guardEdits(rawEdits);
    const edits = locateEdits(text, kept);
    if (Object.keys(dropped).length > 0) console.info("Edits dropped", dropped);

    // Bookkeeping runs after the response is sent: the user does not wait for it.
    // History is a bonus, and a slot that is not freed here frees itself after 90 s.
    after(async () => {
      const [saved, finished] = await Promise.all([
        supabase.from("rewrites").insert({
          user_id: userId,
          original: text,
          edits,
          edit_count: edits.length,
          locale,
        }),
        supabase.rpc("finish_rewrite", { reservation }),
      ]);
      if (saved.error) console.error("History save failed", saved.error.code);
      if (finished.error)
        console.error("finish_rewrite failed", finished.error.code);
    });

    const credits = references.map(({ author, title }) => ({ author, title }));
    return Response.json({
      edits,
      references: credits,
    } satisfies RewriteResponse);
  } catch (error) {
    // The user got nothing, so give the request back with the ticket only we hold
    after(async () => {
      await supabase.rpc("release_quota", { reservation });
    });
    if (error instanceof RewriteError) return fail(error.code, error.status);
    console.error("Unhandled rewrite error", error);
    return fail("server_error", 500);
  }
}
