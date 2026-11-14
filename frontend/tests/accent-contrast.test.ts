// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENTS } from "@/lib/accent";

// The colours as the style sheet sets them, for every theme and accent. axe in the audit measures
// text only: rings and a fill under the pointer are measured here.

const ROOT = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const CSS = read("app/globals.css");

type Rgb = [number, number, number];

// The custom properties each top-level rule sets, by selector
const RULES = new Map(
  [...CSS.matchAll(/^([^{}\n]+?)\s*\{([^}]*)\}/gm)].map(
    ([, selector, body]) => [
      selector.trim(),
      Object.fromEntries(
        [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
          name,
          value.trim(),
        ]),
      ),
    ],
  ),
);

// The same cascade as the page: the night class and the accent are both on <html>, and a rule for
// both wins over a rule for either
function tokensFor(night: boolean, accent?: string) {
  const selectors = [
    ":root",
    night && ".dark",
    accent && `[data-accent="${accent}"]`,
    night && accent && `.dark[data-accent="${accent}"]`,
  ].filter((selector): selector is string => !!selector);
  return Object.assign(
    {},
    ...selectors.map((s) => RULES.get(s) ?? {}),
  ) as Record<string, string>;
}

const NAMED: Record<string, Rgb> = { black: [0, 0, 0], white: [255, 255, 255] };

function colour(value: string, tokens: Record<string, string>): Rgb {
  const token = value.match(/^var\(--([\w-]+)\)$/);
  if (token) {
    const found = tokens[token[1]];
    if (!found) throw new Error(`--${token[1]} is not set`);
    return colour(found, tokens);
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex)
    return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  if (NAMED[value]) return NAMED[value];
  // What the page uses to shade a colour: two colours mixed in sRGB
  const mix = value.match(/^color-mix\(in srgb, (\S+) (\d+)%, (\S+)\)$/);
  if (mix) {
    const [first, second] = [colour(mix[1], tokens), colour(mix[3], tokens)];
    const share = Number(mix[2]) / 100;
    return first.map((c, i) => c * share + second[i] * (1 - share)) as Rgb;
  }
  throw new Error(`cannot read the colour ${value}`);
}

// WCAG's relative luminance and contrast ratio
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

// What a utility such as ring-accent-text paints with, read from the theme block
function utilityColour(name: string) {
  const theme = RULES.get("@theme inline") ?? {};
  const value = theme[`color-${name}`];
  if (!value) throw new Error(`no theme colour for ${name}`);
  return value;
}

// Every state the page can be in: by day and by night, before any accent is chosen and with each
const STATES = [false, true].flatMap((night) =>
  [undefined, ...ACCENTS].map((accent) => ({
    night,
    accent,
    name: `${night ? "night" : "day"} ${accent ?? "default"}`,
    tokens: tokensFor(night, accent),
  })),
);

// Each pair below its floor, named so that a failure says where
function under(
  floor: number,
  pairs: (tokens: Record<string, string>) => [string, string, string][],
) {
  return STATES.flatMap(({ name, tokens }) =>
    pairs(tokens)
      .map(([what, front, back]) => ({
        what,
        value: ratio(colour(front, tokens), colour(back, tokens)),
      }))
      .filter(({ value }) => value < floor)
      .map(({ what, value }) => `${name}: ${what} ${value.toFixed(2)}`),
  );
}

const BEHIND = ["background", "surface", "surface-2"];

describe("the accent's colours", () => {
  it("finds every state it measures", () => {
    expect(STATES).toHaveLength(12);
    expect(colour("var(--accent)", tokensFor(true, "amber"))).toEqual([
      0xf5, 0xb1, 0x3d,
    ]);
  });

  // WCAG 1.4.11: what shows the focus needs 3:1 against what it is drawn on
  it("draw a focus ring of 3:1 at least on every surface", () => {
    const ring = CSS.match(
      /:focus-visible\s*\{[^}]*outline:[^;]*?(var\([^)]+\))/,
    );
    expect(ring).not.toBeNull();
    const failing = under(3, () =>
      BEHIND.map((back) => [
        `focus ring on ${back}`,
        ring![1],
        `var(--${back})`,
      ]),
    );
    expect(failing).toEqual([]);
  });

  // The ring is all that tells the edit the keys act on from the others
  it("draw the active edit's ring at 3:1 at least, against the page and the card", () => {
    const ring = read("components/diff-view.tsx").match(/ring-2 ring-([\w-]+)/);
    expect(ring).not.toBeNull();
    const failing = under(3, () =>
      ["background", "surface"].map((back) => [
        `active edit's ring on ${back}`,
        utilityColour(ring![1]),
        `var(--${back})`,
      ]),
    );
    expect(failing).toEqual([]);
  });

  it("draw the chosen segment's ring at 3:1 at least, against the group and the segment", () => {
    const ring = read("components/segmented-control.tsx").match(
      /ring-1 ring-([\w-]+)/,
    );
    expect(ring).not.toBeNull();
    const failing = under(3, () =>
      ["surface-2", "surface"].map((back) => [
        `chosen segment's ring on ${back}`,
        utilityColour(ring![1]),
        `var(--${back})`,
      ]),
    );
    expect(failing).toEqual([]);
  });

  // The labels are 12 to 16 px: normal text, so 4.5:1, at rest and under the pointer
  it("keep a button's label at 4.5:1, at rest and under the pointer", () => {
    const failing = under(4.5, () => [
      ["label at rest", "var(--accent-foreground)", "var(--accent)"],
      [
        "label under the pointer",
        "var(--accent-foreground)",
        "var(--accent-hover)",
      ],
    ]);
    expect(failing).toEqual([]);
  });

  // A filter changes the label with the fill, and lightening the fill took white labels under 4.5:1
  it("are shaded under the pointer by the fill alone, never by a filter", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return files(full);
        return name.endsWith(".tsx") ? [full] : [];
      });
    const filtered = ["app", "components"]
      .flatMap((dir) => files(path.join(ROOT, dir)))
      .filter((file) => /hover:brightness/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(filtered).toEqual([]);
  });
});
