"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { HistoryToolbar } from "@/components/history-toolbar";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import { stashReopen } from "@/lib/rewrite/reopen";
import type { Edit } from "@/lib/rewrite/types";
import { createClient } from "@/lib/supabase/browser";

export type HistoryItem = {
  id: string;
  original: string;
  edits: Edit[];
  editCount: number;
  createdAt: string;
};

const quiet =
  "rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground aria-disabled:cursor-not-allowed";

export function HistoryList({
  items,
  total: storedTotal = items.length,
}: {
  items: HistoryItem[];
  // How many entries the account holds: the page only loads the most recent ones
  total?: number;
}) {
  const t = useTranslations("History");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [total, setTotal] = useState(storedTotal);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // A new answer from the server replaces the list, and leaves the search as it is
  const [served, setServed] = useState(items);
  if (items !== served) {
    setServed(items);
    setRows(items);
    setTotal(storedTotal);
  }

  // Say so when it fails: a silent no-op looks like a broken button. A 401 means the session ended
  // elsewhere, so the page has to follow. Nothing else asks for the page again: offline, that
  // would replace it with the browser's error page.
  function deleteFailed(status: number) {
    setFailed(true);
    if (status === 401) router.refresh();
  }

  async function remove(id: string) {
    setFailed(false);
    setPending(id);
    const { error, status } = await createClient()!
      .from("rewrites")
      .delete()
      .in("id", [id]);
    setPending(null);
    if (error) return deleteFailed(status);
    setRows((current) => current.filter((row) => row.id !== id));
    setTotal((count) => count - 1);
    // Older entries can move up, and the browser's copy of this page must not bring the row back
    router.refresh();
  }

  // Every entry of the account, loaded or not. RLS limits the delete to the user's own rows;
  // the filter is there because the API refuses a delete without one.
  async function clear() {
    setFailed(false);
    setPending("all");
    const { error, status } = await createClient()!
      .from("rewrites")
      .delete()
      .not("id", "is", null);
    setPending(null);
    if (error) return deleteFailed(status);
    setRows([]);
    setTotal(0);
    router.refresh();
  }

  function reopen(row: HistoryItem) {
    stashReopen(row.original, row.edits);
    router.push("/");
  }

  // Only one action at a time. The buttons stay focusable meanwhile, or the keyboard would lose its
  // place in the list; the second click of a double click never counts (firstClick).
  const whenIdle = (action: () => void) =>
    firstClick(() => {
      if (pending === null) action();
    });

  if (total === 0) {
    return (
      <div className="flex flex-col gap-1 border-t border-border pt-8">
        <p className="font-medium">{t("empty")}</p>
        <p className="text-sm text-muted">{t("emptyHint")}</p>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => row.original.toLowerCase().includes(needle))
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <HistoryToolbar
        count={total}
        query={query}
        onQuery={setQuery}
        onClear={clear}
        busy={pending !== null}
      />

      {total > rows.length && rows.length > 0 && (
        <p className="text-xs text-muted">
          {t("olderHidden", { count: rows.length })}
        </p>
      )}

      {failed && (
        <p
          role="alert"
          className="rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          {t("deleteFailed")}
        </p>
      )}

      {shown.length === 0 && needle ? (
        <p className="text-sm text-muted">{t("noMatch", { query })}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {shown.map((row) => (
            <li
              key={row.id}
              className={cn(
                "flex flex-col gap-2 py-4 transition-opacity",
                (pending === row.id || pending === "all") && "opacity-50",
              )}
            >
              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <span>
                  {/* The zone is the site's, not the reader's (i18n/request.ts), so it is shown.
                      Browsers word a date differently from Node, so the server's wording stays. */}
                  <time dateTime={row.createdAt} suppressHydrationWarning>
                    {format.dateTime(new Date(row.createdAt), {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </time>
                  {" · "}
                  {t("edits", { count: row.editCount })}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    // Comes under the pointer when the Delete all question closes
                    onClick={whenIdle(() => reopen(row))}
                    aria-disabled={pending !== null}
                    className={quiet}
                  >
                    {t("reopen")}
                  </button>
                  <button
                    type="button"
                    // The list closes up, so the next row's Delete comes under the pointer
                    onClick={whenIdle(() => remove(row.id))}
                    aria-disabled={pending !== null}
                    className={cn(
                      quiet,
                      "inline-flex items-center gap-1 hover:bg-remove-soft hover:text-remove",
                    )}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {t("delete")}
                  </button>
                </span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap leading-relaxed">
                {row.original}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
