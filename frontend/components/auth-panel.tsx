"use client";

import { LogOut, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { privacyLink } from "@/components/privacy-link";
import { useTypedEarly } from "@/components/use-typed-early";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import { keepDraftForSignIn } from "@/lib/rewrite/draft";
import { announceSignedIn } from "@/lib/signed-in";
import {
  announceSignedOut,
  followSession,
  forgetSession,
  leaveSession,
} from "@/lib/signed-out";

// reload: the script could not be fetched. offline: sending failed while the browser was offline,
// or auth-js could read no answer to the request for the link (status 0). correcting: back on the
// form after a link was sent, so the failure of an earlier link is over.
type Status =
  "idle" | "sending" | "sent" | "failed" | "reload" | "offline" | "correcting";

// A large script that only these two actions use: it is fetched when they need it
const loadClient = () => import("@/lib/supabase/browser");

// Whether this browser holds the session no more
async function endSession(): Promise<boolean> {
  try {
    const { createClient } = await loadClient();
    const auth = createClient()?.auth;
    if (!auth) return true;
    // This browser only: the reader's other devices would each need a new link
    const { error } = await auth.signOut({ scope: "local" });
    if (!error) return true;
    // The session goes all the same when the server could not be told, and stays when it could not
    // be renewed first: what the browser holds now decides
    const { data, error: unsure } = await auth.getSession();
    return !data.session && !unsure;
  } catch {
    // The script could not be fetched, or the session could not be reached
    return false;
  }
}

// Sign-in form for visitors, account chip for members
export function AuthPanel({ email }: { email: string | null }) {
  const t = useTranslations("Auth");
  const locale = useLocale();
  const router = useRouter();
  // The callback route sends failed sign-ins back with ?auth_error=1
  const linkFailed = useSearchParams().get("auth_error") === "1";
  const id = useId();
  const statusId = useId();
  const failureId = useId();
  const [value, setValue] = useState("");
  const box = useTypedEarly<HTMLInputElement>(value, setValue);
  const [status, setStatus] = useState<Status>("idle");
  const [sentTo, setSentTo] = useState("");
  const [signOutFailed, setSignOutFailed] = useState(false);
  // While Auth stalls, ending the session can take seconds
  const [signingOut, setSigningOut] = useState(false);
  const another = useRef<HTMLButtonElement>(null);

  // The link usually opens in another tab, and the cookie it sets is shared: this tab follows when
  // the reader comes back to it. Coming back from another app on iOS may not fire focus. Offline,
  // the refresh would fall back to a full load and the browser's error page would replace this one.
  const waiting = status === "sent" && !email;
  useEffect(() => {
    if (!waiting) return;
    const follow = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine)
        router.refresh();
    };
    window.addEventListener("focus", follow);
    document.addEventListener("visibilitychange", follow);
    return () => {
      window.removeEventListener("focus", follow);
      document.removeEventListener("visibilitychange", follow);
    };
  }, [waiting, router]);

  useEffect(() => {
    if (email) announceSignedIn();
  }, [email]);

  // Another tab ended the session, by signing out or deleting the account. Signed out already, this
  // one has nothing to end.
  useEffect(() => {
    if (!email) return;
    return followSession(locale);
  }, [email, locale]);

  // The button that was pressed is gone: the focus goes to what comes after it. It was disabled
  // while sending, and the browser dropped its focus to the page: a failure brings it back to the
  // address, unless the reader has put it somewhere since.
  const failed =
    status === "failed" || status === "reload" || status === "offline";
  useEffect(() => {
    if (status === "correcting") box.current?.focus();
    if (status === "sent") another.current?.focus();
    if (failed && document.activeElement === document.body)
      box.current?.focus();
  }, [status, failed, box]);

  async function signOut() {
    // Whatever comes next, these go
    forgetSession();
    setSignOutFailed(false);
    setSigningOut(true);
    if (!(await endSession())) {
      setSigningOut(false);
      return setSignOutFailed(true);
    }
    // The button stays busy until the page goes
    announceSignedOut();
    leaveSession(locale);
  }

  // Offline, or when auth-js could read no answer (status 0: none came, or what came is not the
  // API's, such as a page served in its place), the trouble is on the way to Auth, not in the
  // address. A network that is up but reaches nothing, such as a Wi-Fi that asks to sign in first,
  // leaves the browser online.
  const sendingFailed = (status?: number) =>
    setStatus(navigator.onLine && status !== 0 ? "failed" : "offline");

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    // Before the script is fetched: a second click meanwhile would spend one of the mailer's few sends
    setStatus("sending");
    // The box, not the state: the state can be a moment behind while the scripts arrive
    const email = (box.current?.value ?? value).trim();
    const client = await loadClient().catch(() => null);
    if (!client) {
      // Offline, a reload would put the browser's error page in this one's place, and the next click
      // fetches the script again
      if (!navigator.onLine) return setStatus("offline");
      // The address is not the trouble. If the site has changed since this page loaded, the script
      // is gone from where the page looks for it: a reload finds it. The reload empties the editor,
      // so its text is kept as for a link on its way, and the editor that loads takes it back.
      keepDraftForSignIn();
      return setStatus("reload");
    }
    try {
      const supabase = client.createClient();
      if (!supabase) return setStatus("failed");

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Come back to this page, whose address carries the reader's language
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${window.location.pathname}`,
        },
      });
      if (error) return sendingFailed(error.status);
      keepDraftForSignIn();
      setSentTo(email);
      setStatus("sent");
    } catch {
      sendingFailed();
    }
  }

  if (email) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-muted wrap-anywhere">
          <span className="size-2 shrink-0 rounded-full bg-add" aria-hidden />
          {t("signedInAs", { email })}
        </span>
        <button
          type="button"
          // One sign-out at a time. The button keeps its focus meanwhile, and the second click of a
          // double click never counts, also once a quick failure has given the button back.
          onClick={firstClick(() => {
            if (!signingOut) void signOut();
          })}
          aria-disabled={signingOut}
          className="inline-flex items-center gap-1.5 font-medium text-muted transition-colors hover:text-foreground aria-disabled:cursor-not-allowed"
        >
          <LogOut className="size-4" aria-hidden />
          {signingOut ? t("signingOut") : t("signOut")}
        </button>
        {signOutFailed && (
          <p role="alert" className="w-full text-remove">
            {t("signOutFailed")}
          </p>
        )}
      </div>
    );
  }

  const sent = status === "sent";

  // The status line is on the page before it has anything to say: many screen readers do not
  // announce a line that arrives together with its text
  return (
    <div
      // A held key repeats on whatever holds the focus by then: Use another address, which takes the
      // box's place as the link goes out, then the box it gives back, which would ask again. One
      // press asks for one link.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.repeat) event.preventDefault();
      }}
      className={cn(
        sent &&
          "flex flex-col items-start gap-3 rounded-lg border border-accent/30 bg-accent-soft p-4 text-sm",
      )}
    >
      <p
        id={statusId}
        role="status"
        className={cn(sent && "flex items-center gap-3 wrap-anywhere")}
      >
        {sent && (
          <>
            <Mail className="size-5 shrink-0 text-accent-text" aria-hidden />
            {t("checkEmail", { email: sentTo })}
          </>
        )}
      </p>
      {sent ? (
        <button
          ref={another}
          type="button"
          // The focus lands here as the message arrives, and can cut it off
          aria-describedby={statusId}
          onClick={firstClick(() => {
            // What was sent: the state can have been a moment behind the box
            setValue(sentTo);
            setStatus("correcting");
          })}
          className="rounded-lg border border-accent/30 px-3 py-1.5 font-semibold transition-all hover:bg-surface-2 active:scale-95"
        >
          {t("useAnother")}
        </button>
      ) : (
        <form
          onSubmit={signIn}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card"
        >
          <p className="text-sm text-muted">
            {t.rich("accountNote", { privacy: privacyLink })}
          </p>
          <label htmlFor={id} className="text-sm font-semibold">
            {t("emailLabel")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={box}
              id={id}
              type="email"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              // Fetched ahead of the click. If this fails, sending tries again and says so.
              onFocus={() => void loadClient().catch(() => {})}
              // The focus comes back here as a failure is announced, and can cut it off
              aria-describedby={failed ? failureId : undefined}
              placeholder={t("emailPlaceholder")}
              autoComplete="email"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 transition-colors placeholder:text-muted focus:border-accent"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-all hover:bg-accent-hover active:scale-95 disabled:opacity-40"
            >
              {status === "sending" ? t("sending") : t("sendLink")}
            </button>
          </div>
          {failed && (
            <p id={failureId} role="alert" className="text-sm text-remove">
              {t(
                status === "reload"
                  ? "sendNeedsReload"
                  : status === "offline"
                    ? "sendOffline"
                    : "sendFailed",
              )}
            </p>
          )}
          {linkFailed && status === "idle" && (
            <p role="alert" className="text-sm text-remove">
              {t("callbackFailed")}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
