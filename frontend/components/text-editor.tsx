"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
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

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit?.();
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {t("label")}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("placeholder")}
        readOnly={loading}
        aria-invalid={tooLong}
        rows={12}
        className="w-full resize-y rounded-lg border border-foreground/20 bg-transparent p-3 leading-relaxed outline-none focus:border-foreground aria-invalid:border-red-500"
      />

      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="text-foreground/60" aria-live="polite">
          {t("words", { count: countWords(value) })}
          {" · "}
          <span className={tooLong ? "font-medium text-red-500" : undefined}>
            {t("characters", { count: value.length, max: MAX_CHARS })}
          </span>
        </p>

        {onSubmit && (
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-foreground px-4 py-2 font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? t("rewriting") : t("rewrite")}
          </button>
        )}
      </div>

      {tooLong && (
        <p role="alert" className="text-sm text-red-500">
          {t("tooLong", { max: MAX_CHARS })}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </form>
  );
}
