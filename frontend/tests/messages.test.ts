import { describe, expect, it } from "vitest";
import { KNOWN_ERROR_CODES } from "@/lib/rewrite/client";
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

  it("uses the same placeholders in both languages", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]).sort();
    const french = new Map(entries(fr));
    for (const [key, value] of entries(en)) {
      expect(placeholders(french.get(key) ?? ""), key).toEqual(
        placeholders(value),
      );
    }
  });

  it("has a message for every error code, in both languages", () => {
    for (const code of KNOWN_ERROR_CODES) {
      for (const messages of [en, fr]) {
        expect(messages.Errors[code], code).toBeTruthy();
      }
    }
  });

  // The excerpts leave the server for Anthropic: the text must never say otherwise again
  it("says where the style excerpts and the writing sample go", () => {
    expect(en.Home.sourcesBody).toContain("sent to Anthropic");
    expect(fr.Home.sourcesBody).toContain("envoy\u00e9s \u00e0 Anthropic");
    expect(en.Privacy.ai).toMatch(/writing sample.*excerpts/);
    expect(fr.Privacy.ai).toMatch(
      /extrait d'\u00e9criture.*extraits du corpus/,
    );
  });
});
