"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/browser";

type Status = "idle" | "sending" | "sent" | "failed";

// Sign-in form for visitors, sign-out button for members
export function AuthPanel({ email }: { email: string | null }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const router = useRouter();
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
      <div className="flex items-center gap-3 text-sm">
        <span className="text-foreground/60">{t("signedInAs", { email })}</span>
        <button type="button" onClick={signOut} className="underline">
          {t("signOut")}
        </button>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <p role="status" className="rounded-lg bg-foreground/5 p-3 text-sm">
        {t("checkEmail")}
      </p>
    );
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {t("emailLabel")}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="email"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("emailPlaceholder")}
          autoComplete="email"
          className="min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-3 py-2 outline-none focus:border-foreground"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {status === "sending" ? t("sending") : t("sendLink")}
        </button>
      </div>
      {status === "failed" && (
        <p role="alert" className="text-sm text-red-500">
          {t("sendFailed")}
        </p>
      )}
    </form>
  );
}
