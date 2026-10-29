import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { siteUrl } from "@/lib/site";

// Public pages only: the history needs a session
const PAGES = ["", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PAGES.flatMap((page) =>
    routing.locales.map((locale) => ({
      url: `${base}/${locale}${page}`,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((other) => [other, `${base}/${other}${page}`]),
        ),
      },
    })),
  );
}
