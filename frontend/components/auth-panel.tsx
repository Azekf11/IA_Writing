"use client";

import { LogOut, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/browser";

type Status = "idle" | "sending" | "sent" | "failed";

// Sign-in form for visitors, account chip for members
export function AuthPanel({ email }: { email: string | null }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const router = useRouter();
  // The callback route sends failed sign-ins back with ?auth_error=1
  const linkFailed = useSearchParams().get("auth_error") === "1";
  const id = useId();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function signOut() {
    await createClient()?.auth.signOut();
    // Re-render server components so they drop the old session
    router.push("/");
    router.refresh();
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return setStatus("failed");

    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: value.trim(),
      options: {
        // Come back to the page the user was on, in their language
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}`,
      },
    });
    setStatus(error ? "failed" : "sent");
  }

  if (email) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full bg-add" aria-hidden />
          {t("signedInAs", { email })}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:text-foreground"
        >
          <LogOut className="size-4" aria-hidden />
          {t("signOut")}
        </button>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <p
        role="status"
        className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 text-sm"
      >
        <Mail className="size-5 shrink-0 text-accent" aria-hidden />
        {t("checkEmail")}
      </p>
    );
  }

  return (
    <form
      onSubmit={signIn}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-card"
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {t("emailLabel")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          type="email"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 outline-none transition-colors focus:border-accent"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-all hover:brightness-110 active:scale-95 disabled:opacity-40"
        >
          {status === "sending" ? t("sending") : t("sendLink")}
        </button>
      </div>
      {status === "failed" && (
        <p role="alert" className="text-sm text-remove">
          {t("sendFailed")}
        </p>
      )}
      {linkFailed && status === "idle" && (
        <p role="alert" className="text-sm text-remove">
          {t("callbackFailed")}
        </p>
      )}
    </form>
  );
}
