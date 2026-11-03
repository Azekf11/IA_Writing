import { getTranslations } from "next-intl/server";
import { AuthPanel } from "@/components/auth-panel";
import { HistoryList } from "@/components/history-list";
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
    .select("id, original, edits, edit_count, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(50);
  // A read that failed must not look like an empty history
  if (error) return <p role="alert">{t("loadFailed")}</p>;

  const items = (rows ?? []).map((row) => ({
    id: row.id,
    original: row.original,
    edits: Array.isArray(row.edits) ? row.edits : [],
    editCount: row.edit_count,
    createdAt: row.created_at,
  }));
  return <HistoryList items={items} total={count ?? items.length} />;
}
