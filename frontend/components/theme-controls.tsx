"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SegmentedControl } from "@/components/segmented-control";
import { ACCENTS, type Accent } from "@/lib/accent";
import {
  getAccent,
  getServerAccent,
  setAccent,
  subscribeAccent,
} from "@/lib/accent-store";

const THEMES = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
] as const;

const SWATCH: Record<Accent, string> = {
  blue: "bg-[#3b6cf6]",
  violet: "bg-[#7c5cf0]",
  emerald: "bg-[#128758]",
  amber: "bg-[#d98a0b]",
  rose: "bg-[#ce3f71]",
};

// The server cannot know the theme, so UI that depends on it waits for the client
const subscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

export function ThemeControls() {
  const t = useTranslations("Theme");
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const accent = useSyncExternalStore(
    subscribeAccent,
    getAccent,
    getServerAccent,
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Close on outside click and on Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The control that held the focus goes with the panel: the focus would fall to the page
      if (root.current?.contains(document.activeElement))
        trigger.current?.focus();
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={t("label")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted transition-colors hover:text-foreground"
      >
        <Palette className="size-4" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("label")}
          // On a phone the header wraps and this button can sit anywhere: centred on the screen
          className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-border bg-surface p-3 shadow-card max-sm:fixed max-sm:inset-x-0 max-sm:mx-auto"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            {t("mode")}
          </p>
          <SegmentedControl
            label={t("mode")}
            value={mounted ? theme : undefined}
            onChange={setTheme}
            className="grid grid-cols-3"
            segments={THEMES.map(({ value, icon: Icon }) => ({
              value,
              content: (
                <>
                  <Icon className="size-3.5" aria-hidden />
                  {t(value)}
                </>
              ),
              className: "flex items-center justify-center gap-1.5 text-xs",
            }))}
          />

          <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted">
            {t("accent")}
          </p>
          <SegmentedControl
            label={t("accent")}
            look="swatches"
            value={accent}
            onChange={setAccent}
            className="flex"
            segments={ACCENTS.map((name) => ({
              value: name,
              label: t(`accents.${name}`),
              content: accent === name && (
                <Check className="size-4" aria-hidden />
              ),
              className: SWATCH[name],
            }))}
          />
        </div>
      )}
    </div>
  );
}
