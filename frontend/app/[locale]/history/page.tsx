import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HistoryContent } from "@/components/history-content";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";
import { alternatesFor } from "@/lib/site";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "History" });
  return { title: t("title"), alternates: alternatesFor(locale, "/history") };
}

export default async function HistoryPage({
  params,
}: PageProps<"/[locale]/history">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("History");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
      <SiteHeader />
      <h1 className="font-serif text-3xl font-medium tracking-tight">
        {t("title")}
      </h1>
      <Suspense>
        <HistoryContent />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
