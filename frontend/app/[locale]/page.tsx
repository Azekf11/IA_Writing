import { ClipboardPaste, ListChecks, ScanSearch } from "lucide-react";
import { hasLocale, useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { AccountSection } from "@/components/account-section";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";

const STEPS = [
  { key: "one", icon: ClipboardPaste },
  { key: "two", icon: ScanSearch },
  { key: "three", icon: ListChecks },
] as const;

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-8">
      <SiteHeader />

      <section className="flex flex-col gap-4 pt-4">
        <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {t("headline")}
        </h1>
        <p className="max-w-2xl text-lg text-muted">{t("tagline")}</p>
      </section>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ key, icon: Icon }, index) => (
          <li
            key={key}
            className="flex gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {index + 1}. {t(`steps.${key}.title`)}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {t(`steps.${key}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <Suspense>
        <AccountSection />
      </Suspense>
      <RewriteWorkspace />
      <SiteFooter />
    </main>
  );
}
