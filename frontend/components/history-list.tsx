"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
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

  async function remove(id: string) {
    const { error } = await createClient()!
      .from("rewrites")
      .delete()
      .eq("id", id);
    if (!error) setRows((current) => current.filter((row) => row.id !== id));
  }

  if (rows.length === 0) {
    return <p className="text-foreground/60">{t("empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-foreground/15 p-4">
          <div className="flex items-center justify-between gap-3 text-xs text-foreground/60">
            <span>
              {format.dateTime(new Date(row.createdAt), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {" · "}
              {t("edits", { count: row.editCount })}
            </span>
            <button
              type="button"
              onClick={() => remove(row.id)}
              className="underline"
            >
              {t("delete")}
            </button>
          </div>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap">
            {row.original}
          </p>
        </li>
      ))}
    </ul>
  );
}
