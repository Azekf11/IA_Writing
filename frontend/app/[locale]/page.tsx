import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { AccountSection, AccountSkeleton } from "@/components/account-section";
import { AllowanceLine } from "@/components/allowance-line";
import { DemoCard } from "@/components/demo-card";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { SourcesNote } from "@/components/sources-note";
import { routing } from "@/i18n/routing";

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Home");

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4 pt-8">
        <h1 className="max-w-3xl font-serif text-4xl font-medium leading-[1.12] tracking-tight sm:text-6xl">
          {t("headline")}
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">
          {t("tagline")}
        </p>
      </section>

      <div className="flex flex-col gap-2">
        <Suspense fallback={<AccountSkeleton />}>
          <AccountSection />
        </Suspense>
        <AllowanceLine />
      </div>
      <RewriteWorkspace />
      <DemoCard />
      <SourcesNote />
    </div>
  );
}
