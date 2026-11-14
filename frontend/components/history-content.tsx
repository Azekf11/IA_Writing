import { getTranslations } from "next-intl/server";
import { AccountActions } from "@/components/account-actions";
import { AuthPanel } from "@/components/auth-panel";
import { HistoryList } from "@/components/history-list";
import { HISTORY_COLUMNS, HISTORY_PAGE, historyItem } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";

// Reads the session cookie, so this page is rendered per request
export async function HistoryContent() {
  const t = await getTranslations("History");
  const supabase = await createClient();
  if (!supabase) return <p>{t("unavailable")}</p>;

  const { data } = await supabase.auth.getClaims();
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">{t("signInPrompt")}</p>
        <AuthPanel email={null} />
      </div>
    );
  }

  // RLS limits this query to the signed-in user's rows
  const {
    data: rows,
    count,
    error,
  } = await supabase
    .from("rewrites")
    .select(HISTORY_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(HISTORY_PAGE);
  // A read that failed must not look like an empty history
  if (error) return <p role="alert">{t("loadFailed")}</p>;

  const items = (rows ?? []).map(historyItem);
  const total = count ?? items.length;
  const owner = data.claims.sub;
  return (
    <>
      <HistoryList owner={owner} items={items} total={total} />
      <AccountActions owner={owner} hasHistory={total > 0} />
    </>
  );
}
