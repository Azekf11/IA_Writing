import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { AccountSection } from "@/components/account-section";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <SiteHeader />
      <p className="text-foreground/70">{t("tagline")}</p>
      <Suspense>
        <AccountSection />
      </Suspense>
      <RewriteWorkspace />
    </main>
  );
}
