import { ACCENT_KEY, DEFAULT_ACCENT, isAccent, type Accent } from "./accent";

// The accent lives on <html data-accent>, set before paint by ACCENT_SCRIPT.
// This store lets React read it, and re-render when it changes.
const listeners = new Set<() => void>();

export function subscribeAccent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAccent(): Accent {
  const value = document.documentElement.dataset.accent;
  return isAccent(value) ? value : DEFAULT_ACCENT;
}

// The server renders the default; the client corrects it right after hydration
export const getServerAccent = (): Accent => DEFAULT_ACCENT;

export function setAccent(next: Accent) {
  document.documentElement.dataset.accent = next;
  try {
    localStorage.setItem(ACCENT_KEY, next);
  } catch {
    // Private mode: the choice just lasts for this visit
  }
  listeners.forEach((listener) => listener());
}
