"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { cn } from "@/lib/cn";
import {
  MAX_VOICE_CHARS,
  STRENGTHS,
  type Strength,
} from "@/lib/rewrite/schema";

export type Options = { strength: Strength; voice: string };

export const DEFAULT_OPTIONS: Options = { strength: "standard", voice: "" };

type Props = {
  value: Options;
  onChange: (value: Options) => void;
  disabled?: boolean;
};

// How much to change, and a sample of the author's own writing
export function RewriteOptions({ value, onChange, disabled }: Props) {
  const t = useTranslations("Editor");
  const voiceId = useId();

  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground">
        <span>{t("options")}</span>
        <span className="text-xs">
          {t(`strengths.${value.strength}`)}
          {value.voice.trim() ? ` · ${t("voice").split(" (")[0]}` : ""}
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-border p-4">
        <fieldset disabled={disabled} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">
            {t("strength")}
          </legend>
          <div
            role="radiogroup"
            aria-label={t("strength")}
            className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1"
          >
            {STRENGTHS.map((strength) => {
              const active = value.strength === strength;
              return (
                <button
                  key={strength}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange({ ...value, strength })}
                  className={cn(
                    "rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {t(`strengths.${strength}`)}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            {t(`strengthHint.${value.strength}`)}
          </p>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={voiceId} className="text-sm font-semibold">
            {t("voice")}
          </label>
          <textarea
            id={voiceId}
            value={value.voice}
            disabled={disabled}
            maxLength={MAX_VOICE_CHARS}
            rows={3}
            onChange={(event) =>
              onChange({ ...value, voice: event.target.value })
            }
            placeholder={t("voicePlaceholder")}
            className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed transition-colors placeholder:text-muted/70 focus:border-accent"
          />
          <p className="flex justify-between gap-3 text-xs text-muted">
            <span>{t("voiceHint")}</span>
            <span className="shrink-0">
              {t("voiceCount", {
                count: value.voice.length,
                max: MAX_VOICE_CHARS,
              })}
            </span>
          </p>
        </div>
      </div>
    </details>
  );
}
