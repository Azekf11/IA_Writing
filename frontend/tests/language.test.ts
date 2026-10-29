import { describe, expect, it } from "vitest";
import { guessLanguage } from "@/lib/style/language";

describe("guessLanguage", () => {
  it("recognizes English", () => {
    expect(
      guessLanguage(
        "It was the best of times, and it was the worst of times for all of them.",
      ),
    ).toBe("en");
  });

  it("recognizes French, including elided articles", () => {
    expect(
      guessLanguage(
        "L'homme est un animal qui pense, et il n'a pas toujours raison dans ce monde.",
      ),
    ).toBe("fr");
  });

  it("gives up on short text", () => {
    expect(guessLanguage("Bonjour")).toBeNull();
    expect(guessLanguage("")).toBeNull();
  });

  it("gives up on text with no function words", () => {
    expect(
      guessLanguage("Zork blat quux frim snaf dloop vrik tamp glorp"),
    ).toBeNull();
  });

  it("gives up when both languages are equally likely", () => {
    expect(guessLanguage("the le of de and et to à in dans is est")).toBeNull();
  });
});
