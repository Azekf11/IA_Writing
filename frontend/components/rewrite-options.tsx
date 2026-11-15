"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, type Dispatch, type SetStateAction } from "react";
import { SegmentedControl } from "@/components/segmented-control";
import { useTickedEarly, useTypedEarly } from "@/components/use-typed-early";
import { MAX_VOICE_CHARS, STRENGTHS, type Strength } from "@/lib/text";

export type Options = {
  strength: Strength;
  voice: string;
  // False leaves the rewrite out of the history. Keeping it is the default, and says nothing
  keep?: false;
};

export const DEFAULT_OPTIONS: Options = { strength: "standard", voice: "" };

type Props = {
  value: Options;
  onChange: Dispatch<SetStateAction<Options>>;
  disabled?: boolean;
};

// How much to change, and a sample of the author's own writing
export function RewriteOptions({ value, onChange, disabled }: Props) {
  const t = useTranslations("Editor");
  const voiceId = useId();
  const voiceHint = useId();
  const strengthHint = useId();
  const dontKeepHint = useId();
  // Each changes its own field: both can report at once, when the scripts arrive
  const onVoice = (voice: string) =>
    onChange((current) => ({ ...current, voice }));
  const voiceBox = useTypedEarly<HTMLTextAreaElement>(value.voice, onVoice);
  const onDontKeep = (dontKeep: boolean) =>
    onChange((current) => ({
      ...current,
      keep: dontKeep ? false : undefined,
    }));
  const dontKeepBox = useTickedEarly(value.keep === false, onDontKeep);

  return (
    <details className="group rounded-lg border border-border bg-background">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{t("options")}</span>
        <span className="flex items-center gap-2 text-xs">
          <span>
            {t(`strengths.${value.strength}`)}
            {value.voice.trim() ? ` · ${t("voiceShort")}` : ""}
            {value.keep === false ? ` · ${t("dontKeepShort")}` : ""}
          </span>
          <ChevronDown
            className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
            aria-hidden
          />
        </span>
      </summary>

      <div className="flex flex-col gap-4 border-t border-border p-4">
        <fieldset disabled={disabled} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">
            {t("strength")}
          </legend>
          <SegmentedControl
            label={t("strength")}
            value={value.strength}
            onChange={(strength) => onChange({ ...value, strength })}
            className="flex flex-wrap"
            segments={STRENGTHS.map((strength) => ({
              value: strength,
              content: t(`strengths.${strength}`),
              describedBy: `${strengthHint}-${strength}`,
              // One word on one line, on a phone too: the rule for long links is not for these.
              // Equal widths for as long as they fit, then the row wraps.
              className: "flex-1 text-sm [overflow-wrap:normal] max-sm:px-0.5",
            }))}
          />
          <p className="text-xs text-muted">
            {t(`strengthHint.${value.strength}`)}
          </p>
          {/* Each segment's own hint, for a screen reader that reaches one without choosing it.
              Hidden, they are not read a second time with the page. */}
          {STRENGTHS.map((strength) => (
            <span key={strength} id={`${strengthHint}-${strength}`} hidden>
              {t(`strengthHint.${strength}`)}
            </span>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={voiceId} className="text-sm font-semibold">
            {t("voice")}
          </label>
          <textarea
            ref={voiceBox}
            id={voiceId}
            value={value.voice}
            disabled={disabled}
            maxLength={MAX_VOICE_CHARS}
            rows={3}
            onChange={(event) => onVoice(event.target.value)}
            aria-describedby={voiceHint}
            placeholder={t("voicePlaceholder")}
            className="w-full resize-y rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed transition-colors placeholder:text-muted focus:border-accent max-sm:text-base"
          />
          <p
            id={voiceHint}
            className="flex justify-between gap-3 text-xs text-muted"
          >
            <span>{t("voiceHint")}</span>
            <span className="shrink-0">
              {t("voiceCount", {
                count: value.voice.length,
                max: MAX_VOICE_CHARS,
              })}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input
              ref={dontKeepBox}
              type="checkbox"
              checked={value.keep === false}
              disabled={disabled}
              onChange={(event) => onDontKeep(event.target.checked)}
              // Inside the form, Enter would send the text with the box still unticked
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              aria-describedby={dontKeepHint}
              className="mt-0.5 size-4 shrink-0 accent-accent max-sm:size-6"
            />
            {t("dontKeep")}
          </label>
          <p id={dontKeepHint} className="text-xs text-muted">
            {t("dontKeepHint")}
          </p>
        </div>
      </div>
    </details>
  );
}
