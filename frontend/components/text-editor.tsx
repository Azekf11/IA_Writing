"use client";

import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { countWords, MAX_CHARS } from "@/lib/text";

export type EditorStatus = "idle" | "loading";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  status?: EditorStatus;
  // Already translated by the caller
  error?: string | null;
};

export function TextEditor({
  value,
  onChange,
  onSubmit,
  status = "idle",
  error = null,
}: Props) {
  const t = useTranslations("Editor");
  const id = useId();

  const loading = status === "loading";
  const tooLong = value.length > MAX_CHARS;
  const empty = value.trim().length === 0;
  const canSubmit = !loading && !tooLong && !empty;
  const ratio = Math.min(value.length / MAX_CHARS, 1);

  return (
    <form
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit?.();
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {t("label")}
      </label>

      <div className="relative">
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("placeholder")}
          readOnly={loading}
          aria-invalid={tooLong}
          rows={11}
          className={cn(
            "w-full resize-y rounded-xl border border-border bg-background p-4 leading-relaxed outline-none transition-colors placeholder:text-muted/70 focus:border-accent aria-invalid:border-remove",
            loading && "opacity-60",
          )}
        />
        {loading && (
          <div
            className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-col gap-2"
            aria-hidden
          >
            <div className="skeleton h-2.5 w-2/3 rounded-full" />
            <div className="skeleton h-2.5 w-1/2 rounded-full" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex flex-col gap-1.5 text-sm text-muted"
          aria-live="polite"
        >
          <p>
            {t("words", { count: countWords(value) })}
            {" · "}
            <span className={cn(tooLong && "font-medium text-remove")}>
              {t("characters", { count: value.length, max: MAX_CHARS })}
            </span>
          </p>
          <div
            className="h-1 w-40 overflow-hidden rounded-full bg-surface-2"
            aria-hidden
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                tooLong
                  ? "bg-remove"
                  : ratio > 0.9
                    ? "bg-[#d98a0b]"
                    : "bg-accent",
              )}
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
        </div>

        {onSubmit && (
          <button
            type="submit"
            disabled={!canSubmit}
            className="group inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-semibold text-accent-foreground shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("rewriting")}
              </>
            ) : (
              <>
                {t("rewrite")}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </>
            )}
          </button>
        )}
      </div>

      {tooLong && (
        <p role="alert" className="flex items-center gap-2 text-sm text-remove">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {t("tooLong", { max: MAX_CHARS })}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </form>
  );
}
