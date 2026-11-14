"use client";

import { Download, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import { saveFile } from "@/lib/save-file";
import {
  announceSignedOut,
  followSession,
  leaveSession,
} from "@/lib/signed-out";

const FILE_NAME = "rewrity-history.json";

// Each read starts from what has actually arrived, so a lower row cap on the API only means more reads
const READ_SIZE = 100;

const action =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95 aria-disabled:cursor-not-allowed";

// What the privacy page lists as stored for each rewrite
type ExportedRow = {
  original: string;
  edits: unknown;
  locale: string;
  created_at: string;
};

type ReadResult =
  { rows: ExportedRow[] } | { rows?: undefined; signedOut: boolean };

// The whole history, read through RLS in pages, or nothing: a file that looks complete and is not
// would be worse than a failure. The count is asked for each time, so a change made in another tab
// while this runs, which would shift the pages, stops it too.
async function readHistory(owner: string): Promise<ReadResult> {
  // A large script that only these actions use: it is fetched then
  const { createClient } = await import("@/lib/supabase/browser");
  const table = createClient()!.from("rewrites");
  const rows: ExportedRow[] = [];
  let expected: number | null = null;
  do {
    const { data, count, error, status } = await table
      .select("original, edits, locale, created_at", { count: "exact" })
      .eq("user_id", owner)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rows.length, rows.length + READ_SIZE - 1);
    expected ??= count;
    if (error || !data?.length || !count || count !== expected) {
      // Nothing to read for this account: the session ended, or another account took its place
      return { signedOut: status === 401 || count === 0 };
    }
    rows.push(...data);
  } while (rows.length < (expected ?? 0));
  return { rows };
}

// Takes a copy of the history, and leaves for good. `owner` is the account the page was rendered
// for: the browser sends whichever session its cookie holds now, which can be someone else's.
export function AccountActions({
  owner,
  hasHistory,
}: {
  owner: string;
  hasHistory: boolean;
}) {
  const t = useTranslations("Account");
  const locale = useLocale();
  const router = useRouter();
  const heading = useId();
  const ask = useId();
  const [pending, setPending] = useState<"download" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [failed, setFailed] = useState<
    "downloadFailed" | "deleteFailed" | "deleteStale" | null
  >(null);
  // A deletion that got no definite answer may have gone through, and taken the session with it
  const [maybeDeleted, setMaybeDeleted] = useState(false);

  const startOver = () => {
    setFailed(null);
    setSaved(null);
  };

  // Another tab ended the session, by signing out or deleting the account: this history is no
  // longer the reader's to see
  useEffect(() => followSession(locale), [locale]);

  async function download() {
    startOver();
    setPending("download");
    const read: ReadResult = await readHistory(owner).catch(() => ({
      signedOut: false,
    }));
    setPending(null);
    if (!read.rows) {
      setFailed("downloadFailed");
      if (read.signedOut) router.refresh();
      return;
    }
    saveFile(FILE_NAME, JSON.stringify(read.rows, null, 2), "application/json");
    setSaved(read.rows.length);
  }

  async function deleteAccount() {
    startOver();
    setPending("delete");
    const status = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: owner }),
    }).then(
      (answer) => answer.status,
      () => 0,
    );
    // After a press that may have deleted the account, no session is what the failure promised: a
    // plain sign-out. Signing in again to check would create a new account if the old one is gone.
    if (status === 200 || (status === 401 && maybeDeleted)) {
      announceSignedOut();
      // As after signing out
      leaveSession(locale);
      return;
    }
    setPending(null);
    if (status === 0 || status >= 500) setMaybeDeleted(true);
    setFailed(
      status === 401 || status === 409 ? "deleteStale" : "deleteFailed",
    );
    if (status === 401) router.refresh();
  }

  // Only one action at a time. The buttons stay focusable meanwhile, and the second click of a
  // double click never counts: the line below can come under the pointer as the page moves.
  const whenIdle = (run: () => void) =>
    firstClick(() => {
      if (pending === null) run();
    });

  // On the page before it has anything to say: many screen readers do not announce a line that
  // arrives together with its text
  const said = confirming
    ? t("deleteConfirm")
    : saved !== null
      ? t("downloaded", { count: saved })
      : "";

  return (
    <section
      aria-labelledby={heading}
      className="flex flex-col gap-3 border-t border-border pt-6"
    >
      <h2 id={heading} className="text-lg font-medium">
        {t("title")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {hasHistory && (
          <button
            type="button"
            onClick={whenIdle(download)}
            aria-disabled={pending !== null}
            className={action}
          >
            <Download className="size-4" aria-hidden />
            {pending === "download" ? t("downloading") : t("download")}
          </button>
        )}
        <button
          id={ask}
          type="button"
          onClick={whenIdle(() => {
            startOver();
            setConfirming(true);
          })}
          aria-disabled={pending !== null}
          className={cn(action, "hover:bg-remove-soft hover:text-remove")}
        >
          <Trash2 className="size-4" aria-hidden />
          {t("delete")}
        </button>
      </div>

      <p role="status" className={cn("text-sm", !said && "sr-only")}>
        {said}
      </p>
      {confirming && (
        <div
          role="group"
          aria-label={t("delete")}
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="button"
            onClick={whenIdle(deleteAccount)}
            aria-disabled={pending !== null}
            className="rounded-md bg-remove-soft px-2 py-1 text-xs font-medium text-remove aria-disabled:cursor-not-allowed"
          >
            {pending === "delete" ? t("deleting") : t("deleteYes")}
          </button>
          <button
            type="button"
            onClick={whenIdle(() => {
              startOver();
              setConfirming(false);
              document.getElementById(ask)?.focus();
            })}
            aria-disabled={pending !== null}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground aria-disabled:cursor-not-allowed"
          >
            {t("deleteNo")}
          </button>
        </div>
      )}
      {failed && (
        <p
          role="alert"
          className="rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          {t(failed)}
        </p>
      )}
    </section>
  );
}
