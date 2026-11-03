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

  it("counts elided French words, with either apostrophe", () => {
    const straight = "L'homme n'a pas d'amis qu'il aime, c'est l'été.";
    expect(guessLanguage(straight)).toBe("fr");
    expect(guessLanguage(straight.replaceAll("'", "\u2019"))).toBe("fr");
  });

  it("needs nothing but elided words, with either apostrophe", () => {
    const elided =
      "L'homme d'Orléans n'aime qu'Anne, c'était l'été, j'imagine, m'a dit Luc.";
    expect(guessLanguage(elided)).toBe("fr");
    expect(guessLanguage(elided.replaceAll("'", "\u2019"))).toBe("fr");
  });

  it("does not take English contractions and names for French", () => {
    expect(
      guessLanguage(
        "It's the book that John's father and O'Brien's sister don't have, and they were at the U.S. office.",
      ),
    ).toBe("en");
  });

  it("does not take names with an apostrophe for French", () => {
    expect(
      guessLanguage(
        "L'Oréal shares fell after D'Amico's note on L'Occitane's sales.",
      ),
    ).toBeNull();
    expect(
      guessLanguage(
        "L'Oréal and L'Occitane hired D'Souza and N'Golo last year.",
      ),
    ).toBeNull();
    expect(
      guessLanguage(
        "Our CEO, N'Golo D'Souza, met Le Monde's editor at the Louvre.",
      ),
    ).toBe("en");
  });

  it("does read a capital before the apostrophe as French", () => {
    expect(
      guessLanguage(
        "L'homme d'Orléans dit qu'il pense. Qu'il vienne, D'abord, N'oublie, C'est.",
      ),
    ).toBe("fr");
  });

  it("does not take short plain English for French", () => {
    for (const text of [
      "The dog sat on a mat near a big red barn.",
      "I went on a trip on a boat on a lake last June.",
      "Our team built a tool on a tight budget in a week.",
      "My son plays golf on Sunday, plus he runs a little.",
      "Please pour me a coffee, plus a glass of water.",
      "My son, your son and her son all play golf.",
    ]) {
      expect(guessLanguage(text)).not.toBe("fr");
    }
  });

  it("still recognizes French that leans on those same words", () => {
    expect(
      guessLanguage("On a vu que le projet a pris du retard dans la région."),
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
