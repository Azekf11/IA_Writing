"use client";

import { Check, Copy, Download, Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import { saveFile } from "@/lib/save-file";
import { countCharacters, countWords } from "@/lib/text";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95";

// The review's sticky row copies through this panel, which can show why a copy failed
export type ResultPanelHandle = { copy: () => Promise<boolean> };

function useCopy() {
  const [copied, setCopied] = useState(false);
  // The text that could not be copied: another decision makes a new one, and the message stale
  const [notCopied, setNotCopied] = useState<string | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotCopied(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      setNotCopied(text);
      return false;
    }
  }

  return { copied, notCopied, copy };
}

// The text as it stands with the accepted edits, ready to copy, download or edit further, with its
// length against the original's. `onEdit` is left out when there is nothing to carry over, and
// `changes` when no edit is accepted.
export function ResultPanel({
  result,
  original,
  changes = null,
  onEdit,
  onCopied,
  ref,
}: {
  result: string;
  // The text the edits were made on
  original: string;
  // The list of edits, ready to copy or download
  changes?: string | null;
  onEdit?: () => void;
  // The text reached the clipboard, from this panel or from the review's sticky row, or the list did
  onCopied?: (what: "text" | "list") => void;
  ref?: Ref<ResultPanelHandle>;
}) {
  const t = useTranslations("Review");
  const format = useFormatter();
  const text = useCopy();
  const list = useCopy();
  const panel = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLParagraphElement>(null);

  async function copyResult() {
    const done = await text.copy(result);
    if (done) onCopied?.("text");
    // The clipboard can be blocked: the reader gets the text ready to copy by hand
    else if (shown.current)
      window.getSelection()?.selectAllChildren(shown.current);
    return done;
  }

  useImperativeHandle(ref, () => ({
    copy: async () => {
      const done = await copyResult();
      // From the top of the page, the message and the selected text are out of sight
      if (!done) panel.current?.scrollIntoView?.({ block: "start" });
      return done;
    },
  }));

  const amount = (count: string, now: number, before: number) =>
    now === before
      ? count
      : t("length.changed", {
          count,
          difference: format.number(now - before, {
            signDisplay: "always",
          }),
        });
  const words = countWords(result);
  const characters = countCharacters(result);

  return (
    <div
      ref={panel}
      className="flex scroll-mt-24 flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("result")}</h3>
        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <button
              type="button"
              // The editor takes the place of the review under the pointer
              onClick={firstClick(onEdit)}
              className={quiet}
            >
              <Pencil className="size-4" aria-hidden />
              {t("editResult")}
            </button>
          )}
          <button
            type="button"
            // A short review can open with these two under the pointer that asked for it
            onClick={firstClick(() => saveFile("rewrite.txt", result))}
            className={quiet}
          >
            <Download className="size-4" aria-hidden />
            {t("download")}
          </button>
          <button
            type="button"
            // Built on the click, as copyResult reads a ref and a render may not
            onClick={(event) => firstClick(copyResult)(event)}
            className={quiet}
          >
            {text.copied ? (
              <Check className="size-4 text-add" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {text.copied ? t("copied") : t("copy")}
          </button>
        </div>
      </div>
      {text.notCopied === result && (
        <p role="alert" className="text-sm text-remove">
          {t("copyFailed")}
        </p>
      )}
      {/* Not announced: the workspace's status line already says what each decision did */}
      <p data-testid="result-length" className="text-xs text-muted">
        {amount(
          t("length.words", { count: words }),
          words,
          countWords(original),
        )}
        {" · "}
        {amount(
          t("length.characters", { count: characters }),
          characters,
          countCharacters(original),
        )}
      </p>
      <p
        ref={shown}
        data-testid="result"
        className={cn("whitespace-pre-wrap leading-relaxed")}
      >
        {result}
      </p>
      {changes !== null && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">{t("list.label")}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveFile("rewrite-edits.txt", changes)}
                className={quiet}
              >
                <Download className="size-4" aria-hidden />
                {t("list.download")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (await list.copy(changes)) onCopied?.("list");
                }}
                className={quiet}
              >
                {list.copied ? (
                  <Check className="size-4 text-add" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {list.copied ? t("copied") : t("list.copy")}
              </button>
            </div>
          </div>
          {list.notCopied === changes && (
            <p role="alert" className="text-sm text-remove">
              {t("list.copyFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
