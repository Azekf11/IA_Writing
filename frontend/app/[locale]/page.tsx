import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { AccountSection } from "@/components/account-section";
import { DemoCard } from "@/components/demo-card";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SourcesNote } from "@/components/sources-note";
import { StatsStrip } from "@/components/stats-strip";
import { routing } from "@/i18n/routing";

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-8">
      <SiteHeader />

      <section className="flex flex-col gap-5 pt-6">
        <p className="w-fit rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span
            className="mr-2 inline-block size-1.5 rounded-full bg-accent align-middle"
            aria-hidden
          />
          {t("eyebrow")}
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          {t("headline")}
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">
          {t("tagline")}
        </p>
      </section>

      <StatsStrip />
      <DemoCard />

      <Suspense>
        <AccountSection />
      </Suspense>
      <RewriteWorkspace />
      <SourcesNote />
      <SiteFooter />
    </main>
  );
}
