import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";

const SECTIONS = ["data", "ai", "limits"] as const;

export default async function PrivacyPage({
  params,
}: PageProps<"/[locale]/privacy">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("Privacy");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <SiteHeader />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-foreground/70">{t("intro")}</p>
      </div>
      {SECTIONS.map((section) => (
        <section key={section} className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t(`${section}Title`)}</h2>
          <p className="leading-relaxed">{t(section)}</p>
        </section>
      ))}
      <SiteFooter />
    </main>
  );
}
