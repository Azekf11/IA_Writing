import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Redirects "/" to the best locale (cookie, then Accept-Language)
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals and files with an extension
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
