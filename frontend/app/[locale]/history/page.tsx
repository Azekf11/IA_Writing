import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HistoryContent } from "@/components/history-content";
import { HistorySkeleton } from "@/components/history-skeleton";
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
    <div className="flex flex-col gap-8">
      <h1 className="font-serif text-3xl font-medium tracking-tight">
        {t("title")}
      </h1>
      <Suspense fallback={<HistorySkeleton />}>
        <HistoryContent />
      </Suspense>
    </div>
  );
}
