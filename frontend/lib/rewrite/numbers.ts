// A written number, compared as a whole: digits with their thousands groups (1 200 | 1,234,567)
// and decimal part (3.5 | 2,5 | .5), parts joined into a date or a time (12/03/2024 | 2024-03-12 |
// 10:30), a minus sign and a percent sign. So 3.5 and 35, -5 and 5, 12/03 and 03/12, or 12% and 12 all
// differ, and "12 percent", "12-per-cent", "12 pct" or "12 pour cent" read as 12%. A hyphen or a dash after a digit, a letter,
// a bracket or a unit that follows a digit separates, so "2019-2021" and "5%-10%" can be reworded,
// except in a date with its year first or last (2024-03-12 | 12-03-2024); anywhere else it is a sign,
// also ahead of a currency symbol (-$5).
const INT = String.raw`\d{1,3}(?:[,.\p{Zs}'\u2019]\d{3})+(?!\d)|\d+`;
const PART = String.raw`(?:(?:${INT})(?:[.,]\d+)?|(?<![\p{L}\p{N}])[.,]\d+)`;
const SIGN = String.raw`(?<![\p{L}\p{N})\]])(?<!\p{N}\s?[%\u2030°\p{Sc}'\u2019"])[\p{Pd}\u2212](?:\p{Sc}\s?)?`;
const PERCENT_WORD = String.raw`[\s\p{Pd}]?(?:p(?:er|our)[\s\p{Pd}]?cents?|pct)(?!\p{L})`;
const ENDS_IN_PERCENT_WORD = new RegExp(`${PERCENT_WORD}$`, "iu");
const DATE = String.raw`(?<![\p{L}\p{N}])(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4})(?!\p{N})`;
const NUMBER = new RegExp(
  String.raw`${DATE}|(?:${SIGN})?${PART}(?:[/:]${PART})*(?:\s?[%\u2030]|${PERCENT_WORD})?`,
  "giu",
);
const PART_SHAPE = new RegExp(String.raw`^(${INT})(?:[.,](\d+))?$`, "u");

// One part of a number, without its thousands separators: "1 200,5" -> "1200.5"
function canonicalPart(part: string): string {
  if (/^[.,]/.test(part)) return `0.${part.slice(1)}`;
  const [, whole = part, decimals] = PART_SHAPE.exec(part) ?? [];
  // Every kind of space or apostrophe groups thousands the same way
  const marks = (whole.match(/\D/g) ?? []).map((mark) =>
    /[.,]/.test(mark) ? mark : " ",
  );
  const groups = whole.split(/\D/);
  if (marks.every((mark) => mark === marks[0])) {
    // A lone comma or period before three digits reads 1200 in one language and 1.2 in another,
    // so it only equals itself
    if (decimals === undefined && marks.length === 1 && marks[0] !== " ") {
      return part;
    }
    const digits = groups.join("");
    return decimals === undefined ? digits : `${digits}.${decimals}`;
  }
  // A last comma or period that differs from the marks before it is the decimal mark, even
  // before three digits: 1,234.567 is not 1,234,567. Any other mix only equals itself.
  const before = marks.slice(0, -1);
  if (
    decimals === undefined &&
    /[.,]/.test(marks[marks.length - 1]) &&
    before.every((mark) => mark === before[0])
  ) {
    const last = groups.pop();
    return `${groups.join("")}.${last}`;
  }
  return part;
}

function canonical(number: string): string {
  const sign = /^[\p{Pd}\u2212]/u.test(number) ? "-" : "";
  const word = ENDS_IN_PERCENT_WORD.exec(number)?.[0];
  const percent = word ? "%" : (/[%\u2030]$/.exec(number)?.[0] ?? "");
  const body = number
    .slice(sign.length, number.length - (word ?? percent).length)
    .replace(/^\p{Sc}\s?/u, "")
    .trimEnd();
  // Even pieces are numbers, odd pieces the marks that join them. Only a date holds a hyphen here.
  const joined = body
    .split(/([/:-])/)
    .map((piece, i) => (i % 2 ? piece : canonicalPart(piece)))
    .join("");
  return sign + joined + percent;
}

// Every number in a text: how it compares, as written and where it stands
export const figuresIn = (value: string) =>
  Array.from(value.matchAll(NUMBER), (match) => ({
    value: canonical(match[0]),
    written: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

const numbersOf = (value: string) =>
  figuresIn(value)
    .map((figure) => figure.value)
    .sort();

// Whether two texts read the same figures, in any order
export function sameNumbers(a: string, b: string): boolean {
  const before = numbersOf(a);
  const after = numbersOf(b);
  return (
    before.length === after.length && before.every((n, i) => n === after[i])
  );
}
