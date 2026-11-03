import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { after } from "next/server";
import { RewriteError, requestEdits } from "@/lib/rewrite/claude";
import { guardEdits } from "@/lib/rewrite/guard";
import { locateEdits } from "@/lib/rewrite/locate";
import {
  finishRewrite,
  releaseQuota,
  reserveQuota,
  startRewrite,
  type Outcome,
} from "@/lib/rewrite/quota";
import { RewriteRequestSchema } from "@/lib/rewrite/schema";
import { streamResponse } from "@/lib/rewrite/stream-response";
import type {
  Edit,
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

// The auth server being out of reach or overloaded does not mean the user signed out
const authIsDown = (error: { status?: number } | null) =>
  isAuthRetryableFetchError(error) ||
  error?.status === 429 ||
  (error?.status ?? 0) >= 500;

export async function POST(request: Request) {
  const started = performance.now();

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

  const { data, error: authError } = await supabase.auth.getClaims();
  if (authIsDown(authError)) return fail("server_error", 500);
  const userId = data?.claims.sub;
  if (!userId) return fail("unauthorized", 401);

  const { text, locale, strength, voice, stream } = parsed.data;
  const options = { strength, voice };

  // The quota comes first: a refused request costs no embedding, no search and no model call
  const reservation = await reserveQuota(supabase);
  if (!reservation.ok) return fail(reservation.code, reservation.status);
  const { ticket } = reservation;

  // A ticket exists from here on. Once the reader leaves, the platform may end the function except
  // for work handed to after(), so this holds it open until the ticket's bookkeeping is handed over.
  const holding = Promise.withResolvers<void>();
  after(() => holding.promise);

  try {
    // Nobody is waiting any more and nothing has started: the attempt goes back
    if (request.signal.aborted) {
      after(() => releaseQuota(supabase, ticket));
      return new Response(null, { status: 499 });
    }

    // Starting counts the attempt against the app-wide ceilings. The style search comes after
    // it on purpose: the database only lets a started ticket read the corpus, once.
    const start = await startRewrite(supabase, ticket);
    if (!start.ok) {
      // The model was not called, so the attempt goes back to the account
      after(() => releaseQuota(supabase, ticket));
      return fail(start.code, start.status);
    }
    const references = await findReferences(supabase, ticket, text, locale);

    const prepared = performance.now();

    // Only the text and the edits go into the history: the voice sample is never stored
    const saveHistory = async (edits: Edit[]) => {
      try {
        const { error } = await supabase.from("rewrites").insert({
          user_id: userId,
          original: text,
          edits,
          edit_count: edits.length,
          locale,
        });
        if (error) console.error("History save failed", error.code);
      } catch (error) {
        console.error(
          "History save failed",
          error instanceof Error ? error.name : typeof error,
        );
      }
    };
    // Runs once the answer is out, whichever way it was sent. The attempt was started by now, so
    // it stays counted whatever the outcome; closing the ticket frees its slot.
    const settle = async (outcome: Outcome, history: Edit[] | null) => {
      await Promise.all([
        history ? saveHistory(history) : null,
        finishRewrite(supabase, ticket, outcome),
      ]);
    };

    if (stream) {
      const { response, settled } = streamResponse({
        text,
        references,
        options,
        signal: request.signal,
        prepMs: prepared - started,
        onSettled: settle,
      });
      after(() => settled);
      return response;
    }

    try {
      const rawEdits = await requestEdits(
        text,
        references,
        undefined,
        options,
        prepared - started,
      );
      const modelled = performance.now();
      const { kept, dropped } = guardEdits(rawEdits);
      const edits = locateEdits(text, kept);
      if (Object.keys(dropped).length > 0)
        console.info("Edits dropped", dropped);
      // Every proposal failed a check: that is not "nothing to change"
      if (edits.length === 0 && rawEdits.length > (dropped.unchanged ?? 0)) {
        throw new RewriteError("upstream_error", 502);
      }

      after(() => settle("succeeded", edits));

      const credits = references.map(({ author, title }) => ({
        author,
        title,
      }));
      // Visible in the browser's network panel: where the time went
      const timing = [
        `prep;dur=${Math.round(prepared - started)}`,
        `model;dur=${Math.round(modelled - prepared)}`,
        `total;dur=${Math.round(performance.now() - started)}`,
      ].join(", ");
      return Response.json(
        { edits, references: credits } satisfies RewriteResponse,
        { headers: { "Server-Timing": timing } },
      );
    } catch (error) {
      // The user got nothing usable, but the paid call was made: the attempt stays counted
      after(() => settle("failed", null));
      if (error instanceof RewriteError) return fail(error.code, error.status);
      console.error(
        "Unhandled rewrite error",
        error instanceof Error ? error.name : typeof error,
      );
      return fail("server_error", 500);
    }
  } finally {
    holding.resolve();
  }
}
