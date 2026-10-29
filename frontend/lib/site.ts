// Absolute origin of the site, for canonical links, the sitemap and share images.
// Vercel sets the production host; locally it falls back to the dev server.
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
