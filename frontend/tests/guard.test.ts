import { describe, expect, it } from "vitest";
import { guardEdits, MAX_EDITS, whyDrop } from "@/lib/rewrite/guard";

const edit = (original: string, replacement: string) => ({
  original,
  replacement,
  reason: "r",
});

describe("whyDrop", () => {
  it("keeps an ordinary rewording", () => {
    expect(whyDrop(edit("It is crucial to act", "We must act"))).toBeNull();
  });

  it("drops an edit that changes nothing, even in case, spacing or typography", () => {
    expect(whyDrop(edit("Hello  World", "hello world"))).toBe("unchanged");
    expect(whyDrop(edit("L'homme est là", "L\u2019homme est là"))).toBe(
      "unchanged",
    );
    expect(whyDrop(edit('un "mot" ici', "un \u201cmot\u201d ici"))).toBe(
      "unchanged",
    );
  });

  it("drops a replacement far longer than the original", () => {
    const long = "word ".repeat(200);
    expect(whyDrop(edit("short phrase", long))).toBe("too_long");
  });

  it("drops a huge quoted span", () => {
    expect(whyDrop(edit("a".repeat(700), "b"))).toBe("span_too_long");
  });

  it("drops html or markdown that Claude was not asked to write", () => {
    expect(whyDrop(edit("plain", "<b>plain</b>"))).toBe("markup");
    expect(whyDrop(edit("link", "[link](http://x.test)"))).toBe("markup");
    expect(whyDrop(edit("title", "# title"))).toBe("markup");
  });

  it("drops an edit that changes a number", () => {
    expect(
      whyDrop(edit("sales rose 12% in 2019", "sales rose 15% in 2019")),
    ).toBe("numbers_changed");
  });

  it("drops an edit that deletes or adds a number", () => {
    expect(whyDrop(edit("about 40 people", "many people"))).toBe(
      "numbers_changed",
    );
    expect(whyDrop(edit("many people", "about 40 people"))).toBe(
      "numbers_changed",
    );
  });

  it("accepts numbers that only move within the sentence", () => {
    expect(
      whyDrop(edit("In 2019 we sold 40 units", "We sold 40 units in 2019")),
    ).toBeNull();
  });
});

describe("whyDrop: what counts as the same number", () => {
  const changed = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("numbers_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("sees a decimal mark that moves or disappears", () => {
    changed("sales rose 3.5% last year", "sales grew 35% last year");
    changed(
      "une hausse de 2,5 % cette année",
      "une hausse de 25 % cette année",
    );
    changed("it weighs 1.5 kg", "it weighs 15 kg");
  });

  it("sees a change after the decimal mark", () => {
    changed("sales rose 3.5%", "sales rose 3.9%");
    changed("une hausse de 2,5 %", "une hausse de 2,9 %");
    changed("it costs $10.50", "it costs $10.99");
  });

  it("sees an amount that changes size", () => {
    changed("the ticket costs $10.00", "the ticket is $1,000");
    changed("about 1,200 people came", "about 12,000 people came");
  });

  it("sees a lost minus sign", () => {
    changed("it was -5 °C outside", "it was 5 °C outside");
    same("it was \u22125 °C outside", "outside it was -5 °C");
  });

  it("sees a dash used as a minus sign, also ahead of a currency", () => {
    changed("it was \u20135 °C outside", "it was 5 °C outside");
    changed("it was \u20145 °C outside", "it was 5 °C outside");
    same("it was \u20135 °C outside", "outside it was -5 °C");
    changed("a balance of -$5 today", "a balance of $5 today");
    changed("un solde de -€40 ce jour", "un solde de €40 ce jour");
    same("a balance of -$5 today", "a balance of -5 dollars");
  });

  it("reads any kind of dash as a minus sign", () => {
    for (const dash of ["\u2010", "\u2011", "\u2012", "\u2015", "\uff0d"]) {
      changed(`it was ${dash}5 °C outside`, "it was 5 °C outside");
    }
  });

  it("does not read a dash after a word as a sign", () => {
    same("the answer\u20145 people", "the answer: 5 people");
  });

  it("does not read a dash after a unit or a bracket as a sign", () => {
    same("between 5%\u201310% of users", "between 5% and 10% of users");
    same("de 10 €\u201320 € par jour", "de 10 € à 20 € par jour");
    same("from $10-$20 a day", "from $10 to $20 a day");
    same("entre 10°\u201320° ce jour", "entre 10° et 20° ce jour");
    same("an (2019)\u20132021 study", "a (2019) to 2021 study");
  });

  it("reads a leading decimal mark", () => {
    changed("it costs .5 dollars", "it costs 5 dollars");
    changed("cela coûte ,5 euro", "cela coûte 5 euros");
    same("it costs .5 dollars", "it costs 0.5 dollars");
  });

  it("sees the parts of a date or a time trade places", () => {
    changed("signed on 12/03/2024", "signed on 03/12/2024");
    changed("the train leaves at 10:30", "the train leaves at 10:03");
    same("signed on 12/03/2024, in Paris", "in Paris, signed on 12/03/2024");
  });

  it("lets a range be reworded, and sees a percent range reversed", () => {
    same("from 2019-2021 it grew", "from 2019 to 2021 it grew");
    same("pages 5\u20137 of the report", "pages 5 to 7 of the report");
    same("between 10\u201320% of users", "between 10 and 20% of users");
    changed("between 10\u201320% of users", "between 20\u201310% of users");
  });

  it("sees a percent sign that goes away", () => {
    changed("prices rose 12%", "prices rose 12");
    same("les prix ont augmenté de 12 %", "les prix ont pris 12%");
  });

  it("treats thousands separators as the same number, whatever the space", () => {
    same("1\u00a0200 euros", "1 200 euros, en tout");
    same("1\u202f200 euros", "1 200 euros, en tout");
    same("CHF 1'200 in total", "a total of CHF 1 200");
    same("1\u2009200 euros", "1200 euros, en tout");
    same("cost 1,234,567 dollars", "cost 1 234 567 dollars");
    same("cost 1,234.56 dollars", "cost 1.234,56 dollars");
    same("it weighs 1.5 kg", "it weighs 1,5 kg");
  });

  // "1,200" is 1200 in English and 1.2 in French, and the guard does not know the language
  it("takes a lone comma or period before three digits only as written", () => {
    same("about 1,200 people came", "1,200 people came");
    changed("sold 1,200 units", "sold 1.200 units");
    changed("cost 1,200 dollars", "cost 1 200 dollars in total");
    changed("pi is 3.141", "pi is 3141");
  });

  it("reads a last mark that differs from the others as the decimal mark", () => {
    changed("a distance of 1,234.567 km", "a distance of 1,234,567 km");
    changed("a distance of 1.234,567 km", "a distance of 1.234.567 km");
    changed("a distance of 1 234.567 km", "a distance of 1 234 567 km");
    changed("a distance of 1 234,567 km", "a distance of 1 234 567 km");
    same("a distance of 1,234.567 km", "some 1 234,567 km away");
    same("a total of 1,234,567.89", "a total of 1.234.567,89");
  });

  it("takes any other mix of marks only as written", () => {
    changed("a figure of 1,234 567 here", "a figure of 1234567 here");
    same("a figure of 1,234 567 here", "here, a figure of 1,234 567");
  });

  it("does not read a minus sign inside a name", () => {
    same("cases of COVID-19 rose", "Covid-19 cases went up");
  });
});

