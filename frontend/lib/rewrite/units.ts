import { figuresIn } from "./numbers";

const table = (entries: Record<string, string>) =>
  new Map(
    Object.entries(entries).flatMap(([name, words]) =>
      words.split(" ").map((word) => [word, name] as const),
    ),
  );

// What gives a figure its size. Left out, because it reads two ways without context: "m" alone (metres
// or millions, see MONEY_SCALES) and "cent" in French (a hundred or, as UNITS has it, a coin). The English
// plurals of hundred and thousand say a figure stops there: "On May 5 thousands marched". "millions" and
// "billions" are French too and stay, so "On May 5 millions marched" costs a suggestion.
const SCALES = table({
  hundred: "hundred",
  thousand: "k thousand mille milliers",
  million: "million millions",
  billion: "bn billion billions",
  milliard: "md mds mrd mrds milliard milliards",
  trillion: "trillion trillions",
});

// Written forms that say the same thing, in either language. Also left out as ambiguous: "livre" (a
// book or a pound), "an" (a year, or "$5 an hour"), "once" and "are", and bare "s", "t" and "in". Any
// other currency symbol stands for itself.
const CURRENCIES = {
  dollar: "$ usd dollar dollars",
  euro: "€ eur euro euros",
  pound: "£ gbp pound pounds sterling",
  yen: "¥ jpy yen yens",
  franc: "chf franc francs",
  yuan: "cny rmb yuan yuans",
  rupee: "₹ inr rupee rupees roupie roupies",
  rouble: "₽ rub rouble roubles ruble rubles",
  won: "₩ krw",
  ...Object.fromEntries(
    "cad aud sek nok dkk brl mxn hkd sgd nzd zar pln"
      .split(" ")
      .map((code) => [code, code]),
  ),
};
const UNITS = table({
  ...CURRENCIES,
  cent: "cent cents centime centimes",
  mm: "mm millimetre millimetres millimeter millimeters millimètre millimètres",
  cm: "cm centimetre centimetres centimeter centimeters centimètre centimètres",
  metre: "metre metres meter meters mètre mètres",
  km: "km kilometre kilometres kilometer kilometers kilomètre kilomètres",
  mile: "mile miles milles",
  yard: "yard yards",
  foot: "ft foot feet pied pieds",
  inch: "inch inches pouce pouces",
  squaremetre: "m²",
  squarekm: "km²",
  cubicmetre: "m³",
  hectare: "ha hectare hectares",
  are: "ares",
  acre: "acre acres",
  mg: "mg milligram milligrams milligramme milligrammes",
  gram: "g gram grams gramme grammes",
  kg: "kg kgs kilo kilos kilogram kilograms kilogramme kilogrammes",
  tonne: "tonne tonnes ton tons",
  ounce: "oz ounce ounces onces",
  lb: "lb lbs",
  ml: "ml millilitre millilitres milliliter milliliters",
  cl: "cl centilitre centilitres",
  litre: "l litre litres liter liters",
  hectolitre: "hl hectolitre hectolitres",
  gallon: "gal gallon gallons",
  second: "sec secs second seconds seconde secondes",
  minute: "min mins mn minute minutes",
  hour: "h hr hrs hour hours heure heures",
  day: "day days jour jours journée journées",
  week: "week weeks semaine semaines",
  month: "month months mois",
  year: "yr yrs year years ans année années",
  decade: "decade decades décennie décennies",
  century: "century centuries siècle siècles",
  celsius: "°c celsius",
  fahrenheit: "°f fahrenheit",
  wh: "wh watthour watthours wattheure wattheures",
  kwh: "kwh kilowatthour kilowatthours kilowattheure kilowattheures",
  mwh: "mwh megawatthour megawatthours mégawattheure mégawattheures",
  gwh: "gwh gigawatthour gigawatthours gigawattheure gigawattheures",
  watt: "watt watts",
  kw: "kw kilowatt kilowatts",
  mw: "mw megawatt megawatts mégawatt mégawatts",
  gw: "gw gigawatt gigawatts",
  mph: "mph",
  kmh: "km/h kmh kph",
  kms: "km/s",
  ms: "m/s",
  kb: "kb kilobyte kilobytes kilooctet kilooctets",
  mb: "mb megabyte megabytes mégaoctet mégaoctets",
  gb: "gb gigabyte gigabytes gigaoctet gigaoctets",
  tb: "tb terabyte terabytes téraoctet téraoctets",
});
// These only read as written. "to" and "go" are words, and "5 to 10" holds no unit. Lowercased, a
// milliwatt would be a megawatt and a megabit a megabyte.
const CAPITALISED_UNITS = new Map([
  ["Ko", "kb"],
  ["Mo", "mb"],
  ["Go", "gb"],
  ["To", "tb"],
  ["mW", "milliwatt"],
  ["Mb", "megabit"],
  ["Gb", "gigabit"],
]);
// A letter is a scale only next to money: "3 M€", "$3M", "$5B", "3 G$", "5 M d'euros", "3M USD"
const MONEY_SCALES = new Map([
  ["m", "million"],
  ["mn", "million"],
  ["b", "billion"],
  ["g", "milliard"],
  ["t", "trillion"],
  ["tn", "trillion"],
]);
const WORD_AFTER = /^\s?(?:de\s|d['’]|of\s)?(\p{L}+)/iu;

const unitOf = (word: string) => {
  const key = word.toLowerCase().replace(/[\s\p{Pd}]/gu, "");
  return (
    CAPITALISED_UNITS.get(word) ??
    UNITS.get(key) ??
    // "euros/mois" is in euros, and "Mb/s" in megabits
    CAPITALISED_UNITS.get(word.split("/")[0]) ??
    UNITS.get(key.split("/")[0]) ??
    (/^\p{Sc}$/u.test(word) ? word : undefined)
  );
};

// A capitalised "Md" or "GB" is no name
export const readsAsUnit = (word: string) =>
  SCALES.has(word.toLowerCase()) || unitOf(word) !== undefined;

// A symbol or a three-letter code just before a figure: "$5", "€ 5", "USD 5"
const BEFORE = /(\p{Sc}|(?<![\p{L}\p{N}])\p{L}{3})\s?$/u;
// The word just after it, across spaces and at most one line break or after one hyphen: "5 km", "5-km",
// "5€", "5 °C", "5 $US", "5 km/h", "5 km²", "5 kilowatt-hours". A spaced dash or a paragraph ends the
// figure. "l'" is another word, but "days'" and "million's" are not.
const NEXT =
  /^(?:[^\S\n]*\n?[^\S\n]*|[-\u2010\u2011\u2013])(°\s?[cf]|\p{Sc}|(?:\p{L}*watt[\s-](?:hours?|heures?)|\p{L}+[²³]?(?:\/\p{L}+)?)(?![\p{L}\p{N}])(?!['’](?!s?(?:$|[^\p{L}]))))/iu;
// What joins a scale and its unit: "3 millions d'euros"
const LINK = /^\s*(?:de\s|d['’]|of\s)/iu;
// What joins a figure and its temperature: "39 degrés Celsius"
const DEGREES = /^\s*(?:degrees?|degrés?)\s+(?=celsius|fahrenheit)/iu;
// A year takes no scale, but only a date word and a plural or a name say it is one: "In 2020 millions lost
// their jobs", "In 2018 Md Ali led", and not "by 2000 million" or "une dette de 2000 milliards"
const YEAR = /^(?:1[5-9]|20)\d\d$/;
const DATE_WORD =
  /(?:^|[^\p{L}])(?:in|by|since|until|after|before|during|en|depuis|dès|après|avant|vers)\s+$/iu;
// What a rate is per, when it is a unit: "500 €/mois", "$40 an hour", "40 € par an". "an" alone can be
// another word, so only here is it a year.
const PERIOD = /^\s*(?:\/|(?:per|par|an?)\s+)(\p{L}+)/iu;
// One scale said for two figures: "between 3 and 5 million". A long dash with spaces opens a new clause.
const JOINED =
  /^(?:\s*(?:and|or|to|et|ou|à|[-\u2010-\u2013])\s*(?:\p{Sc}\s*)?|[\u2014\u2015]\p{Sc}?\s*)$/iu;
// A list or a spaced dash shares a scale between figures of about one size: "3 and 5 million", and not
// "employs 400 and 5 million more". Between the two ("30 and 10 million"), beside "1,200", which reads 1200 or
// 1.2, or beside a negative figure ("-120 and -8 million"), it can be either, so an edit has to hold on every
// reading.
const LISTED = /^\s*(?:and|or|et|ou)\s|^\s+\p{Pd}/iu;
const sizeOf = (value: string) =>
  /[,.]\d{3}$/.test(value) ? Number.NaN : Math.abs(Number.parseFloat(value));
const READINGS = [
  (first: string, second: string) => sizeOf(first) <= 2 * sizeOf(second),
  (first: string, second: string) => !(sizeOf(first) > 10 * sizeOf(second)),
  (first: string, second: string) =>
    !(Number.parseFloat(first) > 2 * Number.parseFloat(second)),
];

type Figure = ReturnType<typeof figuresIn>[number];

export function readFigure(text: string, { written, start, end }: Figure) {
  const units: string[] = [];
  const symbol =
    /\p{Sc}/u.exec(written)?.[0] ??
    BEFORE.exec(text.slice(Math.max(0, start - 5), start))?.[1];
  const before = symbol && unitOf(symbol);
  if (before) units.push(before);

  let rest = text.slice(end, end + 40).replace(DEGREES, " ");
  let next = NEXT.exec(rest);
  const word = next?.[1].toLowerCase() ?? "";
  const glued = next ? rest.slice(next[0].length) : "";
  // A letter stuck to the figure counts next to a currency ahead of it, a spaced one only for "m": "$5B",
  // "$3 m", but "$5 g" of something. Any of them counts ahead of a currency.
  const moneyWord = WORD_AFTER.exec(glued)?.[1];
  const coded = moneyWord && (unitOf(moneyWord) ?? "") in CURRENCIES;
  const moneyScale =
    /^\s?\p{Sc}/u.test(glued) ||
    coded ||
    (before && (word === "m" || word === "mn" || next?.[0] === next?.[1]));
  const scale =
    SCALES.get(word) ?? (moneyScale ? MONEY_SCALES.get(word) : undefined);
  const isYear =
    YEAR.test(written) &&
    !before &&
    DATE_WORD.test(text.slice(Math.max(0, start - 12), start)) &&
    (!scale || /s$|^mille$/.test(word) || (/^\s\p{Lu}/u.test(glued) && !coded));
  if (scale) {
    rest = glued.replace(LINK, " ");
    next = NEXT.exec(rest);
  }
  const after = next && unitOf(next[1]);
  if (after) units.push(after);
  // Letters that are no unit can still hold a currency up: "5 US$"
  const stuck = next && /^\p{Sc}/u.exec(rest.slice(next[0].length))?.[0];
  if (stuck) units.push(unitOf(stuck) as string);

  // "euros/mois" brings its period along, and "km/h" is a unit of its own
  const token = next?.[1] ?? "";
  if (!(token.includes("/") && UNITS.has(token.toLowerCase()))) {
    const period = PERIOD.exec(
      after ? token.replace(/^[^/]*/, "") + rest.slice(next?.[0].length) : rest,
    )?.[1];
    const per =
      period?.toLowerCase() === "an" ? "year" : period && unitOf(period);
    if (per) units.push(`/${per}`);
  }
  return {
    scale: isYear ? "" : (scale ?? ""),
    afterYear: isYear ? (scale ?? "") : "",
    units,
  };
}

const contains = (large: string[], small: string[]) => {
  const left = [...large];
  return small.every((item) => {
    const at = left.indexOf(item);
    if (at !== -1) left.splice(at, 1);
    return at !== -1;
  });
};

// A unit can go, since "$40" and "40, in dollars" read the same and this only looks next to the
// figure, but it cannot turn into another: "$40" is not "40 euros".
export const sameUnitsOf = (a: string[], b: string[]) =>
  contains(a, b) || contains(b, a);

// Whether each figure kept its size and its unit, for two texts that read the same figures. A scale
// must stay: 3 million is not 3.
export function sameUnits(a: string, b: string): boolean {
  const read = (text: string) => {
    const figures = figuresIn(text);
    const alone = figures.map((figure) => readFigure(text, figure));
    return (shared: (first: string, second: string) => boolean) => {
      const byValue = new Map<string, ReturnType<typeof readFigure>[]>();
      const readings = alone.map((item) => ({ ...item }));
      for (let at = figures.length - 2; at >= 0; at--) {
        const between = text.slice(figures[at].end, figures[at + 1].start);
        if (
          !readings[at].scale &&
          !YEAR.test(figures[at].written) &&
          !/[%\u2030]$/.test(figures[at].value) &&
          JOINED.test(between) &&
          (!LISTED.test(between) ||
            shared(figures[at].value, figures[at + 1].value))
        ) {
          readings[at].scale = readings[at + 1].scale;
        }
      }
      figures.forEach((figure, at) => {
        const list = byValue.get(figure.value) ?? [];
        list.push(readings[at]);
        byValue.set(figure.value, list);
      });
      return byValue;
    };
  };
  const [readA, readB] = [read(a), read(b)];
  return READINGS.every((shared) => {
    const after = readB(shared);
    for (const [value, before] of readA(shared)) {
      const other = after.get(value) ?? [];
      const scales = (list: typeof before) =>
        list.map((item) => item.scale).sort();
      if (scales(before).join() !== scales(other).join()) return false;
      // What follows a year can leave with its clause, but it cannot become another size
      const afterYears = (list: typeof before) =>
        list
          .map((item) => item.afterYear)
          .filter(Boolean)
          .sort();
      const [yearA, yearB] = [afterYears(before), afterYears(other)];
      if (yearA.length && yearB.length && yearA.join() !== yearB.join())
        return false;
      const units = before.flatMap((item) => item.units);
      const others = other.flatMap((item) => item.units);
      if (!sameUnitsOf(units, others)) return false;
    }
    return true;
  });
}
