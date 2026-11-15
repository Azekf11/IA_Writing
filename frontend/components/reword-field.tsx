"use client";

import { AlertCircle, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { firstClick } from "@/lib/first-click";
import type { FactChange, factChange } from "@/lib/rewrite/guard";
import { MAX_CHARS } from "@/lib/text";

const button =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 max-sm:py-2.5 disabled:cursor-not-allowed disabled:opacity-40";

type Props = {
  // The element the page brings back the focus to when this field is already open
  id: string;
  original: string;
  // The wording to start from
  initial: string;
  // The words this edit is about, for the buttons
  describedBy: string;
  // From the keyboard, with the warning shown, if any: that way never passes the button that carries it
  onSave: (
    wording: string,
    fromKeyboard: boolean,
    concern?: FactChange | null,
  ) => void;
  onCancel: () => void;
};

// The writer's own wording for one edit. Takes the focus when it opens. The checks the server runs on
// the model's edits warn here without blocking: it is the writer's text, and they have the last
// word. Their code is fetched when a first field opens, and until it arrives there is no warning.
export function RewordField({
  id,
  original,
  initial,
  describedBy,
  onSave,
  onCancel,
}: Props) {
  const t = useTranslations("Review");
  const warningId = useId();
  const blankId = useId();
  const [wording, setWording] = useState(initial);
  const [check, setCheck] = useState<typeof factChange | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The field takes the focus while the E that opened it, or that brought the focus back to it, can
  // still be held down: its repeats are not the writer's words. A key pressed here ends that, until
  // the focus comes back.
  const pressedHere = useRef(false);

  useEffect(() => {
    const field = box.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
    let live = true;
    import("@/lib/rewrite/guard")
      .then(({ factChange }) => {
        if (live) setCheck(() => factChange);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const blank = !wording.trim();
  const concern = blank ? null : (check?.(original, wording) ?? null);

  return (
    <span
      className="mt-2 flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (!event.repeat) pressedHere.current = true;
        else if (!pressedHere.current) return event.preventDefault();
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          if (!blank) onSave(wording, true, concern);
        }
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {t("rewordLabel")}
      </label>
      <textarea
        ref={box}
        id={id}
        value={wording}
        onFocus={() => {
          pressedHere.current = false;
        }}
        onChange={(event) => setWording(event.target.value)}
        maxLength={MAX_CHARS}
        rows={Math.min(8, 2 + Math.floor(initial.length / 70))}
        aria-invalid={blank}
        aria-describedby={concern ? warningId : blank ? blankId : undefined}
        className="block w-full resize-y rounded-lg border border-border bg-background p-3 text-base leading-relaxed transition-colors focus:border-accent aria-invalid:border-remove sm:text-sm"
      />
      {concern && (
        <span
          id={warningId}
          className="flex items-start gap-1.5 text-xs text-remove"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {t(`rewordWarning.${concern}`)} {t("rewordCheck")}
          </span>
        </span>
      )}
      {blank && (
        <span id={blankId} className="text-xs text-muted">
          {t("rewordBlank")}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-2">
        {/* Both come under the pointer of the button that opened the field */}
        <button
          type="button"
          disabled={blank}
          aria-describedby={
            concern ? `${warningId} ${describedBy}` : describedBy
          }
          onClick={firstClick(() => onSave(wording, false))}
          className={`${button} bg-accent text-accent-foreground hover:bg-accent-hover`}
        >
          <Check className="size-3.5" aria-hidden />
          {t("rewordSave")}
        </button>
        <button
          type="button"
          aria-describedby={describedBy}
          onClick={firstClick(onCancel)}
          className={`${button} border border-border hover:bg-surface-2`}
        >
          <X className="size-3.5" aria-hidden />
          {t("rewordCancel")}
        </button>
        <span className="text-xs text-muted [@media(hover:none)]:hidden">
          {t("rewordKeys")}
        </span>
      </span>
    </span>
  );
}