// The guard compares figures, nothing else. These edits change the meaning and still pass:
// they are why every edit is shown to the user, who accepts or rejects it.
describe("whyDrop: a minus ahead of any currency symbol", () => {
  it.each(["$", "€", "£", "¥", "₹", "₽", "₩", "₿"])("%s", (symbol) => {
    expect(
      whyDrop(edit(`a change of -${symbol}5`, `a change of ${symbol}5`)),
    ).toBe("numbers_changed");
    expect(
      whyDrop(edit(`a cost of ${symbol}5`, `it costs ${symbol}5`)),
    ).toBeNull();
    expect(
      whyDrop(edit(`a fall of -${symbol} 5`, `it fell by -${symbol}5`)),
    ).toBeNull();
  });
});

describe("whyDrop: what it cannot see", () => {
  const kept = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("misses a negation", () => {
    kept("the drug is safe for children", "the drug is not safe for children");
  });

  it("misses a reversed direction", () => {
    kept("sales rose 12% in 2019", "sales fell 12% in 2019");
  });

  it("misses a change of scope", () => {
    kept("some of the 40 tests failed", "all of the 40 tests failed");
  });

  it("misses a change of scale written in words", () => {
    kept("a budget of 3 million", "a budget of 3 billion");
  });

  it("misses a range reversed without a percent sign", () => {
    kept("from 10\u201320 people", "from 20\u201310 people");
  });

  it("misses a date whose parts move when written with hyphens", () => {
    kept("due on 2024-03-12", "due on 2024-12-03");
  });

  it("misses numbers written in words", () => {
    kept("twelve people came", "eleven people came");
  });

  it("misses a sign written in words or in brackets", () => {
    kept("a change of minus 5", "a change of 5");
    kept("a loss of (500)", "a loss of 500");
  });

  it("misses figures that trade places", () => {
    kept("A rose 12% and B rose 40%", "A rose 40% and B rose 12%");
    kept("born in 1950, died in 1990", "born in 1990, died in 1950");
  });

  it("misses figures that are not plain digits", () => {
    kept("a share of ½ here", "a share of ¼ here");
    kept("about 10² cases", "about 10³ cases");
    kept("au XIXe siècle", "au XVIIIe siècle");
    kept("a price of ５ here", "a price of ６ here");
  });

  it("misses a change of unit or currency", () => {
    kept("a 5 km walk", "a 5 mile walk");
    kept("it costs $40", "it costs €40");
  });

  it("misses a minus ahead of a currency written in letters", () => {
    kept("a change of -CHF 5", "a change of CHF 5");
  });

  it("misses signs and comparisons that are not a minus", () => {
    kept("a fall of ±5 points", "a fall of 5 points");
    kept("<5% of users", ">5% of users");
    kept("T-5 minutes", "T+5 minutes");
  });
});

describe("guardEdits", () => {
  it("splits kept edits from dropped ones and counts the reasons", () => {
    const { kept, dropped } = guardEdits([
      edit("a b", "c d"),
      edit("same", "same"),
      edit("x 1", "x 2"),
      edit("y 3", "y 4"),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual({ unchanged: 1, numbers_changed: 2 });
  });

  it("caps the number of edits", () => {
    // Letters only, so no edit is dropped for its numbers
    const word = (i: number) =>
      String.fromCharCode(97 + (i % 26)).repeat(3 + Math.floor(i / 26));
    const many = Array.from({ length: MAX_EDITS + 5 }, (_, i) =>
      edit(`old ${word(i)}`, `new ${word(i)}`),
    );
    const { kept, dropped } = guardEdits(many);
    expect(kept).toHaveLength(MAX_EDITS);
    expect(dropped.too_many).toBe(5);
  });
});
