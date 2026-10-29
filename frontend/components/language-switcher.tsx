"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/cn";

export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="flex rounded-lg border border-border bg-surface p-0.5 text-xs font-semibold"
    >
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          aria-current={locale === current ? "true" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1.5 uppercase transition-colors",
            locale === current
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          {locale}
        </Link>
      ))}
    </nav>
  );
}
