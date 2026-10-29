import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

// Refreshes the auth cookies so server code always sees a fresh session.
// `response` is the one already built by the i18n proxy.
export async function refreshSession(
  request: NextRequest,
  response: NextResponse,
) {
  const env = supabaseEnv();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Validates the token and refreshes it when close to expiry
  await supabase.auth.getClaims();
  return response;
}
