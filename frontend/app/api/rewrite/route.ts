import { RewriteError, requestEdits } from "@/lib/rewrite/claude";
import { locateEdits } from "@/lib/rewrite/locate";
import { RewriteRequestSchema } from "@/lib/rewrite/schema";
import type {
  ErrorCode,
  ErrorResponse,
  RewriteResponse,
} from "@/lib/rewrite/types";

// Claude can take a while on long texts
export const maxDuration = 60;

function fail(code: ErrorCode, status: number) {
  return Response.json({ error: code } satisfies ErrorResponse, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RewriteRequestSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", 400);

  if (!process.env.ANTHROPIC_API_KEY) return fail("not_configured", 503);

  const { text } = parsed.data;
  try {
    const raw = await requestEdits(text);
    const edits = locateEdits(text, raw);
    return Response.json({ edits } satisfies RewriteResponse);
  } catch (error) {
    if (error instanceof RewriteError) return fail(error.code, error.status);
    console.error("Unhandled rewrite error", error);
    return fail("server_error", 500);
  }
}
