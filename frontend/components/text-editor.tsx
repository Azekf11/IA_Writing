"use client";

import {
  AlertCircle,
  ArrowRight,
  ListChecks,
  Loader2,
  Wand2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import {
  countCharacters,
  countWords,
  MAX_CHARS,
  MAX_CHECK_CHARS,
} from "@/lib/text";
import { privacyLink } from "@/components/privacy-link";
import { RewriteOptions, type Options } from "@/components/rewrite-options";
import { useTypedEarly } from "@/components/use-typed-early";

export type EditorStatus = "idle" | "loading" | "checking";

type Props = {
  value: string;
  onChange: (value: string) => void;
  // Told once the box is on the page, with what it holds: that can be ahead of `value`
  onReady?: (held: string) => void;
  onSubmit?: () => void;
  status?: EditorStatus;
  // Already translated by the caller
  error?: string | null;
  // Offered while the editor is empty: opens the sample review
  onExample?: () => void;
  // Looks for stock phrases in the browser, so it works on more text than a rewrite takes
  onCheck?: () => void;
  // Intensity and the author's own writing; shown only when the page handles them
  options?: Options;
  onOptionsChange?: Dispatch<SetStateAction<Options>>;
  // Offered while there is a review to go back to, and the box holds the text it was made on
  onResume?: () => void;
  // The button that led here is gone: the box takes the focus when it appears
  focusOnOpen?: boolean;
};

export function TextEditor({
  value,
  onChange,
  onReady,
  onSubmit,
  status = "idle",
  error = null,
  onExample,
  onCheck,
  options,
  onOptionsChange,
  onResume,
  focusOnOpen = false,
}: Props) {
  const t = useTranslations("Editor");
  const id = useId();
  const counts = `${id}-counts`;
  const errorId = `${id}-error`;

  const box = useTypedEarly<HTMLTextAreaElement>(value, onChange);
  const ready = useEffectEvent(() => {
    onReady?.(box.current?.value ?? "");
    if (focusOnOpen) box.current?.focus();
  });
  useEffect(() => ready(), []);

  // The button that started what is running is disabled meanwhile, and the browser drops its focus
  // to the page. A failure gives it back, unless the reader has put it somewhere since.
  const [pressed, setPressed] = useState<"submit" | "check">("submit");
  const submitButton = useRef<HTMLButtonElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const giveFocusBack = useEffectEvent(() => {
    if (document.activeElement !== document.body) return;
    const button = pressed === "check" ? checkButton : submitButton;
    button.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (error) giveFocusBack();
  }, [error]);

  const loading = status === "loading";
  const checking = status === "checking";
  const length = countCharacters(value);
  const tooLong = length > MAX_CHARS;
  const empty = value.trim().length === 0;
  const canSubmit = !loading && !checking && !tooLong && !empty;
  const canCheck = !loading && !checking && !empty && length <= MAX_CHECK_CHARS;
  const ratio = Math.min(length / MAX_CHARS, 1);
  const send = () => {
    setPressed("submit");
    onSubmit?.();
  };
  // The focus lands on the button as the message arrives, and can cut it off
  const describedOnFailure = (button: typeof pressed) =>
    error && pressed === button ? errorId : undefined;

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) send();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {t("label")}
        </label>
        {onResume && (
          // Comes and goes as the box changes: the negative margin keeps the line's height, so the
          // text being typed does not jump. It also comes under the pointer of the button that led here.
          <button
            type="button"
            onClick={firstClick(onResume)}
            className="-my-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95"
          >
            {t("backToReview")}
            <ArrowRight className="size-4" aria-hidden />
          </button>
        )}
      </div>

      <div className="relative">
        <textarea
          ref={box}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              // Held, it repeats: one press is one request
              if (canSubmit && !event.repeat) send();
            }
          }}
          placeholder={t("placeholder")}
          // A check takes a moment to load, and it reads the text as it was when it was asked for
          readOnly={loading || checking}
          aria-invalid={tooLong}
          aria-describedby={counts}
          rows={11}
          className={cn(
            "w-full resize-y rounded-lg border border-border bg-background p-4 leading-relaxed transition-colors placeholder:text-muted focus:border-accent aria-invalid:border-remove",
            loading && "opacity-60",
          )}
        />
        {empty && !loading && onExample && (
          <button
            type="button"
            // The review takes the place of this button under the pointer, and comes back the same way
            onClick={firstClick(onExample)}
            className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:text-foreground"
          >
            <Wand2 className="size-3.5" aria-hidden />
            {t("example")}
          </button>
        )}
      </div>

      {options && onOptionsChange && (
        <RewriteOptions
          value={options}
          onChange={onOptionsChange}
          disabled={loading}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5 text-sm text-muted">
          <p id={counts}>
            {t("words", { count: countWords(value) })}
            {" · "}
            <span className={cn(tooLong && "font-medium text-remove")}>
              {t("characters", { count: length, max: MAX_CHARS })}
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

        <div className="flex flex-wrap items-center gap-2">
          {onCheck && (
            <button
              ref={checkButton}
              type="button"
              onClick={firstClick(() => {
                setPressed("check");
                onCheck();
              })}
              disabled={!canCheck}
              aria-describedby={describedOnFailure("check")}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 font-semibold transition-all hover:bg-surface-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {checking ? (
                <Loader2
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden
                />
              ) : (
                <ListChecks className="size-4" aria-hidden />
              )}
              {t("check")}
            </button>
          )}
          {onSubmit && (
            <button
              ref={submitButton}
              type="submit"
              disabled={!canSubmit}
              aria-describedby={describedOnFailure("submit")}
              className="group inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-foreground shadow-sm transition-all hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:bg-accent"
            >
              {loading ? (
                <>
                  <Loader2
                    className="size-4 motion-safe:animate-spin"
                    aria-hidden
                  />
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
      </div>

      {tooLong && (
        <p role="alert" className="flex items-center gap-2 text-sm text-remove">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {length > MAX_CHECK_CHARS
            ? t("checkTooLong", { max: MAX_CHECK_CHARS })
            : t("tooLong", { max: MAX_CHARS })}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <p className="text-xs text-muted">
        {t.rich(options?.keep === false ? "noticeNotKept" : "notice", {
          privacy: privacyLink,
        })}
      </p>
    </form>
  );
}
