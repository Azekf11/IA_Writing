import { RewriteError, requestEdits } from "@/lib/rewrite/claude";
import { DAILY_LIMIT } from "@/lib/rewrite/limits";
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

  // Take the quota first so parallel requests can't bypass the limit
  const { data: used, error: quotaError } = await supabase.rpc(
    "consume_quota",
    { daily_limit: DAILY_LIMIT },
  );
  if (quotaError) {
    console.error("Quota check failed", quotaError.code);
    return fail("server_error", 500);
  }
  if (used === -1) return fail("quota_exceeded", 429);

  const { text, locale } = parsed.data;
  try {
    const references = await findReferences(supabase, text, locale);
    const rawEdits = await requestEdits(text, references);
    const edits = locateEdits(text, rawEdits);

    // History is a bonus: a failed save must not lose the result
    const { error: saveError } = await supabase.from("rewrites").insert({
      user_id: userId,
      original: text,
      edits,
      edit_count: edits.length,
      locale,
    });
    if (saveError) console.error("History save failed", saveError.code);

    const credits = references.map(({ author, title }) => ({ author, title }));
    return Response.json({
      edits,
      references: credits,
    } satisfies RewriteResponse);
  } catch (error) {
    // The user got nothing, so give the request back
    await supabase.rpc("refund_quota");
    if (error instanceof RewriteError) return fail(error.code, error.status);
    console.error("Unhandled rewrite error", error);
    return fail("server_error", 500);
  }
}
