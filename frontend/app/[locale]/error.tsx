"use client";

import { RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

// Shown when a page throws while rendering; `reset` retries the render
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");

  useEffect(() => {
    console.error("Page error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <p className="text-lg font-semibold">{t("page")}</p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-semibold text-accent-foreground transition-all hover:brightness-110 active:scale-[0.98]"
      >
        <RotateCcw className="size-4" aria-hidden />
        {t("retry")}
      </button>
    </main>
  );
}
