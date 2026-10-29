"use client";

import { Clock, Inbox, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/browser";

export type HistoryItem = {
  id: string;
  original: string;
  editCount: number;
  createdAt: string;
};

export function HistoryList({ items }: { items: HistoryItem[] }) {
  const t = useTranslations("History");
  const format = useFormatter();
  const [rows, setRows] = useState(items);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function remove(id: string) {
    setFailed(false);
    setPending(id);
    const { error } = await createClient()!
      .from("rewrites")
      .delete()
      .eq("id", id);
    setPending(null);
    // Say so when it fails: a silent no-op looks like a broken button
    if (error) return setFailed(true);
    setRows((current) => current.filter((row) => row.id !== id));
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-6 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <Inbox className="size-6" aria-hidden />
        </span>
        <p className="font-semibold">{t("empty")}</p>
        <p className="text-sm text-muted">{t("emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {failed && (
        <p
          role="alert"
          className="rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          {t("deleteFailed")}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              "rounded-xl border border-border bg-surface p-4 shadow-card transition-opacity",
              pending === row.id && "opacity-50",
            )}
          >
            <div className="flex items-center justify-between gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden />
                {format.dateTime(new Date(row.createdAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                <span aria-hidden>·</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                  {t("edits", { count: row.editCount })}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(row.id)}
                disabled={pending === row.id}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:bg-remove-soft hover:text-remove disabled:cursor-not-allowed"
              >
                <Trash2 className="size-3.5" aria-hidden />
                {t("delete")}
              </button>
            </div>
            <p className="mt-3 line-clamp-3 whitespace-pre-wrap leading-relaxed">
              {row.original}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
