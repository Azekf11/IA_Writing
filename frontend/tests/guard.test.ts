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

  it("allows a replacement up to 200 characters, or three times the quote", () => {
    expect(whyDrop(edit("short phrase", "b".repeat(200)))).toBeNull();
    expect(whyDrop(edit("short phrase", "b".repeat(201)))).toBe("too_long");
    const quote = "a".repeat(100);
    expect(whyDrop(edit(quote, "b".repeat(300)))).toBeNull();
    expect(whyDrop(edit(quote, "b".repeat(301)))).toBe("too_long");
  });

  it("drops a huge quoted span", () => {
    expect(whyDrop(edit("a".repeat(700), "b"))).toBe("span_too_long");
    expect(whyDrop(edit("a".repeat(601), "b"))).toBe("span_too_long");
    expect(whyDrop(edit("a".repeat(600), "b"))).toBeNull();
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
    changed("due on 2024-03-12", "due on 2024-12-03");
    changed("signé le 12-03-2024", "signé le 03-12-2024");
    same("signed on 12/03/2024, in Paris", "in Paris, signed on 12/03/2024");
    same("due on 2024-03-12, in Paris", "in Paris, due on 2024-03-12");
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

  it("reads a percentage in words as the sign", () => {
    same("prices rose 12 percent", "prices rose 12%");
    same("prices rose 12 per cent", "prices rose 12 %");
    same("une hausse de 12 pour cent", "une hausse de 12 %");
    same("une hausse de 12 pourcent", "une hausse de 12 pour cent");
    changed("prices rose 12 percent", "prices rose 12");
    changed("prices rose 12 percent", "prices rose 12 dollars");
    changed("une hausse de 12 pour cent", "une hausse de 12 euros");
    same("5 per centimetre of cable", "5 for each centimetre of cable");
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

describe("whyDrop: a percent written in words", () => {
  const changed = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("numbers_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it.each([
    ["12 PERCENT of users", "12% of users"],
    ["a 12-percent rise", "a 12% rise"],
    ["a 12-per-cent rise", "a 12% rise"],
    ["up 12 pct", "up 12%"],
    ["12 pourcents", "12 %"],
  ])("%s reads as %s", same);

  it.each([
    ["12 PERCENT of users", "12 of users"],
    ["up 12 pct", "up 12"],
    ["12 pourcents", "12"],
    ["a 12-percent rise", "a 12 rise"],
  ])("%s is not %s", changed);
});

describe("whyDrop: figures in their other forms", () => {
  const changed = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("numbers_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("a time, a date, a per mille and a mix of marks", () => {
    changed("the train leaves at 10:12", "the train leaves at 12:10");
    changed("at 10:30", "at 1030");
    changed("the 12/03 batch", "the 1203 batch");
    changed("up 5 \u2030", "up 5");
    changed("a figure of 1,234 567 here", "a figure of 1.234 567 here");
    changed("a figure of 1,234 567.890", "a figure of 1.234 567,890");
    changed("a total of 1 234,567.89", "a total of 1 234,567.12");
    changed("a rate of 1,2345", "a rate of 1,234 5");
  });

  it.each([
    ["from 5\u2030-10\u2030 here", "from 5\u2030 to 10\u2030 here"],
    ["from 5'-10' long", "from 5' to 10' long"],
    ["from 5\u2019-10\u2019 long", "from 5\u2019 to 10\u2019 long"],
    ['from 5"-10" long', 'from 5" to 10" long'],
    ["an [2019]\u20132021 study", "a [2019] to 2021 study"],
    ["prices rose 3.5 percent", "prices rose 3.5%"],
    ["a balance of -$1,200", "a balance of -1,200 dollars"],
  ])("%s reads as %s", same);
});

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

describe("whyDrop: a figure keeps its unit", () => {
  const changed = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("units_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("sees another currency, in symbols, codes or words", () => {
    changed("it costs $40", "it costs €40");
    changed("it costs $40", "it costs 40 euros");
    changed("ça coûte 40 €", "ça coûte 40 dollars");
    changed("a price of USD 40", "a price of EUR 40");
    changed("a change of -$5", "a change of -€5");
    changed("une dette de 40 euros", "une dette de 40 £");
    changed("a price of ₹5", "a price of ₩5");
    changed("a change of -CHF 5", "a change of -EUR 5");
    changed("a price of 40 CNY", "a price of 40 GBP");
    changed("a price of INR 40", "a price of USD 40");
    changed("a price of 40 SEK", "a price of 40 NOK");
    changed("it costs 40 yuan", "it costs 40 euros");
    changed("it costs 40 rupees", "it costs 40 dollars");
    changed("ça coûte 40 roupies", "ça coûte 40 euros");
    changed("ça coûte 40 roubles", "ça coûte 40 euros");
    changed("a salary of 500 euros/mois", "a salary of 500 dollars/mois");
  });

  it("reads a symbol with letters glued to it, and a possessive", () => {
    changed("un prix de 5 $US", "un prix de 5 €");
    changed("5 milliards de $US", "5 milliards d'euros");
    changed("un prix de 5 $CA", "un prix de 5 €");
    changed("40 €HT par mois", "40 $HT par mois");
    changed("40€TTC par mois", "40 $ par mois");
    changed("30 days' notice", "30 weeks' notice");
    changed("5 years' experience", "5 months' experience");
    changed("5 dollars' worth", "5 euros' worth");
    changed("$3 million's worth", "$3 billion's worth");
  });

  it("reads the same currency however it is written", () => {
    same("it costs $40", "the price is 40 dollars");
    same("it costs 40 €", "the price is 40 euros");
    same("a price of EUR 40", "a price of €40");
    same("un prix de 40 euros", "ça vaut 40€");
    same("a $3 million budget", "a budget of 3 million dollars");
    same("3 millions d'euros", "3 millions €");
    same("5 milliards de dollars", "$5 milliards");
    same("a price of ₹40", "a price of 40 rupees");
    same("un prix de ₽40", "un prix de 40 roubles");
  });

  it("sees another unit, in either language", () => {
    changed("a 5 km walk", "a 5 mile walk");
    changed("a 5-km walk", "a walk of 5 miles");
    changed("une marche de 5 km", "une marche de 5 miles");
    changed("it weighs 5 kg", "it weighs 5 g");
    changed("il pèse 5 kilos", "il pèse 5 tonnes");
    changed("it uses 3 kWh", "it uses 3 MWh");
    changed("a fever of 39 °C", "a fever of 39 °F");
    changed("after 5 hours", "after 5 minutes");
    changed("en 5 jours", "en 5 semaines");
    changed("en 12 mois", "en 12 ans");
    changed("un fichier de 5 Go", "un fichier de 5 To");
    changed("un fichier de 5 Mo", "un fichier de 5 Go");
    changed("un fichier de 5 Ko", "un fichier de 5 Mo");
    changed("un fichier de 5 gigaoctets", "un fichier de 5 téraoctets");
    changed("a 5 gigabyte file", "a 5 terabyte file");
    changed("une puissance de 58 mégawatts", "une puissance de 58 gigawatts");
    changed("a 5 kilowatt panel", "a 5 megawatt panel");
    changed("a capacity of 480 MW", "a capacity of 480 gigawatts");
    changed("il consomme 3 kilowattheures", "il consomme 3 mégawattheures");
    changed("it uses 3 kilowatt-hours", "it uses 3 megawatt-hours");
    changed("39 degrés Celsius", "39 degrés Fahrenheit");
    changed("39 degrees Celsius", "39 °F");
    changed("un mur de 5 mètres", "un mur de 5 pieds");
    changed("un écran de 5 centimètres", "un écran de 5 pouces");
    changed("une marche de 5 kilomètres", "une marche de 5 milles");
    changed("a walk of 5 km", "a walk of 5 yards");
    changed("un sachet de 5 grammes", "un sachet de 5 onces");
    changed("une cuve de 5 litres", "une cuve de 5 hectolitres");
    changed("a tank of 5 litres", "a tank of 5 gallons");
    changed("un champ de 5 hectares", "un champ de 5 ares");
    changed("after 5 years", "after 5 decades");
    changed("en 5 ans", "en 5 siècles");
  });

  it("tells a speed or an area from a distance, and a weight from a currency", () => {
    changed("at 50 km/h", "at 50 km");
    changed("at 50 km/h", "at 50 km/s");
    changed("at 50 km/h", "at 50 mph");
    changed("an area of 5 km²", "an area of 5 km");
    changed("an area of 5 km²", "an area of 5 hectares");
    changed("an area of 5 m²", "an area of 5 m³");
    changed("A 5 lb bag", "A £5 bag");
    // A pound said in words reads as the currency, so it costs this suggestion
    changed("A 5 lb bag", "A 5 pounds bag");
  });

  it("reads the same unit however it is written", () => {
    same("a 5 km walk", "a 5-kilometre walk");
    same("une marche de 5 km", "une marche de 5 kilomètres");
    same("it weighs 5 kg", "it weighs 5 kilos");
    same("in 5 min", "in 5 minutes");
    same("en 3 ans", "en 3 années");
    same("it was 39 °C", "it was 39°C");
    same("about 5 miles or 8 km", "8 km, or about 5 miles");
    same("un fichier de 5 Go", "un fichier de 5 gigaoctets");
    same("a 5 GB file", "a 5 gigabyte file");
    same("it uses 3 kWh", "it uses 3 kilowatt-hours");
    same("il consomme 3 kWh", "il consomme 3 kilowattheures");
    same("il consomme 3 kWh", "il consomme 3 kilowatt-heures");
    same("une puissance de 58 MW", "une puissance de 58 mégawatts");
    same("39 degrés Celsius", "39 °C");
    same("at 50 km/h", "at 50 kph");
  });

  it("sees a change of scale in words, and a scale that comes or goes", () => {
    changed("a budget of 3 million", "a budget of 3 billion");
    changed("un budget de 3 millions", "un budget de 3 milliards");
    changed("a $3 million budget", "a $3 billion budget");
    changed("a budget of 3 million", "a budget of 3");
    changed("a budget of $3", "a budget of $3 million");
    changed("3 milliards d'euros", "3 milliards de dollars");
  });

  it("reads a bare M as a million only next to a currency", () => {
    changed("a budget of 3 M€", "a budget of 3 G€");
    changed("un budget de 3 M€", "un budget de 3 M$");
    changed("a budget of $3M", "a budget of $3 billion");
    same("un budget de 3 M€", "un budget de 3 millions d'euros");
    same("a budget of $3M", "a budget of $3 million");
    same("a 5 M wall", "a wall of 5 M");
  });

  it("lets a unit go, since it can sit further away", () => {
    same("a 5 km walk", "a walk of 5, in kilometres");
    same("it costs $40", "the bill: 40, in dollars");
  });

  it("does not read what only looks like a unit", () => {
    same("En 2019 l'année fut bonne", "L'année fut bonne en 2019");
    same("$5 an hour", "$5 per hour");
    same("from 10 to 20 km", "10 to 20 km away");
    same("the 5 people here", "the 5 here");
    same("from 5 to 10", "5 to 10");
    same(
      "In 2019 hundreds of stores closed",
      "Hundreds of stores closed in 2019",
    );
    same("In 2020 millions", "In 2020, millions");
    same("By 2030 billions", "By 2030, billions");
  });
});

describe("whyDrop: every scale and unit is read", () => {
  const changed = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("units_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it.each(
    "hundred k thousand mille milliers million millions bn billion billions md mds mrd mrds milliard milliards trillion trillions".split(
      " ",
    ),
  )("%s is a scale", (word) => {
    changed(`a budget of 3 ${word}`, "a budget of 3");
  });

  it.each(
    "usd dollar dollars eur euro euros gbp pound pounds sterling jpy yen yens chf franc francs cny rmb yuan yuans inr rupee rupees roupie roupies rub rouble roubles ruble rubles krw cad aud sek nok dkk brl mxn hkd sgd nzd zar pln cent cents centime centimes mm millimetre millimetres millimeter millimeters millim\u00e8tre millim\u00e8tres cm centimetre centimetres centimeter centimeters centim\u00e8tre centim\u00e8tres metre metres meter meters m\u00e8tre m\u00e8tres km kilometre kilometres kilometer kilometers kilom\u00e8tre kilom\u00e8tres mile miles milles yard yards ft foot feet pied pieds inch inches pouce pouces m\u00b2 km\u00b2 m\u00b3 ha hectare hectares ares acre acres mg milligram milligrams milligramme milligrammes g gram grams gramme grammes kg kgs kilo kilos kilogram kilograms kilogramme kilogrammes tonne tonnes ton tons oz ounce ounces onces lb lbs ml millilitre millilitres milliliter milliliters cl centilitre centilitres l litre litres liter liters hl hectolitre hectolitres gal gallon gallons sec secs second seconds seconde secondes min mins mn minute minutes h hr hrs hour hours heure heures day days jour jours journ\u00e9e journ\u00e9es week weeks semaine semaines month months mois yr yrs year years ans ann\u00e9e ann\u00e9es decade decades d\u00e9cennie d\u00e9cennies century centuries si\u00e8cle si\u00e8cles \u00b0c celsius \u00b0f fahrenheit wh watthour watthours wattheure wattheures kwh kilowatthour kilowatthours kilowattheure kilowattheures mwh megawatthour megawatthours m\u00e9gawattheure m\u00e9gawattheures gwh gigawatthour gigawatthours gigawattheure gigawattheures watt watts kw kilowatt kilowatts mw megawatt megawatts m\u00e9gawatt m\u00e9gawatts gw gigawatt gigawatts mph km/h kmh kph km/s m/s kb kilobyte kilobytes kilooctet kilooctets mb megabyte megabytes m\u00e9gaoctet m\u00e9gaoctets gb gigabyte gigabytes gigaoctet gigaoctets tb terabyte terabytes t\u00e9raoctet t\u00e9raoctets".split(
      " ",
    ),
  )("%s is a unit", (word) => {
    changed(
      `a total of 5 ${word}`,
      `a total of 5 ${/^(kwh|kilowatt)/.test(word) ? "km" : "kWh"}`,
    );
  });

  it.each([
    ["$", "dollars"],
    ["\u20ac", "euros"],
    ["\u00a3", "pounds"],
    ["\u00a5", "yen"],
    ["\u20b9", "rupees"],
    ["\u20bd", "roubles"],
    ["\u20a9", "krw"],
  ])("%s is %s", (symbol, word) => {
    same(`a price of 40 ${symbol}`, `a price of 40 ${word}`);
  });

  it("reads what stands next to a figure", () => {
    changed("at 50 km", "at 50 km/s");
    changed("5 km and 5 km", "5 km and 5 miles");
    changed("a budget of $2000 million", "a budget of $2000 billion");
    changed("a price of 5 \u20aa", "a price of 5 \u20ab");
    changed("3 million of dollars", "3 million of euros");
    changed("3 milliards d\u2019euros", "3 milliards de dollars");
    changed("after 30 days'", "after 30 weeks'");
    changed("it uses 3 kilowatt hours", "it uses 3 megawatt hours");
    changed("it uses 3 kilowatts", "it uses 3 kilowatt hours");
  });

  it("takes a figure for a year only after a date word", () => {
    changed(
      "une dette de 2000 milliards d'euros",
      "une dette de 2000 millions d'euros",
    );
    changed("une dette de 2000 milliards", "une dette de 2000");
    changed(
      "une dette de 2000 milliards d'euros",
      "une dette de 2000 milliards de dollars",
    );
    changed("un budget de 1800 k\u20ac", "un budget de 1800 M\u20ac");
    changed("un budget de 2000 Md\u20ac", "un budget de 2000 \u20ac");
    changed("un budget de 1800 k\u20ac", "un budget de 1800 k$");
    same("In 1990 millions", "In 1990, millions");
    same("En 2020 millions de personnes", "En 2020, des millions de personnes");
    same("Depuis 2019 millions", "Depuis 2019, millions");
  });

  it("reads a letter stuck to money as its scale", () => {
    changed("a $5B deal", "a $5 deal");
    changed("a $5B deal", "a $5M deal");
    changed("3 G$ de dette", "3 G\u20ac de dette");
    changed("3 T$ de dette", "3 G$ de dette");
    changed("5 US$ here", "5 \u20ac here");
    same("3 G$", "3 milliards de dollars");
    same("$5 million", "$5mn");
    same("5 M\u20ac", "5 millions d'euros");
    same("5 M \u20ac", "5 millions d'euros");
    changed("5 M \u20ac", "5 M $");
    same("a walk of 5 g", "a walk of 5 grams");
  });

  it("keeps the period of a rate", () => {
    changed("a fee of 500 \u20ac/mois", "a fee of 500 \u20ac/an");
    changed("a fee of 5 euros/mois", "a fee of 5 euros/an");
    changed("a fee of 40 \u20ac par mois", "a fee of 40 \u20ac par an");
    changed("$5/month", "$5/year");
    changed("$40 per hour", "$40 per day");
    changed("$40 an hour", "$40 a day");
    changed("$3 million per year", "$3 million per month");
    changed("5 a day", "5 a week");
    same("500 \u20ac/mois", "500 \u20ac par mois");
    same("500 euros/mois", "500 euros");
    same("10 $/h", "10 $/heure");
    same("$40 per hour", "$40 an hour");
    same("$40 a month", "$40 monthly");
    same("120 km/h now", "120 km/h today");
    same("5 and/or 6", "5 or 6");
    same("$40 a person", "$40 a head");
  });

  it("tells units apart by their case where the case decides", () => {
    changed("a draw of 5 mW", "a draw of 5 megawatts");
    changed("a link of 100 Mb", "a link of 100 megabytes");
    changed("a link of 100 Gb", "a link of 100 gigabytes");
    changed("a link of 1 Mb/s", "a link of 1 MB/s now");
    same("a draw of 5 mW", "a draw of 5 milliwatts");
    same("un débit de 8 Mo/s", "un débit de 8 MB/s");
  });

  it("does not read a scale across a dash or a paragraph", () => {
    same(
      "The plant employs 400 \u2014 thousands more depend on it.",
      "The plant employs 400. Thousands more depend on it.",
    );
    same(
      "Part 2\n\nMillions lost their jobs.",
      "Part 2\n\nIn all, millions lost their jobs.",
    );
    same("In week 12 thousands marched", "Thousands marched in week 12");
    changed("a 5-km walk", "a 5-mile walk");
    changed("3\nmillion", "3");
  });

  it("lets one scale cover two figures", () => {
    same(
      "dont 6,4 millions pour les \u00e9coles et 5,1 millions pour la voirie",
      "dont 6,4 et 5,1 millions pour les \u00e9coles et la voirie",
    );
    same(
      "between 3 and 5 million people",
      "between 3 million and 5 million people",
    );
    same("$3-5 million", "$3 million to $5 million");
    same("1 and 2 and 3 million", "1 million and 2 million and 3 million");
    same(
      "entre 3 et 5 millions de personnes",
      "entre 3 millions et 5 millions de personnes",
    );
    changed("between 3 and 5 million", "between 3 and 5");
    changed("between 3 and 5 million", "between 3 thousand and 5 million");
  });
});

describe("whyDrop: a figure stays with its name", () => {
  const swapped = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("figures_swapped");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("sees figures that trade names, in either language", () => {
    swapped(
      "Apple rose 12% and Google rose 40%",
      "Apple rose 40% and Google rose 12%",
    );
    swapped(
      "L'Allemagne a progressé de 12 % et la France de 40 %",
      "L'Allemagne a progressé de 40 % et la France de 12 %",
    );
    swapped(
      "12% for Apple and 40% for Google",
      "40% for Apple and 12% for Google",
    );
    swapped(
      "New York grew 5% in 2019 and Los Angeles 3% in 2020",
      "New York grew 3% in 2019 and Los Angeles 5% in 2020",
    );
  });

  it("sees a scale or a unit that trades names", () => {
    swapped(
      "Apple paid $3 million and Google $3 billion",
      "Apple paid $3 billion and Google $3 million",
    );
    swapped(
      "Alpha a levé 3 millions d'euros et Beta 3 milliards d'euros",
      "Alpha a levé 3 milliards d'euros et Beta 3 millions d'euros",
    );
    swapped("Alpha a 50 k€ et Beta 50 Md€", "Alpha a 50 Md€ et Beta 50 k€");
    swapped(
      "Acme paid $40 and Zenith paid €40",
      "Acme paid €40 and Zenith paid $40",
    );
    swapped(
      "Acme ran 5 km and Zenith ran 5 miles",
      "Acme ran 5 miles and Zenith ran 5 km",
    );
    same(
      "Acme paid $40 and Zenith paid €40",
      "Zenith paid €40 and Acme paid $40",
    );
    same(
      "Acme paid $40 and Zenith paid €50",
      "Acme paid 40 and Zenith paid 50",
    );
  });

  it("lets the sentence change around them", () => {
    same(
      "Apple rose 12% and Google rose 40%",
      "Google rose 40% and Apple rose 12%",
    );
    same(
      "Apple rose 12% and Google rose 40%",
      "Apple gained 12%, while Google gained 40%",
    );
    same(
      "12% for Apple and 40% for Google",
      "40% for Google and 12% for Apple",
    );
    same(
      "La France a progressé de 12 %, l'Allemagne de 40 %",
      "L'Allemagne a progressé de 40 %, et la France de 12 %",
    );
  });

  it("gives no verdict when the order leaves a doubt", () => {
    same(
      "Apple and Google rose 12% and 40%",
      "Apple and Google rose 40% and 12%",
    );
    same(
      "Apple hired 40 people, 12% more than Google",
      "Google hired 12% fewer than Apple's 40",
    );
    same(
      "Prices rose 12% in Paris and 40% in Lyon",
      "In Paris, prices rose 12%, and in Lyon 40%",
    );
    same(
      "In Q1 sales rose 12%, in Q2 40%",
      "Sales rose 12% in Q1 and 40% in Q2",
    );
    same(
      "Apple rose 12% and Google rose 40% in 2019",
      "Google rose 40% and Apple rose 12% in 2019",
    );
    same(
      "La France a progressé de 12 % et l'Allemagne de 40 % en 2019",
      "L'Allemagne a progressé de 40 % et la France de 12 % en 2019",
    );
    same(
      "Apple sold 12 cars and Google 40, for a total of 52",
      "Google sold 40 cars and Apple 12, for a total of 52",
    );
  });

  it("does not take the digits of a name for a figure", () => {
    same("COVID-19 fell 5% and Ebola 3%", "Ebola fell 3% and COVID-19 5%");
  });
});

describe("whyDrop: what counts as a name", () => {
  const swapped = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("figures_swapped");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it.each(
    "The An In On At By For From Of To And But Or It Its This That These Those As Le La Les Un Une Des Du De En Au Aux Dans Et Mais Ou Pour Par Sur Ce Cette Ces".split(
      " ",
    ),
  )("%s names nothing", (word) => {
    swapped(
      `${word} Acme rose 12% and Zenith rose 40%`,
      "Acme rose 40% and Zenith rose 12%",
    );
  });

  it.each(
    "Moreover Furthermore However Additionally Meanwhile Also Yet Still Thus Hence Then So Ultimately Overall Finally Nevertheless Nonetheless Cependant Toutefois N\u00e9anmoins Ainsi Alors Puis Enfin Donc".split(
      " ",
    ),
  )("%s opens a sentence and names nothing", (word) => {
    swapped(
      `${word}, Apple rose 12% and Google rose 40%`,
      `${word}, Apple rose 40% and Google rose 12%`,
    );
    swapped(
      `${word} Apple rose 12% and Google rose 40%`,
      "Apple rose 40% and Google rose 12%",
    );
  });

  it("reads short names, codes and hyphens, and no unit as a name", () => {
    swapped(
      "Moreover, Apple rose 12% and Google rose 40%",
      "Apple rose 40% and Google rose 12%",
    );
    swapped("HP rose 12% and GE rose 40%", "HP rose 40% and GE rose 12%");
    swapped("COVID-19 fell 5% and Ebola 3%", "COVID-19 fell 3% and Ebola 5%");
    swapped("A320 fell 5% and B737 3%", "A320 fell 3% and B737 5%");
    swapped(
      "Saint-Orens rose 12% and Marvejac rose 40%",
      "Saint-Orens rose 40% and Marvejac rose 12%",
    );
    swapped("Acme has 5 GB and Zenith 9 GB", "Acme has 9 GB and Zenith 5 GB");
    swapped(
      "Alpha a 50 k\u20ac et Beta 50 Md\u20ac",
      "Alpha a 50 Md\u20ac et Beta 50 k\u20ac",
    );
  });

  it("reads a name that is also a unit, away from any figure", () => {
    swapped(
      "Sterling paid $40 and Ford paid $50",
      "Sterling paid $50 and Ford paid $40",
    );
    swapped(
      "Pound rose 12% and Zenith rose 40%",
      "Pound rose 40% and Zenith rose 12%",
    );
  });

  it.each([
    [
      "In 2019 Apple rose 12% and Google rose 40%",
      "In 2019 Google rose 40% and Apple rose 12%",
    ],
    ["Apple flew T5 and Google flew T6", "Apple took t5 and Google took t6"],
    ["Apple rose 12% and Google rose 40%", "Apple and Google rose 12% and 40%"],
    ["Apple and Google rose 12% and 40%", "Apple rose 12% and Google rose 40%"],
    [
      "Acme paid $40 and \u20ac40, Zenith paid 5 and 6",
      "Acme paid \u20ac40 and $40, Zenith paid 5 and 6",
    ],
    ["Acme rose 6 at T5", "Acme rose 6 near t5"],
    [
      "Apple rose 12 at T5 and Google rose 40 at T6",
      "Apple rose 12 at terminal 5 and Google rose 40 at terminal 6",
    ],
  ])("%s gets no verdict", same);
});

describe("whyDrop: a denial stays", () => {
  const flipped = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBe("negation_changed");
  const same = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("sees a denial added or removed, in either language", () => {
    flipped(
      "the drug is safe for children",
      "the drug is not safe for children",
    );
    flipped(
      "the drug is not safe for children",
      "the drug is safe for children",
    );
    flipped("the test didn\u2019t pass", "the test passed");
    flipped("it never worked", "it worked");
    flipped("without consent", "with consent");
    flipped("no refund was paid", "a refund was paid");
    flipped("le médicament est sûr", "le médicament n'est pas sûr");
    flipped("le médicament n\u2019est pas sûr", "le médicament est sûr");
    flipped("il ne viendra jamais", "il viendra");
    flipped("il n'y a aucun risque", "il y a un risque");
    flipped("sans risque", "avec risque");
    flipped("le service ne fonctionne plus", "le service fonctionne");
    flipped("personne n'a signé", "tout le monde a signé");
    flipped("did not fail", "failed");
    flipped("is not impossible", "is impossible");
    flipped(
      "le groupe a décidé de ne plus financer ce projet",
      "le groupe a décidé de financer ce projet",
    );
    flipped("de ne point signer", "de signer");
    flipped("nul n'a signé", "tous ont signé");
    flipped("Nul ne sait pourquoi", "Tout le monde sait pourquoi");
    flipped("il ne s'agit nullement d'une erreur", "il s'agit d'une erreur");
    flipped("il n'est aucunement responsable", "il est responsable");
    flipped("No. 5 tests", "Yes. 5 tests");
  });

  it("refuses a denial reworded without one, which costs a suggestion", () => {
    flipped(
      "yet reading scores did not change",
      "yet reading scores stayed flat",
    );
  });

  it("sees a set phrase that loses only its negative word", () => {
    flipped("no more than 40 people", "more than 40 people");
    flipped("more than 40 people", "no more than 40 people");
    flipped("no later than June", "later than June");
    flipped("No less than 5%", "Less than 5%");
    flipped("cannot be ignored", "can be ignored");
    flipped("no small risk", "a small risk");
    flipped("there is no doubt", "there is doubt");
    flipped("Not surprisingly, sales fell", "Surprisingly, sales fell");
    flipped("un rôle non négligeable", "un rôle négligeable");
    flipped("Il n'y a aucun doute", "Il y a un doute");
    flipped("Il n'y a pas de doute", "Il y a un doute");
    flipped("Pas moins de 40 personnes", "Moins de 40 personnes");
    flipped("n'a jamais été aussi fort", "a été aussi fort");
    same("no more than 40 people", "at most 40 people");
    same(
      "Pas moins de 40 personnes sont venues",
      "Au moins 40 personnes sont venues",
    );
  });

  it("sees a denial in words that only look like a set phrase", () => {
    flipped("Il ne se souvient de rien", "Il se souvient");
    flipped("n'est coupable de rien", "est coupable");
    flipped("Il est parti sans dire un mot", "Il est parti en disant un mot");
    flipped("Il est resté assis sans parler", "Il est resté assis à parler");
    flipped(
      "Elle jure que jamais elle ne signera",
      "Elle jure qu'elle signera",
    );
    flipped(
      "Il ne veut rien que je puisse donner",
      "Il veut que je puisse donner",
    );
  });

  it("does not take a plain denial for a staged contrast", () => {
    flipped("Cette décision n'est pas juste", "Cette décision est juste");
    flipped("Le calcul n'est pas juste", "Le calcul est juste");
    flipped("n'est pas juste pour tous", "est juste pour tous");
    flipped("You can't just delete the data", "You can delete the data");
    flipped("is not only safe", "is only safe");
    flipped("n'est pas seulement riche", "est seulement riche");
  });

  it("holds a sentence that denies when another follows it", () => {
    flipped(
      "Le contrat n'a pas été signé. Il reste à négocier.",
      "Il reste à négocier.",
    );
    flipped("We did not pay. Sales rose.", "Sales rose.");
    flipped("We sell trust.", "We don't sell software. We sell trust.");
  });

  it("holds a denial that a later sentence does not answer", () => {
    flipped(
      "The drug is not approved. It is safe.",
      "The drug is approved. It is safe.",
    );
    flipped(
      "the drug is not safe, but it works",
      "the drug is safe and it works",
    );
    flipped(
      "Le m\u00e9dicament n'est pas autoris\u00e9. C'est prudent.",
      "Le m\u00e9dicament est autoris\u00e9. C'est prudent.",
    );
  });

  it("holds a denial beside a staged contrast", () => {
    flipped(
      "Not only is it safe. It will not open before March 2027.",
      "It is safe. It will open before March 2027.",
    );
    flipped(
      "Ce n'est pas seulement un outil. Il n'ouvrira pas avant mars.",
      "C'est un outil. Il ouvrira avant mars.",
    );
    same("It's not just a tool, it's a partner", "It's a partner");
  });

  it("only lets a sentence go after the same pronoun", () => {
    flipped("They did not pay. The bank closed.", "The bank closed.");
    flipped(
      "Les clients n'ont pas pay\u00e9. Le contrat est clos.",
      "Le contrat est clos.",
    );
    flipped(
      "The crane did not reduce waiting times. The crane cost $48 million.",
      "The crane cost $48 million.",
    );
    flipped("The drug is not approved. The drug is safe.", "The drug is safe.");
    flipped(
      "This contract is not signed. This project moves.",
      "This project moves.",
    );
    flipped(
      "Ce contrat n'est pas sign\u00e9. Ce projet avance.",
      "Ce projet avance.",
    );
    flipped(
      "On Monday we did not pay. On Tuesday we sold.",
      "On Tuesday we sold.",
    );
    same("This is not a bug. This is a feature.", "This is a feature.");
    same(
      "On ne vend pas du logiciel. On vend de la confiance.",
      "On vend de la confiance.",
    );
  });

  it("a contrast only loses the sentence it answers", () => {
    flipped("We do not pay. We sell trust.", "We pay.");
    flipped("We don't sell software. We sold 5 and 6.", "We sold 6 and 5.");
  });

  it.each([".", "!", "?", "\u2026"])(
    "only the first half of a contrast goes, after %s",
    (mark) => {
      flipped(`We did not pay${mark} Sales rose. We sold.`, "We sold.");
      flipped(`Not a sprint${mark} Sales rose. We sold.`, "We sold.");
    },
  );

  it.each(["!", "?", "\u2026"])("a sentence also ends at %s", (mark) => {
    same(`We don't sell software${mark} We sell trust.`, "We sell trust.");
    same(`Not a sprint${mark} A marathon.`, "A marathon.");
  });

  it.each([
    ["We don't sell software, we sell trust.", "We sell trust."],
    ["We don't sell software; we sell trust.", "We sell trust."],
    ["We don't sell software \u2014 we sell trust.", "We sell trust."],
    [
      "Nous ne vendons pas un logiciel : nous vendons la confiance.",
      "Nous vendons la confiance.",
    ],
    ["Not a sprint, a marathon.", "A marathon."],
    ["Pas un outil. Pas un gadget. Un m\u00e9tier.", "Un m\u00e9tier."],
    [
      "We don't sell software. We don't sell hours. We sell trust.",
      "We sell trust.",
    ],
    ["These are not numbers. These are people.", "These are people."],
    ["Ce ne sont pas des chiffres. Ce sont des gens.", "Ce sont des gens."],
    ["It is not a question of money but of will.", "It is a question of will."],
    ["It's a marathon, not a sprint.", "It's a marathon."],
    ["This is a marathon, not a sprint.", "This is a marathon."],
    ["C'est un marathon, pas un sprint.", "C'est un marathon."],
    ["C'est un marathon, et non un sprint.", "C'est un marathon."],
    [
      "The launch wasn't a failure. It was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "It wasn't the price that mattered; it was the timing.",
      "The timing mattered.",
    ],
    [
      "Le lancement n'a pas \u00e9t\u00e9 un \u00e9chec : ce fut une le\u00e7on.",
      "Le lancement fut une le\u00e7on.",
    ],
  ])("%s can become %s, a staged contrast", same);

  it("holds what only looks like that contrast", () => {
    flipped("Not yet signed, the deal holds.", "The deal holds.");
    flipped("It's a marathon.", "It's a marathon, not a sprint.");
    flipped(
      "attribue ce progr\u00e8s \u00e0 l'aide, et non aux tablettes",
      "attribue ce progr\u00e8s \u00e0 l'aide",
    );
    flipped("It's Reyes, not Smith.", "It's Smith.");
    flipped(
      "The company did not pay, and it was fined.",
      "The company paid, and it was fined.",
    );
    flipped(
      "The launch wasn't a failure. It was a lesson.",
      "The launch was a failure. It was a lesson.",
    );
  });

  it.each([
    [
      "L'\u00e9ducation ne se r\u00e9sume pas aux notes : elle ouvre le champ des possibles.",
      "L'\u00e9ducation ouvre le champ des possibles.",
    ],
    [
      "Le projet ne se contente pas de r\u00e9duire les bouchons, il r\u00e9invente la mobilit\u00e9.",
      "Le projet r\u00e9duit les bouchons et r\u00e9invente la mobilit\u00e9.",
    ],
    ["Ce n'est pas qu'un outil.", "C'est un outil."],
    ["Ce ne sont pas que des outils.", "Ce sont des outils."],
    ["Il est rapide et pas que.", "Il est rapide."],
    [
      "Le probl\u00e8me n'est pas tant le co\u00fbt que le calendrier.",
      "Le probl\u00e8me est le calendrier.",
    ],
    ["The issue is not so much cost as timing.", "The issue is timing."],
    [
      "This won't just save time; it will change how you work.",
      "This will save time and change how you work.",
    ],
    [
      "Non seulement il est rapide, il co\u00fbte seulement 5 \u20ac.",
      "Il est rapide et co\u00fbte seulement 5 \u20ac.",
    ],
    ["not only a tool", "a tool"],
    ["not merely a tool", "a tool"],
    ["not simply a tool", "a tool"],
    ["not solely a tool", "a tool"],
    ["This isn't just a tool", "This is a tool"],
    ["These aren't just tools", "These are tools"],
    ["This wasn't just a tool", "This was a tool"],
    ["These weren't just tools", "These were tools"],
    ["We don't just sell tools", "We sell tools"],
    ["We didn't just sell tools", "We sold tools"],
    ["pas uniquement un outil", "un outil"],
    ["pas simplement un outil", "un outil"],
    ["pas juste un outil", "un outil"],
    ["non seulement un outil", "un outil"],
    ["non pas un outil", "un outil"],
    ["not a bug, rather a feature", "a feature"],
    ["not a bug, instead a feature", "a feature"],
    ["not a bug, it is a feature", "a feature"],
    ["not a bug, that's a feature", "a feature"],
    ["not a bug, this is a feature", "a feature"],
    ["not bugs, they're features", "features"],
    ["not bugs, they are features", "features"],
    ["pas un bogue mais un atout", "un atout"],
    ["pas un bogue, plut\u00f4t un atout", "un atout"],
    ["pas un bogue, il s'agit d'un atout", "un atout"],
    ["pas un bogue, au contraire un atout", "un atout"],
    ["a tool", "not just a tool"],
    ["a feature", "not a bug but a feature"],
  ])("%s can become %s", same);

  it.each([
    [
      "L'\u00e9ducation ne se r\u00e9sume pas aux notes",
      "L'\u00e9ducation se r\u00e9sume aux notes",
    ],
    ["Il n'y a pas tant de monde", "Il y a tant de monde"],
    ["Ce n'est pas qu'un outil", "Ce n'est qu'un outil"],
    ["The ruling is not just.", "The ruling is fair."],
    ["It is not just", "It is fair"],
  ])("%s cannot become %s", flipped);

  it("lets the staged contrasts go, which the prompt asks for", () => {
    same("It's not just fast, it's reliable", "It is fast and reliable");
    same("not just a tool", "a tool");
    same(
      "This isn\u2019t about speed. It\u2019s about trust.",
      "This is about trust.",
    );
    same("Not a sprint, but a marathon", "A marathon");
    same("Il ne s'agit pas seulement d'un outil", "C'est un outil");
    same("Ce n'est pas un outil, c'est un métier", "C'est un métier");
    same("Non pas un outil, mais un métier", "Un métier");
    same("It doesn't just work, it scales", "It works and scales");
  });

  it("lets a contrast split over two sentences lose its first one", () => {
    same("We don't sell software. We sell trust.", "We sell trust.");
    same(
      "Nous ne vendons pas un logiciel. Nous vendons la confiance.",
      "Nous vendons la confiance.",
    );
    same("Not a sprint. A marathon.", "A marathon.");
    same("Pas un outil. Un métier.", "Un métier.");
  });

  it("does not hold a set phrase to its words", () => {
    same("It goes without saying that it works", "It works");
    same("whether or not it works", "whether it works");
    same("There is no denying that it works", "It works");
    same("is no small feat", "is hard");
    same("cannot be overstated", "matters");
    same("has never been more important", "matters more than ever");
    same("Il est sans doute trop tard", "Il est probablement trop tard");
    same("une hausse sans précédent", "une hausse inédite");
    same("un rôle non négligeable", "un rôle important");
    same("il ne fait aucun doute que ça marche", "ça marche");
    same("plus que jamais", "encore davantage");
    same("sans\ndoute", "probablement");
    same("sans\u00a0doute", "probablement");
    same("sans nul doute", "probablement");
    same("N'oublions pas que les ventes", "Les ventes");
    same("Il ne faut pas oublier que les ventes", "Les ventes");
    same("Let's not forget that sales", "Sales");
    same("It is no coincidence that sales", "Sales");
    same("Ce n'est pas un hasard si les ventes", "Les ventes");
    same("ni plus ni moins qu'un vol", "un vol");
    same("Pas moins de 40 personnes sont venues", "40 personnes sont venues");
    same("sans parler du coût", "et le coût");
    same("cela va sans dire", "c'est évident");
    same("comme si de rien n'était", "tranquillement");
    same("rien que pour ça", "pour ça");
  });

  it.each([
    ["It comes as no surprise that sales fell.", "Sales fell."],
    ["Make no mistake: the plan works.", "The plan works."],
    ["But that's not all.", "Also."],
    [
      "If you have any questions, don't hesitate to ask.",
      "Ask if you have questions.",
    ],
    ["Do not hesitate to ask.", "Ask."],
    ["no fewer than 40 people", "at least 40 people"],
    ["not more than 40 people", "at most 40 people"],
    ["not less than 40 people", "at least 40 people"],
    ["without question the best", "the best"],
    ["Without further ado, here it is.", "Here it is."],
    ["nothing more than a label", "a mere label"],
    ["none other than the mayor", "the mayor"],
    ["second to none", "excellent"],
    ["not uncommon", "common"],
    ["not unlike the first", "like the first"],
    ["like never before", "more than ever"],
    ["It is no exaggeration to say it works", "It works"],
    ["no easy task", "hard"],
    ["no mean feat", "hard"],
    ["no shortage of ideas", "many ideas"],
    ["N'h\u00e9sitez pas \u00e0 nous contacter.", "Contactez-nous."],
    [
      "Il n'est pas inutile de rappeler que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Ces choix t\u00e9moignent d'un engagement sans faille.",
      "Ces choix montrent un engagement fort.",
    ],
    ["sans grande surprise, les ventes baissent", "les ventes baissent"],
    ["Sans surprise, les ventes baissent", "Les ventes baissent"],
    ["sans plus attendre, signons", "signons"],
    ["un soutien sans r\u00e9serve", "un soutien total"],
    ["un message sans \u00e9quivoque", "un message clair"],
    ["il travaille sans rel\u00e2che", "il travaille beaucoup"],
    ["Ce n'est plus un secret, les ventes baissent", "Les ventes baissent"],
    ["Nul n'ignore que les ventes baissent", "Les ventes baissent"],
    ["Personne n'ignore que les ventes baissent", "Les ventes baissent"],
    ["On ne le dira jamais assez, il faut lire", "Il faut lire"],
    ["Rien d'\u00e9tonnant \u00e0 cela", "C'est normal"],
    ["Il n'en reste pas moins que les ventes baissent", "Les ventes baissent"],
    ["Ce probl\u00e8me ne date pas d'hier", "Ce probl\u00e8me est ancien"],
    ["une ville anim\u00e9e comme jamais", "une ville tr\u00e8s anim\u00e9e"],
    ["Pas besoin de rappeler que les ventes baissent", "Les ventes baissent"],
    ["\u00e0 n'en pas douter, il viendra", "il viendra"],
    ["Ce projet ne manque pas de souffle", "Ce projet a du souffle"],
    ["non sans peine", "avec peine"],
    ["non loin de Paris", "pr\u00e8s de Paris"],
    ["non moins important", "tout aussi important"],
    ["not to mention the cost", "and the cost"],
    ["not least the cost", "above all the cost"],
    ["Not surprisingly, sales fell", "As expected, sales fell"],
    ["there is no doubt it works", "it works"],
    ["It is no wonder sales fell", "Sales fell"],
    ["no matter the cost", "whatever the cost"],
    ["no less important", "as important"],
    ["no later than June", "by June"],
    ["There is no question that it works", "It works"],
    ["It is no secret that it works", "It works"],
    ["is no stranger to risk", "knows risk"],
    ["left no stone unturned", "searched everywhere"],
    ["nothing short of a miracle", "a miracle"],
    ["nothing less than a miracle", "a miracle"],
    ["without a doubt the best", "the best"],
    ["without any doubt the best", "the best"],
    ["without doubt the best", "the best"],
    ["can not be understated", "matters"],
    ["can't be ignored", "matters"],
    ["qu'il vienne ou non", "qu'il vienne"],
    ["qu'il vienne ou pas", "qu'il vienne"],
    ["sans aucun doute le meilleur", "le meilleur"],
    ["Il n'y a pas de doute, \u00e7a marche", "\u00e7a marche"],
    ["il change sans cesse", "il change toujours"],
    ["sans compter le co\u00fbt", "et le co\u00fbt"],
    ["sans oublier le co\u00fbt", "et le co\u00fbt"],
    ["sans parler de ce co\u00fbt", "et ce co\u00fbt"],
    ["sans parler des co\u00fbts", "et les co\u00fbts"],
    ["sans parler d'un co\u00fbt", "et un co\u00fbt"],
    ["sans parler d\u2019un co\u00fbt", "et un co\u00fbt"],
    ["sans conteste le meilleur", "le meilleur"],
    ["un talent sans pareil", "un grand talent"],
    ["il avance pas \u00e0 pas", "il avance lentement"],
    ["perdu \u00e0 jamais", "perdu pour toujours"],
    ["si jamais il vient", "s'il vient"],
    ["mieux que jamais", "encore mieux"],
    ["moins que jamais", "encore moins"],
    ["autant que jamais", "tout autant"],
    ["n'a jamais \u00e9t\u00e9 aussi fort", "est tr\u00e8s fort"],
    ["un rien de sel", "un peu de sel"],
    ["rien que de le dire", "\u00e0 le dire"],
    ["rien que d'y penser", "\u00e0 y penser"],
    ["rien que le co\u00fbt", "le co\u00fbt"],
    ["rien que la peur", "la peur"],
    ["rien que les frais", "les frais"],
    ["ce n'est un secret pour personne", "tout le monde le sait"],
    ["il travaille plus que jamais", "il travaille plus que tout"],
    ["whether or not it works", "whether it works or fails"],
    [
      "Sans compter les frais, le prix est de 40 \u20ac",
      "Hors frais, le prix est de 40 \u20ac",
    ],
    ["Le prix monte, sans compter les frais", "Le prix monte, hors frais"],
    ["Comme si de rien ne s'\u00e9tait pass\u00e9, il part", "Il part"],
    ["There is no doubt that doubt remains.", "Doubt remains."],
    [
      "This is no small task for a small team.",
      "This is hard for a small team.",
    ],
    [
      "It cost no more than 40 dollars, more than last year.",
      "It cost at most 40 dollars, more than last year.",
    ],
    [
      "Pas moins de 40 personnes sont venues, moins de 10 sont rest\u00e9es.",
      "Au moins 40 personnes sont venues, moins de 10 sont rest\u00e9es.",
    ],
    [
      "N'oublions pas que les ventes ont chut\u00e9",
      "Rappelons que les ventes ont chut\u00e9",
    ],
    ["Without a shadow of a doubt, the plan works.", "The plan works."],
    ["It cannot be denied that the plan works.", "The plan works."],
    ["The importance of sleep cannot be stressed enough.", "Sleep matters."],
    ["Let us not forget that costs rose 5%.", "Costs rose 5%."],
    ["We must not forget that costs rose 5%.", "Costs rose 5%."],
    ["Don't forget that costs rose 5%.", "Costs rose 5%."],
    ["It is no accident that costs rose 5%.", "Costs rose 5%."],
    [
      "There has never been a better time to invest.",
      "Now is a good time to invest.",
    ],
    ["It has never been easier to invest.", "Investing is easy."],
    ["This has never been so important.", "This matters."],
    ["is nothing but a tool", "is only a tool"],
    ["None the less, sales rose 5%.", "Still, sales rose 5%."],
    ["Sans le moindre doute, le plan fonctionne.", "Le plan fonctionne."],
    ["Sans l'ombre d'un doute, le plan fonctionne.", "Le plan fonctionne."],
    ["un r\u00e9sultat sans ambigu\u00eft\u00e9", "un r\u00e9sultat clair"],
    ["un talent sans \u00e9gal", "un grand talent"],
    [
      "Il n'est pas exag\u00e9r\u00e9 de dire que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Il n'est pas surprenant que les ventes aient baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "On ne peut pas nier que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "On ne saurait nier que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Nul ne peut nier que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Personne ne peut nier que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Ce n'est pas par hasard que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Ce n'est pas une co\u00efncidence si les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Et ce n'est pas tout : le groupe a aussi embauch\u00e9 40 personnes.",
      "Le groupe a aussi embauch\u00e9 40 personnes.",
    ],
    [
      "Ne nous y trompons pas : ce projet co\u00fbte cher.",
      "Ce projet co\u00fbte cher.",
    ],
    ["Ce sujet n'a jamais \u00e9t\u00e9 si important.", "Ce sujet compte."],
    [
      "Il ne faut pas perdre de vue que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "N'oubliez pas que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    [
      "Il ne faudrait pas oublier que les ventes ont baiss\u00e9.",
      "Les ventes ont baiss\u00e9.",
    ],
    ["Il n'y a plus aucun doute : le plan fonctionne.", "Le plan fonctionne."],
  ])("%s denies nothing", same);

  it.each([
    ["It is no surprise", "It is a surprise"],
    ["no fewer than 40 people", "fewer than 40 people"],
    ["not more than 40 people", "more than 40 people"],
    ["Do not hesitate to ask", "Hesitate to ask"],
    ["Don't hesitate to ask", "Hesitate to ask"],
    ["second to none", "second to all"],
    ["N'h\u00e9sitez pas", "H\u00e9sitez"],
    ["un engagement sans faille", "un engagement avec faille"],
    ["Ce n'est pas un secret", "C'est un secret"],
    ["non loin de Paris", "loin de Paris"],
    ["non moins important", "moins important"],
    [
      "N'oublions pas que les ventes ont chut\u00e9",
      "Oublions que les ventes ont chut\u00e9",
    ],
    [
      "Il ne faut pas oublier que les ventes ont chut\u00e9",
      "Il faut oublier que les ventes ont chut\u00e9",
    ],
    ["There is no doubt", "There are doubts"],
    ["It cannot be denied that it works", "It can be denied that it works"],
    ["Let us not forget the cost", "Let us forget the cost"],
    ["Don't forget the cost", "Forget the cost"],
    ["It is no accident", "It is an accident"],
    ["It has never been easier", "It has been easier"],
    ["It doesn't stop there.", "It stops there."],
    ["Il n'y a plus aucun doute.", "Il y a un doute."],
    ["Sans le moindre doute", "Le moindre doute"],
    ["N'oubliez pas le co\u00fbt", "Oubliez le co\u00fbt"],
    [
      "Il ne faudrait pas oublier le co\u00fbt",
      "Il faudrait oublier le co\u00fbt",
    ],
    ["On ne peut pas nier le co\u00fbt", "On peut nier le co\u00fbt"],
    ["Nul ne peut nier le co\u00fbt", "Chacun peut nier le co\u00fbt"],
    ["Ce n'est pas tout.", "C'est tout."],
    ["Ce n'est pas par hasard", "C'est par hasard"],
    ["Il n'est pas surprenant que", "Il est surprenant que"],
    ["Il n'y a aucun doute", "Il y a des doutes"],
    ["Ce n'est un secret pour personne", "C'est un secret"],
    ["can not be ignored", "should be ignored"],
    ["can't be ignored", "should be ignored"],
    ["has never been more important", "has been more important"],
    ["nothing short of a miracle", "short of a miracle"],
    ["without a doubt", "a doubt"],
    ["sans nul doute", "un doute"],
    ["Il est sans doute trop tard", "Il est en doute trop tard"],
    ["ni plus ni moins qu'un vol", "plus moins qu'un vol"],
    ["rien que pour \u00e7a", "que pour \u00e7a"],
    ["rien que d'y penser", "que d'y penser"],
    ["n'est un secret pour personne", "est un secret pour tous"],
    ["Il a sign\u00e9 sans parler", "Il a sign\u00e9 en criant"],
    ["Cette d\u00e9cision n'est pas juste", "Cette d\u00e9cision est bonne"],
  ])("%s is a denial that %s loses", flipped);

  it.each([
    ["No secret payments were made", "Payments were made"],
    ["No question was asked", "A question was asked"],
    ["No small business was hurt", "A small business was hurt"],
    [
      "Le prix est de 40 \u20ac sans compter les frais",
      "Le prix est de 40 \u20ac en comptant les frais",
    ],
    [
      "Il a tout perdu sans oublier ses dettes",
      "Il a tout perdu et oubli\u00e9 ses dettes",
    ],
    [
      "Il n'y a rien que le comit\u00e9 puisse faire",
      "Le comit\u00e9 peut agir",
    ],
    ["Elle a jur\u00e9 de ne rien que le dire", "Elle a jur\u00e9 de le dire"],
    ["Il parle comme si de rien", "Il parle de tout"],
  ])("%s is no set phrase", flipped);

  it("does not read a French 'ne' or 'pas' that denies nothing", () => {
    same("il ne reste que 5 places", "il reste seulement 5 places");
    same("avant qu'il ne parte", "avant son départ");
    same("un pas en avant", "une avancée");
    same("le premier pas compte", "le début compte");
    same("il ne reste plus que 5 places", "il reste 5 places");
    same("marque un nouveau pas vers", "rapproche de");
    same("le dernier pas", "la dernière étape");
    same("Il fait les cent pas", "Il s'impatiente");
    same("Il marche d'un bon pas", "Il marche vite");
    same("un véritable pas en avant", "une avancée");
    same("un immense pas en avant", "une avancée");
  });

  it.each([
    ["Il ne reste plus qu'une place.", "Il reste une seule place."],
    ["Il ne reste plus qu'\u00e0 signer.", "Il reste \u00e0 signer."],
    [
      "L'\u00e9quipe n'a plus qu'une option.",
      "L'\u00e9quipe a une seule option.",
    ],
    ["Chaque pas compte.", "Chaque \u00e9tape compte."],
    ["un gros pas en avant", "une avanc\u00e9e"],
    [
      "La derni\u00e8re personne n'a re\u00e7u que 5 \u20ac.",
      "La derni\u00e8re personne a re\u00e7u seulement 5 \u20ac.",
    ],
    [
      "Le forfait \u00e0 5 \u20ac par personne n'inclut que le repas.",
      "Le forfait \u00e0 5 \u20ac par personne couvre seulement le repas.",
    ],
    [
      "Le maire en personne n'a sign\u00e9 que 5 dossiers.",
      "Le maire a sign\u00e9 lui-m\u00eame 5 dossiers seulement.",
    ],
    [
      "Avant qu'il n'aborde ce point, le ministre a rappel\u00e9 son bilan.",
      "Avant d'aborder ce point, le ministre a rappel\u00e9 son bilan.",
    ],
    [
      "N'importe quelle personne peut s'inscrire.",
      "Toute personne peut s'inscrire.",
    ],
    [
      "D'aucuns estiment que le projet co\u00fbte trop cher.",
      "Certains estiment que le projet co\u00fbte trop cher.",
    ],
    [
      "D\u2019aucuns estiment que le projet co\u00fbte trop cher.",
      "Certains estiment que le projet co\u00fbte trop cher.",
    ],
  ])("%s denies nothing", same);

  it.each([
    ["he cannot go", "he can go"],
    ["none came", "all came"],
    ["nobody came", "everybody came"],
    ["nothing changed", "everything changed"],
    ["it is nowhere", "it is here"],
    ["neither came", "both came"],
    ["nor did she", "and she did"],
    ["no-one came", "someone came"],
    ["ni lui ni elle", "lui et elle"],
    ["il ne vient gu\u00e8re", "il vient"],
    ["non sign\u00e9", "sign\u00e9"],
    ["il n'est nulle part", "il est ici"],
    ["le service n'existe plus", "le service existe"],
    ["il ne voit personne", "il voit tout le monde"],
    ["Aucuns frais ne sont dus", "Des frais sont dus"],
    ["Nul besoin de signer", "Besoin de signer"],
    ["Nulle trace de fraude", "Une trace de fraude"],
    ["Cela ne saurait durer", "Cela va durer"],
    ["Ils ne sauraient signer", "Ils vont signer"],
  ])("%s denies", flipped);

  it("reads 'ne ... que' as saying something, whatever follows it", () => {
    same("Il n'y a qu'une personne", "Une seule personne se trouve");
    same("Cette personne n'a que 5 ans", "Cette personne a seulement 5 ans");
    same("Ce n'est qu'un point de détail", "C'est un simple détail");
    same("Il n'a marqué qu'un point", "Il a marqué un seul point");
    same("n'en est que plus remarquable", "est d'autant plus remarquable");
  });

  it("lets a word that says no take over from the denial", () => {
    same("do not use it", "avoid using it");
    same("it is not possible", "it is impossible");
    same("the test did not pass", "the test failed");
    same("he cannot go", "he is unable to go");
    same("without sugar", "sugar-free");
    same("n'utilisez pas cet outil", "évitez cet outil");
    same("ce n'est pas possible", "c'est impossible");
  });

  it.each([
    ["It is not available.", "It is unavailable."],
    ["Ce service n'est pas disponible.", "Ce service est indisponible."],
    ["Ce budget n'est pas suffisant.", "Ce budget est insuffisant."],
    ["They do not often come.", "They rarely come."],
    ["Il n'y a pas beaucoup de places.", "Il y a peu de places."],
    ["There were not many left.", "There were few left."],
    ["The firm no longer sells cars.", "The firm has stopped selling cars."],
    ["it does not have funds", "it lacks funds"],
    ["he did not sign", "he refused to sign"],
    ["it will not happen", "it is unlikely to happen"],
    ["it is not clear", "it is unclear"],
    ["it is not safe", "it is unsafe"],
    ["it is not known", "it is unknown"],
    ["it is not fair", "it is unfair"],
    ["it is not legal", "it is illegal"],
    ["it is not needed", "it is unnecessary"],
    ["it is not there", "it is absent"],
    ["it is not there", "it is missing"],
    ["n'a pas assez de temps", "manque de temps"],
    ["n'a pas r\u00e9ussi", "a \u00e9chou\u00e9"],
    ["il ne peut pas partir", "il est incapable de partir"],
    ["ce n'est pas utile", "c'est inutile"],
    ["ce n'est pas l\u00e9gal", "c'est ill\u00e9gal"],
    ["il n'a pas de moyens", "il est d\u00e9pourvu de moyens"],
    ["il n'a pas de risque", "il est exempt de risque"],
    ["without tax", "free of tax"],
    ["avoid using it", "do not use it"],
  ])("%s can become %s, which still says no", same);

  it.each([
    [
      "Il n'a pas sign\u00e9 un peu plus t\u00f4t.",
      "Il a sign\u00e9 un peu plus t\u00f4t.",
    ],
    ["We did not sign a few contracts.", "We signed a few contracts."],
    ["He did not stop", "He stopped"],
    ["It is not unavailable", "It is unavailable"],
  ])("%s cannot become %s", flipped);

  it("does not read parts of other words", () => {
    same("a non-profit group", "a charity");
    same("notably the first", "above all the first");
    same("nevertheless it works", "still, it works");
    same("the No. 5 seller", "the number 5 seller");
    same("un sans-abri", "une personne à la rue");
  });
});

// The guard reads figures and the words next to them, not meaning. These edits change the meaning
// and still pass: they are why every edit is shown to the user, who accepts or rejects it.
describe("whyDrop: what it cannot see", () => {
  const kept = (original: string, replacement: string) =>
    expect(whyDrop(edit(original, replacement))).toBeNull();

  it("misses a denial that moves, or goes where another stays", () => {
    kept("all of them did not pass", "not all of them passed");
    kept("isn't safe and isn't cheap", "isn't safe and is cheap");
  });

  it("misses a denial lost next to an answer when the word before it changes", () => {
    kept("We did not pay. It is late.", "We paid. It is late.");
    kept("Sales did not rise. They are flat.", "Sales rose. They are flat.");
    kept("The drug is not approved. It is safe.", "It is safe.");
    kept(
      "The drug is not approved. It is safe.",
      "The drug is authorized. It is safe.",
    );
    kept(
      "The drug is not approved in France. It is safe.",
      "The drug is approved and safe.",
    );
    kept(
      "Le contrat n'a pas été signé par le client. Ce fut une erreur.",
      "Le contrat a été signé par erreur.",
    );
    kept(
      "Il ne viendra plus cette année, c'est trop tard.",
      "Il viendra, c'est trop tard.",
    );
    kept(
      "Le médicament n'est pas autorisé en France. Il est sûr.",
      "Le médicament est autorisé.",
    );
  });

  it("misses a clause denied by a word it does not list", () => {
    kept(
      "It is not alleged that the firm paid 40 staff, but it is possible.",
      "The firm paid 40 staff, but it is possible.",
    );
  });

  it("cannot tell a sentence dropped after a name from a contrast", () => {
    kept("The drug does not work. It costs $40.", "The drug costs $40.");
    kept(
      "Le médicament ne marche pas. Il coûte 40 €.",
      "Le médicament coûte 40 €.",
    );
    kept(
      "Le médicament n'est pas autorisé. Il est sûr.",
      "Le médicament est sûr.",
    );
  });

  it("misses a denial lost next to a word that says no elsewhere", () => {
    kept(
      "The bank did not pay the fine.",
      "The bank paid the fine to avoid a trial.",
    );
    kept("Les clients ne paient pas.", "Les clients paient peu après.");
  });

  it("cannot tell a short sentence that denies from a contrast", () => {
    kept("Not a word was said. A deal closed.", "A deal closed.");
    kept("Not approved. Sold in France.", "Sold in France.");
    kept("Not a cent. The fine.", "The fine.");
  });

  it("cannot tell a clause that denies one word from a contrast", () => {
    kept("It's legal, not safe.", "It's legal.");
    kept("C'est un prêt, non remboursé.", "C'est un prêt.");
  });

  it("cannot tell a sentence dropped after the same pronoun from a contrast", () => {
    kept("We did not pay. We sold it.", "We sold it.");
    kept("Il n'a pas sign\u00e9. Il a vendu.", "Il a vendu.");
  });

  it("cannot tell a set phrase at the start of a quote from a denial", () => {
    kept("sans compter les frais", "en comptant les frais");
    kept(
      "Le prix est de 40 €, sans compter les frais.",
      "Le prix est de 40 €, en comptant les frais.",
    );
  });

  it("misses a set phrase turned around in other words", () => {
    kept("Le pays ne manque pas de médecins.", "Le pays manquait de médecins.");
    kept("Il n'a jamais été si pauvre.", "Il était si pauvre.");
    kept("The result is not surprising.", "The result is a surprise.");
    kept("The fire was not an accident.", "The fire was accidental.");
    kept("Les fonds ne manquent pas.", "Les fonds sont rares.");
    kept("Ce cas n'est pas rare.", "Ce cas est exceptionnel.");
  });

  it("misses a staged contrast that says the opposite in other words", () => {
    kept(
      "La tablette ne fait pas que remplacer le manuel.",
      "La tablette remplace seulement le manuel.",
    );
    kept(
      "It is not enough to cut costs by 12%.",
      "Cutting costs by 12% suffices.",
    );
  });

  it("misses a case it does not read, once the words change too", () => {
    kept("a dose of 5 Mg", "a dose of 5 mg now");
  });

  it("cannot tell an unfair decision from one that is more than the word says", () => {
    kept(
      "Cette d\u00e9cision n'est pas juste pour tous",
      "Cette d\u00e9cision est \u00e9quitable pour tous",
    );
  });

  it("misses a period it does not know", () => {
    kept("$40 a person", "$40 a seat");
    kept("20 \u20ac de l'heure", "20 \u20ac par jour");
  });

  it("misses a word turned into its opposite, with or without a denial", () => {
    kept("the drug is safe for children", "the drug is dangerous for children");
    kept("le médicament est sûr", "le médicament est dangereux");
  });

  it("misses a reversed direction", () => {
    kept("sales rose 12% in 2019", "sales fell 12% in 2019");
    kept("les ventes ont augmenté de 12 %", "les ventes ont baissé de 12 %");
  });

  it("misses a change of scope", () => {
    kept("some of the 40 tests failed", "all of the 40 tests failed");
  });

  it("misses a scale or a unit it cannot place", () => {
    kept("a 5 m wall", "a 5 km wall");
    kept("a walk of 5 long km", "a walk of 5 long miles");
    kept("5 livres", "5 euros");
    kept("a delay of 5 s", "a delay of 5 min");
    kept("a load of 5 t", "a load of 5 kg");
    kept("a width of 5 in", "a width of 5 cm");
  });

  it("lets a currency go from an amount that reads like a year", () => {
    kept(
      "By 2000 Million Dollars were lost.",
      "By 2000 million people were lost.",
    );
  });

  it("misses a scale that leaves with what follows a year", () => {
    kept("Après 2000 milliards de pertes", "Après 2000 de pertes");
  });

  it("misses a scale added to a figure in another clause", () => {
    kept(
      "Each costs $5 and 6 million shares were sold.",
      "Each costs $5 million and 6 million shares were sold.",
    );
  });

  it("misses a month, which is not a unit", () => {
    kept("signed on 5 May", "signed on 5 June");
    kept("signé le 5 mai", "signé le 5 juin");
  });

  it("misses a dollar of another country", () => {
    kept("a price of C$5", "a price of US$5");
  });

  it("misses a range reversed, unless a lone percent sign tells its ends apart", () => {
    kept("from 10\u201320 people", "from 20\u201310 people");
    kept("between 5%\u201310% of users", "between 10%\u20135% of users");
  });

  it("misses numbers written in words", () => {
    kept("twelve people came", "eleven people came");
  });

  it("misses a sign written in words or in brackets", () => {
    kept("a change of minus 5", "a change of 5");
    kept("a loss of (500)", "a loss of 500");
  });

  it("misses figures that trade places with no name to hold them", () => {
    kept("A rose 12% and B rose 40%", "A rose 40% and B rose 12%");
    kept("born in 1950, died in 1990", "born in 1990, died in 1950");
  });

  it("misses figures that trade names in a sentence it will not judge", () => {
    kept(
      "Apple and Google rose 12% and 40%",
      "Google and Apple rose 12% and 40%",
    );
    kept(
      "Apple rose 12% and Google rose 40%",
      "12% for Google and 40% for Apple",
    );
    kept(
      "Apple rose 12% in 2019 and Google rose 40%",
      "Apple rose 40% in 2019 and Google rose 12%",
    );
    kept("Apple 12% and Google 40% of 100", "Apple 40% and Google 12% of 100");
  });

  it("misses figures that are not plain digits", () => {
    kept("a share of ½ here", "a share of ¼ here");
    kept("about 10² cases", "about 10³ cases");
    kept("au XIXe siècle", "au XVIIIe siècle");
    kept("a price of ５ here", "a price of ６ here");
  });

  it("misses signs and comparisons that are not a minus", () => {
    kept("a fall of ±5 points", "a fall of 5 points");
    kept("<5% of users", ">5% of users");
    kept("T-5 minutes", "T+5 minutes");
  });

  it("misses a minus ahead of a currency in letters, or set apart by a space", () => {
    kept("a change of -CHF 5", "a change of CHF 5");
    kept("a change of - 5 %", "a change of 5 %");
  });
});

describe("whyDrop: what it refuses, at the cost of a suggestion", () => {
  const refused = (original: string, replacement: string, reason: string) =>
    expect(whyDrop(edit(original, replacement))).toBe(reason);

  it("takes a denial reworded without its word for a denial lost", () => {
    refused(
      "The firm is not hiring now, but it is growing.",
      "The firm has paused hiring, but it is growing.",
      "negation_changed",
    );
    refused(
      "Il ne paie pas à temps, mais il paie.",
      "Il paie en retard, mais il paie.",
      "negation_changed",
    );
    refused(
      "qu'il vienne ou non demain",
      "qu'il vienne demain",
      "negation_changed",
    );
    refused(
      "Je ne sais si le contrat est signé.",
      "J'ignore si le contrat est signé.",
      "negation_changed",
    );
    refused(
      "Il fait un pas, puis d'autres pas.",
      "Il avance.",
      "negation_changed",
    );
  });

  it("takes an answer outside a clause of its own, or ahead of another denial, for none", () => {
    refused(
      "It's not about speed, and it's about trust.",
      "It's about trust.",
      "negation_changed",
    );
    refused(
      "No, it's a feature, not a bug.",
      "It's a feature.",
      "negation_changed",
    );
    refused(
      "It's not a bug but a feature, not a flaw.",
      "It's a feature.",
      "negation_changed",
    );
  });

  it("takes a bound for the stock line it looks like", () => {
    refused(
      "The stakes have never been higher than last year.",
      "The stakes are high.",
      "negation_changed",
    );
  });

  it("reads a scale after a date, and no scale ahead of a long dash", () => {
    refused(
      "In 2020 million-dollar deals were rare.",
      "In 2020, million-dollar deals were rare.",
      "units_changed",
    );
    refused("3 \u2014 5 million", "3 million to 5 million", "units_changed");
  });

  it("shares a scale between figures of about one size, wherever a clause ends", () => {
    refused(
      "It employs 40 and 5 million more depend on it.",
      "It employs 40, and 5 million more depend on it.",
      "units_changed",
    );
    refused(
      "Il emploie 30 et 8 millions en dépendent.",
      "Il emploie 30, et 8 millions en dépendent.",
      "units_changed",
    );
  });
});

// Processor time rather than the clock, so that other work on a busy machine does not count against
// this check
const cpuMs = (work: () => void) => {
  const started = process.cpuUsage();
  work();
  const spent = process.cpuUsage(started);
  return (spent.user + spent.system) / 1000;
};

describe("whyDrop: what a long run of letters costs", () => {
  it("reads 40 edits of a long run in far less than the route's budget", () => {
    const spent = cpuMs(() => {
      for (let i = 0; i < MAX_EDITS; i++) {
        whyDrop(edit(`not ${"\u5b57".repeat(596)}`, "\u6587".repeat(1800)));
      }
    });
    expect(spent).toBeLessThan(500);
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
    expect(MAX_EDITS).toBe(40);
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
