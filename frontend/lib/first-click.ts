import type { MouseEvent } from "react";

// For a button that takes the place of another one: the second click of a double click lands on
// it, and must not count. Keyboard activation reports 0 clicks, so it always goes through.
export const firstClick = (action: () => void) => (event: MouseEvent) => {
  if (event.detail <= 1) action();
};
