import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Only same-site paths are allowed, to avoid open redirects
function safePath(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}

// Magic links land here: trade the one-time code for a session cookie
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safePath(searchParams.get("next"));
  const code = searchParams.get("code");

  const supabase = await createClient();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}${next}?auth_error=1`);
}
