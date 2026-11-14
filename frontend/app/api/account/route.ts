import { DEFAULT_COOKIE_OPTIONS, parseCookieHeader } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { readBody } from "@/lib/rewrite/body";
import { codeOf } from "@/lib/rewrite/quota";
import type { ErrorCode, ErrorResponse } from "@/lib/rewrite/types";
import { authIsDown, claimsInTime, inTime } from "@/lib/supabase/auth-down";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// The session check and the two calls to Auth after it have AUTH_MS each
export const maxDuration = 30;

// The body is one account id: anything much longer is not the page asking
const MAX_BODY_BYTES = 256;

function fail(code: ErrorCode, status: number) {
  return Response.json({ error: code } satisfies ErrorResponse, { status });
}

// A cookie goes along with a request from any site. The browser's Origin header is the part another
// site cannot write, so it has to name this one.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    .trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// The answer to a deletion whose sign-out did not finish. Every session cookie this browser sent, the
// session, its chunks and the code verifier, all named sb-, is expired at the path and with the
// attributes @supabase/ssr gives them. A session the session check renewed reaches the answer
// through Next, which reads these cookies back and drops a Max-Age of 0: the date still expires them.
function deletedAndSignedOut(request: Request) {
  const response = NextResponse.json({ deleted: true });
  const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
  for (const { name } of cookies) {
    if (name.startsWith("sb-")) {
      response.cookies.set(name, "", {
        ...DEFAULT_COOKIE_OPTIONS,
        maxAge: 0,
        expires: new Date(0),
      });
    }
  }
  return response;
}

// Deletes the signed-in account for good. Its history, counters and tickets go with it, through the
// foreign keys. The account deleted is the one the verified session names. The id in the body only
// has to agree with it: the page asks for the account it was rendered for, and a tab left open after
// signing in as someone else must not delete that other account.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail("invalid_request", 403);

  const raw = await readBody(request, MAX_BODY_BYTES);
  let account: unknown;
  try {
    account = JSON.parse(raw ?? "")?.account;
  } catch {
    // Falls through to the check below
  }
  if (typeof account !== "string" || !account) {
    return fail("invalid_request", 400);
  }

  const session = await createClient();
  const server = createServiceClient();
  if (!session || !server) {
    console.error("Account refused", "not_configured");
    return fail("not_configured", 503);
  }

  const claims = await claimsInTime(session);
  if (!claims || authIsDown(claims.error)) {
    console.error("Account refused", "auth_down");
    return fail("server_error", 500);
  }
  const userId = claims.data?.claims.sub;
  if (!userId) return fail("unauthorized", 401);
  if (account !== userId) return fail("invalid_request", 409);

  try {
    // A soft delete would keep the row, and the foreign keys only act when it goes
    const { error } = await inTime(server.auth.admin.deleteUser(userId, false));
    // A 404 is a deletion that already happened, in another tab for instance
    if (error && error.status !== 404) {
      console.error("Account deletion failed", codeOf(error));
      return fail("server_error", 500);
    }
  } catch (error) {
    console.error("Account deletion failed", codeOf(error));
    return fail("server_error", 500);
  }

  // Clears the session cookies. The account is gone by now, so nothing here can turn into a failure.
  try {
    await inTime(session.auth.signOut({ scope: "local" }));
  } catch (error) {
    console.error("Sign-out after deletion failed", codeOf(error));
    // Auth may not have ended the session, and this browser would look signed in to an account that
    // is gone until its token expires
    return deletedAndSignedOut(request);
  }
  return Response.json({ deleted: true });
}
