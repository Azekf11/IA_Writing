"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { HistoryToolbar } from "@/components/history-toolbar";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
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
  "rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed";

export function HistoryList({ items }: { items: HistoryItem[] }) {
  const t = useTranslations("History");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function remove(ids: string[]) {
    setFailed(false);
    setPending(ids.length === 1 ? ids[0] : "all");
    const { error } = await createClient()!
      .from("rewrites")
      .delete()
      .in("id", ids);
    setPending(null);
    // Say so when it fails: a silent no-op looks like a broken button
    if (error) return setFailed(true);
    setRows((current) => current.filter((row) => !ids.includes(row.id)));
  }

  function reopen(row: HistoryItem) {
    stashReopen(row.original, row.edits);
    router.push("/");
  }

  if (rows.length === 0) {
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
        count={rows.length}
        query={query}
        onQuery={setQuery}
        onClear={() => remove(rows.map((row) => row.id))}
        busy={pending === "all"}
      />

      {failed && (
        <p
          role="alert"
          className="rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          {t("deleteFailed")}
        </p>
      )}

      {shown.length === 0 ? (
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
                  {format.dateTime(new Date(row.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {" · "}
                  {t("edits", { count: row.editCount })}
                </span>
                <span className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => reopen(row)}
                    className={quiet}
                  >
                    {t("reopen")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove([row.id])}
                    disabled={pending !== null}
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
