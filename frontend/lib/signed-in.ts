// The account panel is the part of the page the server tells about the session. The editor can be
// showing "sign in to rewrite", which stops being true when a session arrives.
const EVENT = "rewrity:signed-in";

export const announceSignedIn = () => window.dispatchEvent(new Event(EVENT));

export function onSignedIn(listener: () => void) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
