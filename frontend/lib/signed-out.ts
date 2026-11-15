import { clearKeptDraft } from "@/lib/rewrite/draft";
import { clearReopen } from "@/lib/rewrite/reopen";

// The browser's other tabs share the session's cookie, and go on showing an account that has gone
// until they load again: the tab that ends the session tells them. A browser that has no
// BroadcastChannel, or refuses one as it can refuse storage, tells nothing and hears nothing.
const CHANNEL = "rewrity:session";

// A tab hears its own news too, and needs none of it: it is leaving already
const TAB = Math.random().toString(36).slice(2);

function open(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

export function announceSignedOut(): void {
  const channel = open();
  channel?.postMessage({ signedOut: TAB });
  channel?.close();
}

export function onSignedOutElsewhere(listener: () => void): () => void {
  const channel = open();
  if (!channel) return () => {};
  channel.onmessage = ({ data }) => {
    if (data?.signedOut && data.signedOut !== TAB) listener();
  };
  return () => channel.close();
}

// Whether this page has shown a session since it was loaded, and how many of the parts showing one
// are there to hear the news themselves
let shown = false;
let listening = 0;

// For a part of the page that shows the session: when another tab ends it, the page leaves
export function followSession(locale: string): () => void {
  shown = true;
  listening++;
  const stop = onSignedOutElsewhere(() => leaveSession(locale));
  return () => {
    listening--;
    stop();
  };
}

// For the layout, around every page. A client navigation keeps the editor's text and the router's
// copies of earlier pages, so a page that shows no session, reached from one that did, still holds
// what that session left: it leaves too. A page that never showed one has nothing to end.
export function followSessionShown(locale: string): () => void {
  return onSignedOutElsewhere(() => {
    if (shown && listening === 0) leaveSession(locale);
  });
}

// What the browser holds of a session besides its cookie: the text kept for a sign-in link, and a
// rewrite on its way from the history to the editor
export function forgetSession(): void {
  clearKeptDraft();
  clearReopen();
}

// A full load of the home page: nothing of the session stays on the screen or in memory, and a
// request still running stops
export function leaveSession(locale: string): void {
  forgetSession();
  window.location.assign(new URL(`/${locale}`, window.location.origin));
}
