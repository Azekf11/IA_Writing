import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

// Flatten nested messages into dotted keys, e.g. "Home.title"
function entries(obj: object, prefix = ""): [string, string][] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? entries(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)] as [string, string]],
  );
}

describe("messages", () => {
  it("has the same keys in en and fr", () => {
    const keys = (m: object) =>
      entries(m)
        .map(([key]) => key)
        .sort();
    expect(keys(fr)).toEqual(keys(en));
  });

  it("has no empty translation", () => {
    for (const messages of [en, fr]) {
      const empty = entries(messages).filter(([, value]) => !value.trim());
      expect(empty).toEqual([]);
    }
  });
});
