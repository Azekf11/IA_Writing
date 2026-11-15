"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getAllowance,
  getServerAllowance,
  refreshAllowance,
  subscribeAllowance,
} from "@/lib/rewrite/allowance-store";
import { onSignedIn } from "@/lib/signed-in";

// What the reader can expect before pressing Rewrite. Worded as a ceiling, because the site-wide
// limits can stop an attempt sooner, and it stops no one: only the route refuses.
export function AllowanceLine() {
  const t = useTranslations("Allowance");
  const format = useFormatter();
  const allowance = useSyncExternalStore(
    subscribeAllowance,
    getAllowance,
    getServerAllowance,
  );
  const line = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    void refreshAllowance();
    // A session has arrived, and the line is still the one for a visitor
    return onSignedIn(() => {
      if (getAllowance()?.used === null) void refreshAllowance();
    });
  }, []);

  // Spoken when it changes, not when it first appears: that would be at every visit
  useEffect(() => {
    if (allowance) line.current?.setAttribute("aria-live", "polite");
  }, [allowance]);

  function words() {
    if (!allowance) return null;
    if (!allowance.open) return t("paused");
    const { limit, used, resetsAt } = allowance;
    if (used === null) return t("visitor", { limit });
    return t("member", {
      left: Math.max(limit - used, 0),
      limit,
      // The zone is the site's, not the reader's (i18n/request.ts), so it is shown
      time: format.dateTime(resetsAt, {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    });
  }

  return (
    // Its height is there from the start, as many lines as the longest words take at that width: the
    // editor below does not move when they arrive. Two lines only from 336 px: where Chromium rounds
    // glyph advances, as on Linux, the French words still take three at 320.
    <p
      ref={line}
      aria-atomic
      className="min-h-15 text-sm text-muted min-[336px]:min-h-10 sm:min-h-5"
    >
      {words()}
    </p>
  );
}
