"use client";

import { Check, Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95";

// The text as it stands with the accepted edits, ready to copy or download
export function ResultPanel({ result }: { result: string }) {
  const t = useTranslations("Review");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the text stays selectable on screen
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([result], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rewrite.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("result")}</h3>
        <div className="flex gap-2">
          <button type="button" onClick={download} className={quiet}>
            <Download className="size-4" aria-hidden />
            {t("download")}
          </button>
          <button type="button" onClick={copy} className={quiet}>
            {copied ? (
              <Check className="size-4 text-add" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      </div>
      <p
        data-testid="result"
        className={cn("whitespace-pre-wrap leading-relaxed")}
      >
        {result}
      </p>
    </div>
  );
}
