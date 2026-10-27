import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";
import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

// Locale routing first (cookie, then Accept-Language), then session refresh
export default async function proxy(request: NextRequest) {
  const response = handleI18n(request);
  return refreshSession(request, response);
}

export const config = {
  // Skip API routes, auth callback, Next internals and files with an extension
  matcher: "/((?!api|auth/|trpc|_next|_vercel|.*\\..*).*)",
};
