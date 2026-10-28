export const ACCENTS = ["blue", "violet", "emerald", "amber", "rose"] as const;
export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: Accent = "blue";
export const ACCENT_KEY = "accent";

export const isAccent = (value: unknown): value is Accent =>
  typeof value === "string" && (ACCENTS as readonly string[]).includes(value);

// Runs in <head> before first paint, so the saved accent never flashes
export const ACCENT_SCRIPT = `try{var a=localStorage.getItem("${ACCENT_KEY}");if(${JSON.stringify(
  ACCENTS,
)}.indexOf(a)>-1)document.documentElement.dataset.accent=a}catch(e){}`;
