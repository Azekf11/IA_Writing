import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Forced colours take away backgrounds and shadows, and those are all that marks the chosen item
export const CHOSEN_IN_FORCED_COLORS =
  "forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none";

// Join class names, letting later Tailwind utilities win over earlier ones
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
