import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { HistoryList } from "@/components/history-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

// Reads the session cookie, so this page is rendered per request
async function HistoryContent() {
  const t = await getTranslations("History");
  const supabase = await createClient();
  if (!supabase) return <p>{t("unavailable")}</p>;

  const { data } = await supabase.auth.getClaims();
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-foreground/70">{t("signInPrompt")}</p>
        <AuthPanel email={null} />
      </div>
    );
  }

  // RLS limits this query to the signed-in user's rows
  const { data: rows } = await supabase
    .from("rewrites")
    .select("id, original, edit_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const items = (rows ?? []).map((row) => ({
    id: row.id,
    original: row.original,
    editCount: row.edit_count,
    createdAt: row.created_at,
  }));
  return <HistoryList items={items} />;
}

export default async function HistoryPage({
  params,
}: PageProps<"/[locale]/history">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("History");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
      <SiteHeader />
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <Suspense>
        <HistoryContent />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
