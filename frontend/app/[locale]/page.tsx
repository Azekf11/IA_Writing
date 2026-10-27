import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { use } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 px-6">
      <div className="absolute right-6 top-6">
        <LanguageSwitcher />
      </div>
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-lg text-foreground/70">{t("tagline")}</p>
    </main>
  );
}
