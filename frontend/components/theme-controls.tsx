"use client";

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ACCENTS, type Accent } from "@/lib/accent";
import {
  getAccent,
  getServerAccent,
  setAccent,
  subscribeAccent,
} from "@/lib/accent-store";
import { cn } from "@/lib/cn";

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

  // Close on outside click and on Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
          className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-3 shadow-card"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
            {t("mode")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("mode")}
            className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1"
          >
            {THEMES.map(({ value, icon: Icon }) => {
              const active = mounted && theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {t(value)}
                </button>
              );
            })}
          </div>

          <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted">
            {t("accent")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("accent")}
            className="flex gap-2"
          >
            {ACCENTS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={accent === name}
                aria-label={t(`accents.${name}`)}
                onClick={() => setAccent(name)}
                className={cn(
                  "grid size-8 place-items-center rounded-full text-white transition-transform hover:scale-110",
                  SWATCH[name],
                  accent === name &&
                    "ring-2 ring-foreground ring-offset-2 ring-offset-surface",
                )}
              >
                {accent === name && <Check className="size-4" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
