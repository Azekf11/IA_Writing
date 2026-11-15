import { factChange, MAX_EDITS, whyDrop } from "@/lib/rewrite/guard";
import type { Edit } from "@/lib/rewrite/types";
import { guessLanguage, soundsEnglish, type Lang } from "@/lib/style/language";
import { RULES_EN } from "./rules-en";
import { RULES_FR } from "./rules-fr";

// What an edit is there for. The words for each are in the message files, in the language of the page.
export type Category =
  | "opener"
  | "closer"
  | "wrapper"
  | "filler"
  | "inflated"
  | "invisible"
  | "markup"
  | "spaces"
  | "frenchSpacing";

// Phrases are in lower case. A space stands for any blanks, an apostrophe for either kind, and (a|b) for
// a choice.
export type RuleSet = {
  // Where a sentence starts. They go, and what follows takes their capital.
  openers: string[];
  closers: string[];
  // Whole sentences about the text rather than in it. They go with their stop.
  wrappers: string[];
  // The same with an exclamation mark, only as the first words of the text: elsewhere they are an answer
  greetings: string[];
  // Each with its plainer wording
  filler: [string, string][];
  inflated: [string, string][];
};

export type Scan = {
  // In the server's shape, with a category for a reason
  edits: Edit[];
  // What was found beyond the edits shown
  more: number;
};

const RULES: Record<Lang, RuleSet> = { en: RULES_EN, fr: RULES_FR };

// Any blanks with one line break at most: a phrase does not run across a paragraph. Each run of
// blanks has one way to match, or a long one costs time to the power of the words in a phrase.
const BLANKS = String.raw`(?:[^\S\n]+(?:\n[^\S\n]*)?|\n[^\S\n]*)`;
const WORD_CHAR = String.raw`[\p{L}\p{N}\p{M}-]`;
const BEFORE = `(?<!${WORD_CHAR})`;
// An elided word ends on its apostrophe and goes straight on: "qu'il"
const AFTER = `(?:(?<=['\u2019])|(?!${WORD_CHAR}))`;
// A sentence's own stop, or the end of its line when it has none. French sets a space before "!".
const SENTENCE_END = String.raw`(?:[^\S\n]*[.!\u2026]+(?=\s|$)|(?=[^\S\n]*(?:\n|$)))`;
const EXCLAMATION = String.raw`[^\S\n]*!+(?=\s|$)`;

const regexSource = (phrase: string) =>
  phrase
    .replace(/[.*+?^${}[\]\\/]/g, String.raw`\$&`)
    .replaceAll("(", "(?:")
    .replaceAll("'", "['\u2019]")
    .replaceAll(" ", BLANKS);

type Replaced = { category: Category; replacement: string };
type Matcher = { pattern: RegExp; rules: Replaced[] };

// One alternation, the longest phrase first, with a group per phrase to say which one it was
function compile(
  phrases: [string, Replaced][],
  flags: string,
  end: string = AFTER,
): Matcher {
  const ordered = [...phrases].sort(([a], [b]) => b.length - a.length);
  const choices = ordered.map(([phrase]) => `(${regexSource(phrase)})`);
  return {
    pattern: new RegExp(`${BEFORE}(?:${choices.join("|")})${end}`, flags),
    rules: ordered.map(([, rule]) => rule),
  };
}

const ruleOf = ({ rules }: Matcher, match: RegExpMatchArray) =>
  rules[match.slice(1).findIndex((group) => group !== undefined)];

const entries = (phrases: string[], category: Category) =>
  phrases.map((phrase): [string, Replaced] => [
    phrase,
    { category, replacement: "" },
  ]);
const swaps = (phrases: [string, string][], category: Category) =>
  phrases.map(([phrase, replacement]): [string, Replaced] => [
    phrase,
    { category, replacement },
  ]);

function compiled(set: RuleSet) {
  const openers = [
    ...entries(set.openers, "opener"),
    ...entries(set.closers, "closer"),
  ];
  return {
    openers: compile(openers, "giu"),
    // Read at one place, to carry a chain of openers on
    openerAt: compile(openers, "iuy"),
    wrappers: compile(entries(set.wrappers, "wrapper"), "giu", SENTENCE_END),
    greetings: compile(entries(set.greetings, "wrapper"), "iuy", EXCLAMATION),
    swaps: compile(
      [...swaps(set.filler, "filler"), ...swaps(set.inflated, "inflated")],
      "giu",
    ),
  };
}

type Compiled = ReturnType<typeof compiled>;
const cache = new Map<Lang, Compiled>();
function matchersFor(lang: Lang): Compiled {
  let found = cache.get(lang);
  if (!found) cache.set(lang, (found = compiled(RULES[lang])));
  return found;
}

type Range = [start: number, end: number];

// Code: a span between backticks on one line, and a block fenced with ```
const CODE = [/`[^`\n]+`/g, /^```[^\n]*\n[\s\S]*?^```/gm];

// Quotation marks, kept within a paragraph: a stray one must not silence the rest of the text. The
// straight kinds open ahead of a word and close after one, so inches and apostrophes do not count,
// and an apostrophe between letters stays inside: 'I can't stay,' she said. Code counts as quoted.
const QUOTATIONS = [
  /\u00ab(?:(?!\n\s*\n)[^\u00ab\u00bb])*\u00bb/g,
  /\u201c(?:(?!\n\s*\n)[^\u201c\u201d])*\u201d/g,
  /(?<![\p{L}\p{N}])"(?=\S)(?:(?!\n\s*\n)[^"])*?(?<=\S)"(?![\p{L}\p{N}])/gu,
  /\u2018(?:(?!\n\s*\n)[^\u2018])*?\u2019(?!\p{L})/gu,
  /(?<![\p{L}\p{N}])'(?=\S)(?:(?!\n\s*\n)(?:[^']|(?<=\p{L})'(?=\p{L})))*?(?<=\S)'(?![\p{L}\p{N}])/gu,
  ...CODE,
];

function quotations(text: string, patterns: RegExp[]): Range[] {
  const ranges = patterns
    .flatMap((pattern) =>
      [...text.matchAll(pattern)].map(({ 0: found, index }): Range => [
        index,
        index + found.length,
      ]),
    )
    .sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] < last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

// `ranges` are sorted and apart, so the one to look at is the first that ends after `start`
function touches(ranges: Range[], start: number, end: number): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle][1] <= start) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low][0] < end;
}

const isBlank = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isCapital = (ch: string) => ch !== ch.toLowerCase();
// A ligature pasted from a PDF is one letter that upper-cases to two, and takes one capital: "Fi"
const capitalise = (word: string) => {
  const upper = word.charAt(0).toUpperCase();
  return upper.charAt(0) + upper.slice(1).toLowerCase() + word.slice(1);
};

// What can stand ahead of the first word of a line: a list mark, a heading, emphasis
const LINE_MARKS = String.raw`[^\S\n]*(?:(?:[-*_>#\u2022\u2013\u2014]|\d{1,3}[.)])[^\S\n]*)*`;
const OPENS_PARAGRAPH = new RegExp(`(?:^|\\n[^\\S\\n]*\\n)${LINE_MARKS}$`);
const OPENS_LINE = new RegExp(`\\n${LINE_MARKS}$`);
const ONLY_MARKS = new RegExp(`^${LINE_MARKS}$`);
const AFTER_STOP = /[.!?\u2026](?:\s*["\u201d\u00bb\u2019')\]])*\s+$/u;
// Enough to see a line's marks and the end of the sentence before it, on a text of any length
const LOOK_BACK = 32;

function opensSentence(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - LOOK_BACK), at);
  if (OPENS_PARAGRAPH.test(before) || AFTER_STOP.test(before)) return true;
  // A line break can fall anywhere in a wrapped sentence: there, only a capital says one starts
  return OPENS_LINE.test(before) && isCapital(text[at]);
}

type Found = Omit<Edit, "id" | "reason"> & { category: Category };

const FIRST_WORD = /[\p{L}\p{N}\p{M}]+(?:['\u2019-][\p{L}\p{N}\p{M}]+)*/uy;
// A French speech tag puts its pronoun after the verb: "ajouta-t-il", "dis-je"
const SPEECH_TAG = /-(?:t-)?(?:je|il|elle|on|nous|vous|ils|elles)$/iu;
// What follows the first word of an address: "https://", "www.example", "jean.dupont@"
const ADDRESS = /^(?::\/\/|@|\.\p{L}{2})/u;
// No i flag: with it, \p{Ll} takes capitals too
const LOWER_CASE_NEXT = /\s*\p{Ll}/uy;

function execAt(pattern: RegExp, text: string, at: number) {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

// The word a phrase ends on, when a second member of its sentence says it again: "that A and that B",
// "de A et de B". Taking the first away leaves the other standing. It takes a conjunction, or a link
// that works as one ("ainsi que", "as well as"): after a bare comma the word is something else
// ("qu'ils soient", "in particular"), and "de" counts before an infinitive only.
const JOINED = String.raw`\s(?:and|or|but|nor|et|ou|ni|mais|puis|voire|ainsi\s+que|as\s+well\s+as)(?:,?\s+(?:also|aussi|également|surtout|enfin|même|plutôt|encore|above\s+all|especially|rather))?,?\s+`;
const INFINITIVE = String.raw`(?:ne\s+(?:pas|plus)\s+|(?:bien|mieux)\s+)?(?:(?:se|me|te|le|les|lui|leur|nous|vous|y|en)\s+|[smt]['\u2019]|la\s+(?=\p{L}{3,}(?:er|ir|oir)(?!\p{L})))?(?!mani[eè]re(?!\p{L}))\p{L}{2,}(?:er|ir|re|oir)(?!\p{L})`;
const REPEATS: [last: RegExp, again: RegExp][] = [
  [/(?:^|\s)that$/iu, new RegExp(`${JOINED}that\\s`, "iu")],
  [
    /(?:^|\s)qu(?:e|['\u2019])$/iu,
    new RegExp(`${JOINED}qu(?:e\\s|['\u2019])`, "iu"),
  ],
  // "Il est essentiel de ne pas" drops its "de" too
  [
    /(?:^|\s)d(?:e|['\u2019])(?:\s+ne\s+(?:pas|plus))?$/iu,
    new RegExp(`${JOINED}d(?:e\\s+|['\u2019])${INFINITIVE}`, "iu"),
  ],
  [/(?:^|\s)in$/iu, new RegExp(`${JOINED}in\\s+(?!\\d)`, "iu")],
  [/(?:^|\s)to$/iu, new RegExp(`${JOINED}to\\s`, "iu")],
  [/(?:^|\s)of$/iu, new RegExp(`${JOINED}of\\s`, "iu")],
];
// Far enough for a long sentence, and bounded because this runs for every match
const SENTENCE_REACH = 400;

// Whether putting `wording` in place of `found`, which ends at `end`, leaves such a word standing.
// Wording that ends on the same word keeps the sentence whole: "parce que", "to".
function strands(
  text: string,
  end: number,
  found: string,
  wording: string,
): boolean {
  const again = REPEATS.find(
    ([last]) => last.test(found) && !last.test(wording.trimEnd()),
  )?.[1];
  if (!again) return false;
  // A full stop after one to three letters may close an abbreviation ("M. Durand", "Mr. Lee",
  // "the U.S. economy", "e.g."), and so may an ellipsis or three dots after "etc", so the sentence
  // reads on: reading too far costs a suggestion at most. The letters count back to the nearest
  // character that is not a letter, so "aujourd'hui." counts as "hui".
  const [sentence] = text
    .slice(end, end + SENTENCE_REACH)
    .split(
      /(?<!(?<!\p{L})\p{L}{1,3})(?<!(?<!\p{L})etc\.\.)\.\s|(?<!(?<!\p{L})etc)\u2026\s|[!?]\s|\n\s*\n/u,
      1,
    );
  return again.test(sentence);
}

// Where the words after a removed phrase start, or null when none follows it in the paragraph. Only an
// elided word sticks to what comes next, or "**" after "In conclusion," would be left standing.
function wordsAfter(text: string, end: number, phrase: string): number | null {
  let at = end;
  while (isBlank(text[at])) at++;
  const gap = text.slice(end, at);
  if (at === text.length || gap.split("\n").length > 2) return null;
  return at === end && !/['\u2019]$/.test(phrase) ? null : at;
}

function openerEdit(
  text: string,
  first: RegExpMatchArray,
  rules: Compiled,
  replaced: Map<number, RegExpMatchArray>,
  typeset: (written: string) => string,
): Found | null {
  const start = first.index!;
  const lifts = isCapital(first[0][0]);
  const { category } = ruleOf(rules.openers, first);
  let end = start + first[0].length;
  if (strands(text, end, first[0], "")) return null;
  let next = wordsAfter(text, end, first[0]);
  // A link that would strand a word ends the chain, and the openers before it still go
  while (next !== null) {
    const chained = execAt(rules.openerAt.pattern, text, next);
    if (!chained || strands(text, next + chained[0].length, chained[0], "")) {
      break;
    }
    end = next + chained[0].length;
    next = wordsAfter(text, end, chained[0]);
  }
  if (next === null) return null;

  const from = (to: number, replacement: string): Found => ({
    start,
    end: to,
    original: text.slice(start, to),
    replacement,
    category,
  });
  // That word starts another phrase: one edit says both, or the two would overlap
  const swap = replaced.get(next);
  if (swap) {
    const wording = typeset(ruleOf(rules.swaps, swap).replacement);
    return from(
      next + swap[0].length,
      lifts ? likeFound(swap[0], capitalise(wording)) : wording,
    );
  }
  const word = execAt(FIRST_WORD, text, next)?.[0];
  // What follows is an aside, which cannot open the sentence: "De plus, ajouta-t-il, le train ...",
  // "Moreover, and this is key, ..."
  if (
    word &&
    ((SPEECH_TAG.test(word) && text[next + word.length] === ",") ||
      /^(?:and|et)$/iu.test(word))
  ) {
    return null;
  }
  // "iPhone" stays as it is written, and so does an address
  const after = next + (word?.length ?? 0);
  return word &&
    lifts &&
    word === word.toLowerCase() &&
    !ADDRESS.test(text.slice(after, after + 3))
    ? from(after, capitalise(word))
    : from(next, "");
}

// A sentence goes with the blanks on one side: those to its right when the line goes on, when it opens
// the text or when those to its left hold more line breaks, or else those to its left, so that the
// paragraphs around it stay apart. One that fills its line takes the line's marks along, or a list
// mark or "##" would be left marking nothing.
function sentenceEdit(
  text: string,
  start: number,
  stop: number,
  category: Category,
): Found {
  let right = stop;
  while (isBlank(text[right])) right++;
  const carriesOn =
    right < text.length && !text.slice(stop, right).includes("\n");
  const lineStart = carriesOn ? start : text.lastIndexOf("\n", start - 1) + 1;
  const marks = text.slice(lineStart, start);
  const opening =
    /\S/.test(marks) && ONLY_MARKS.test(marks) ? lineStart : start;
  let left = opening;
  while (isBlank(text[left - 1])) left--;
  const breaks = (from: number, to: number) =>
    text.slice(from, to).split("\n").length;
  const takesRight =
    carriesOn ||
    left === 0 ||
    (right < text.length && breaks(left, opening) > breaks(stop, right));
  const [from, to] = takesRight ? [opening, right] : [left, stop];
  return {
    start: from,
    end: to,
    original: text.slice(from, to),
    replacement: "",
    category,
  };
}

const allCaps = (phrase: string) =>
  phrase === phrase.toUpperCase() && phrase !== phrase.toLowerCase();

function likeFound(found: string, wording: string): string {
  if (allCaps(found)) return wording.toUpperCase();
  return isCapital(found[0]) ? capitalise(wording) : wording;
}

// The words beside a phrase, read forwards: a class anchored at the end of a pattern misses some
// letters in V8 14.6, as in /[\p{L}]$/u
const WORDS = /[\p{L}\p{N}\p{M}'\u2019-]+/gu;
const NEXT_WORD = /\s+([\p{L}\p{N}\p{M}'\u2019-]+)/uy;

// The word right before `at`, with only blanks between
function wordBefore(text: string, at: number): string {
  const before = text.slice(Math.max(0, at - LOOK_BACK), at);
  const last = [...before.matchAll(WORDS)].at(-1);
  if (!last) return "";
  return /^\s+$/.test(before.slice(last.index + last[0].length)) ? last[0] : "";
}

const wordAfter = (text: string, at: number) =>
  execAt(NEXT_WORD, text, at)?.[1] ?? "";

// Two words or more that start with a capital, in a phrase that is not all capitals
const titled = (found: string) =>
  !allCaps(found) &&
  (found.match(/(?<![\p{L}\p{N}\p{M}'\u2019-])\p{Lu}/gu) ?? []).length >= 2;

const DETERMINER =
  /^(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their)$/i;

// Whether a phrase found by its words says here what the list means by it, and its new wording
// leaves the sentence whole
function swapFits(
  text: string,
  match: RegExpMatchArray,
  wording: string,
): boolean {
  const found = match[0];
  const start = match.index!;
  const end = start + found.length;
  // A wrapped line that starts with a capital starts something new: "in order\nTo finish, ..."
  if (/\n[^\S\n]*\p{Lu}/u.test(found) && !allCaps(found)) return false;
  // A title in running text: "She read In Order to Live"
  if (titled(found) && /^\p{Ll}/u.test(wordBefore(text, start))) return false;
  // No infinitive starts with a determiner: "in order to the end" is a place in a sequence
  if (
    /^in\s+order\s+to$/iu.test(found) &&
    DETERMINER.test(wordAfter(text, end))
  ) {
    return false;
  }
  // "There is a testament to" has no subject that could show anything
  if (
    /testament\s+to$/iu.test(found) &&
    /^(?:there|here)$/i.test(wordBefore(text, start))
  ) {
    return false;
  }
  // An unaccented "a" in lower case is the verb: "Elle a l'heure actuelle sur son téléphone"
  if (/^a\s+l['\u2019]heure/u.test(found)) return false;
  return !strands(text, end, found, wording);
}

// The longest of those that start together, then whatever does not collide with what is kept
function apart(found: Found[]): Found[] {
  let reached = 0;
  return found
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((edit) => {
      if (edit.start < reached) return false;
      reached = edit.end;
      return true;
    });
}

function findPhrases(text: string, lang: Lang, quoted: Range[]): Found[] {
  const rules = matchersFor(lang);
  const outside = (start: number, end: number) => !touches(quoted, start, end);
  // A text with one style of apostrophe keeps it in the words put in
  const curly = text.includes("\u2019") && !text.includes("'");
  const typeset = (written: string) =>
    curly ? written.replaceAll("'", "\u2019") : written;

  const swapped = [...text.matchAll(rules.swaps.pattern)].filter(
    (match) =>
      outside(match.index, match.index + match[0].length) &&
      swapFits(text, match, ruleOf(rules.swaps, match).replacement),
  );
  const replaced = new Map(swapped.map((match) => [match.index, match]));
  const found: Found[] = swapped.map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    original: match[0],
    replacement: likeFound(
      match[0],
      typeset(ruleOf(rules.swaps, match).replacement),
    ),
    category: ruleOf(rules.swaps, match).category,
  }));

  let reached = 0;
  for (const match of text.matchAll(rules.openers.pattern)) {
    if (match.index < reached || !opensSentence(text, match.index)) continue;
    const edit = openerEdit(text, match, rules, replaced, typeset);
    if (edit && outside(edit.start, edit.end)) {
      found.push(edit);
      reached = edit.end;
    }
  }

  for (const match of text.matchAll(rules.wrappers.pattern)) {
    const stop = match.index + match[0].length;
    if (!opensSentence(text, match.index)) continue;
    const edit = sentenceEdit(text, match.index, stop, "wrapper");
    if (outside(edit.start, edit.end)) found.push(edit);
  }

  const first = text.search(/\S/);
  const greeting =
    first === -1 ? null : execAt(rules.greetings.pattern, text, first);
  if (greeting) {
    const stop = first + greeting[0].length;
    // A tag in lower case carries the sentence on: "Certainly! he said"
    if (!execAt(LOWER_CASE_NEXT, text, stop)) {
      found.push(sentenceEdit(text, first, stop, "wrapper"));
    }
  }
  return apart(found);
}

type Change = [start: number, end: number, insert: string];
type Fix = { changes: Change[]; category: Category };

const change = (start: number, end: number, insert = ""): Change => [
  start,
  end,
  insert,
];

// Joiners belong to emoji sequences and to some scripts, so they only go between Latin letters and
// punctuation. The rest have no use in running text. A run of byte order marks goes in one change:
// each is a blank to JavaScript, and one taken for the blank beside the next would join two words.
const INVISIBLE =
  /[\u200b\u2060\u00ad]|\ufeff+|(?<![^\p{Script=Latin}\s\p{P}])[\u200c\u200d](?![^\p{Script=Latin}\s\p{P}])/gu;
const BOLD =
  /(?<![\p{L}\p{N}*])\*\*(?=[^\s*])([^*\n]{1,200}?)(?<=[^\s*])\*\*(?![\p{L}\p{N}*])/gu;
const HEADING = /^#{1,6}[^\S\n]+(?=\S)/gm;
const HASH_LINE = /^\s*#/;
// How a line of a script starts: a command, a prompt or a path, "~/" included, not a line of "~~~"
const SCRIPT_LINE = /^\s*(?:[a-z$./]|~\/)/;
// Longer runs line things up, and that may be on purpose. So does the padding beside a table's bars.
const DOUBLED = /(?<=[^\s|]) {2,3}(?=[^\s|])/g;
const NO_BREAK = "\u00a0";
// After a word or what closes one, and only at the end of a word: not "12:30" or "http://"
const GLUED_MARK = /(?<=[\p{L}\p{N}\p{M})\]\u00bb])(?=[;:!?]+(?:\s|$))/gu;
const GLUED_OPENING = /(?<=\u00ab)(?=[^\s\u00bb])/g;
const GLUED_CLOSING = /(?<=[^\s\u00ab])(?=\u00bb)/g;

// Where the lines that open a comment start: lines of "#" that follow one another open comments, not
// headings, when the line just above or just below them is a line of a script
function commentLines(text: string): Set<number> {
  const comments = new Set<number>();
  let run: number[] = [];
  let scriptAbove = false;
  let start = 0;
  for (const line of text.split("\n")) {
    if (HASH_LINE.test(line)) {
      run.push(start);
    } else {
      const script = SCRIPT_LINE.test(line);
      if (scriptAbove || script) run.forEach((at) => comments.add(at));
      run = [];
      scriptAbove = script;
    }
    start += line.length + 1;
  }
  if (scriptAbove) run.forEach((at) => comments.add(at));
  return comments;
}

// French spacing is for French. Only a sign of another language takes a paragraph out: short French
// shows none either way.
const otherLanguage = (paragraph: string) =>
  guessLanguage(paragraph) === "en" ||
  soundsEnglish(paragraph) ||
  /[\u00bf\u00a1]/.test(paragraph);

// The paragraphs of a French text that are written in another language
function notFrench(text: string): Range[] {
  const ranges: Range[] = [];
  let at = 0;
  // With its group kept, the split gives a paragraph, then the gap after it, and so on
  text.split(/(\n\s*\n)/).forEach((piece, index) => {
    if (index % 2 === 0 && otherLanguage(piece)) {
      ranges.push([at, at + piece.length]);
    }
    at += piece.length;
  });
  return ranges;
}

function findFixes(text: string, lang: Lang, quoted: Range[]): Fix[] {
  const outside = (start: number, end: number) => !touches(quoted, start, end);
  const other = lang === "fr" ? notFrench(text) : [];
  const inFrench = (at: number) => !touches(other, at, at + 1);
  const fixes: Fix[] = [];
  const each = (
    pattern: RegExp,
    category: Category,
    toChanges: (match: RegExpMatchArray, start: number) => Change[],
    applies: (start: number) => boolean = () => true,
  ) => {
    for (const match of text.matchAll(pattern)) {
      if (applies(match.index)) {
        fixes.push({ category, changes: toChanges(match, match.index) });
      }
    }
  };
  const removed = (match: RegExpMatchArray, start: number) => [
    change(start, start + match[0].length),
  ];

  each(INVISIBLE, "invisible", removed);
  each(BOLD, "markup", (match, start) => [
    change(start, start + 2),
    change(start + match[0].length - 2, start + match[0].length),
  ]);
  const comments = commentLines(text);
  each(HEADING, "markup", removed, (start) => !comments.has(start));
  each(DOUBLED, "spaces", (match, start) => [
    change(start, start + match[0].length, " "),
  ]);
  if (lang === "fr") {
    each(
      GLUED_MARK,
      "frenchSpacing",
      (_, at) => [change(at, at, NO_BREAK)],
      inFrench,
    );
  }
  const kept = fixes.filter(({ changes }) =>
    changes.every(([start, end]) => outside(start, end)),
  );

  // These stand at the edge of a quotation and leave what it says alone. In code, a guillemet is
  // written as the code needs it.
  if (lang === "fr") {
    const code = quotations(text, CODE);
    for (const pattern of [GLUED_OPENING, GLUED_CLOSING]) {
      for (const { index } of text.matchAll(pattern)) {
        // Not between two characters of code. Beside a span, the space stays outside it: "«`ls`»"
        if (!inFrench(index) || touches(code, index, index)) continue;
        kept.push({
          category: "frenchSpacing",
          changes: [change(index, index, NO_BREAK)],
        });
      }
    }
  }
  return kept;
}

// A whitespace change shows nothing unless the words beside it are in the edit
const TOKEN_REACH = 40;
// A paragraph of doubled spaces is one edit, up to a size a reader can take in
const MAX_CLEANUP_SPAN = 300;

function byToken(
  text: string,
  fix: Fix,
  taken: Range[],
): Fix & { start: number; end: number } {
  const first = fix.changes[0][0];
  const last = fix.changes.at(-1)![1];
  const widens = (at: number) =>
    !isBlank(text[at]) && !touches(taken, at, at + 1);
  let start = first;
  while (start > 0 && first - start < TOKEN_REACH && widens(start - 1)) start--;
  let end = last;
  while (end < text.length && end - last < TOKEN_REACH && widens(end)) end++;
  // Not between the two halves of a pair, which would show as broken characters
  if (/[\udc00-\udfff]/.test(text[start] ?? "")) start++;
  if (/[\ud800-\udbff]/.test(text[end - 1] ?? "")) end--;
  return { ...fix, start, end };
}

function findCleanups(
  text: string,
  lang: Lang,
  quoted: Range[],
  taken: Range[],
): Found[] {
  const groups: ReturnType<typeof byToken>[] = [];
  const widened = findFixes(text, lang, quoted)
    .map((fix) => byToken(text, fix, taken))
    .sort((a, b) => a.start - b.start);
  for (const fix of widened) {
    const last = groups.at(-1);
    if (!last || fix.start >= last.end) {
      groups.push({ ...fix });
    } else if (fix.end - last.start <= MAX_CLEANUP_SPAN) {
      last.end = Math.max(last.end, fix.end);
      last.changes = [...last.changes, ...fix.changes];
    }
  }

  return groups.map(({ start, end, changes, category }) => {
    let replacement = "";
    let cursor = start;
    for (const [from, to, insert] of changes.sort((a, b) => a[0] - b[0])) {
      // A heading's own blanks are also a doubled space
      if (from < cursor) continue;
      replacement += text.slice(cursor, from) + insert;
      cursor = to;
    }
    replacement += text.slice(cursor, end);
    // Gone from between two blanks, it takes one along: one of its own line, so that a paragraph
    // break stays, and not a byte order mark, which is a blank to JavaScript and has its own edit
    const to =
      !replacement &&
      isBlank(text[start - 1]) &&
      /[^\S\n\ufeff]/.test(text[end] ?? "")
        ? end + 1
        : end;
    return {
      start,
      end: to,
      original: text.slice(start, to),
      replacement,
      category,
    };
  });
}

const CLEANUP = new Set<Category>([
  "invisible",
  "markup",
  "spaces",
  "frenchSpacing",
]);

// The real guard, on what the rules put together here. To it a change of spacing is no change at all,
// which is all that clean-up is, as long as the figures still read the same: "1  000" is two numbers.
function safe(edit: Found): boolean {
  const reason = whyDrop({ ...edit, reason: edit.category });
  if (reason !== "unchanged" || !CLEANUP.has(edit.category))
    return reason === null;
  return factChange(edit.original, edit.replacement) === null;
}

// `text` must be in NFC, like the text of a rewrite: the offsets refer to it. Language is the text's own,
// or else the page's. Phrases are what a reader came for, so clean-up only takes the room they leave.
export function scanText(text: string, pageLanguage: Lang): Scan {
  const lang = guessLanguage(text) ?? pageLanguage;
  const quoted = quotations(text, QUOTATIONS);
  const phrases = findPhrases(text, lang, quoted).filter(safe);
  const taken = phrases.map((edit): Range => [edit.start, edit.end]);
  const cleanups = findCleanups(text, lang, quoted, taken)
    .filter((edit) => !touches(taken, edit.start, edit.end))
    .filter(safe);

  const first = phrases.slice(0, MAX_EDITS);
  const shown = [...first, ...cleanups.slice(0, MAX_EDITS - first.length)];
  return {
    edits: shown
      .sort((a, b) => a.start - b.start)
      .map(({ category, ...edit }, index) => ({
        id: `edit-${index}`,
        reason: category,
        ...edit,
      })),
    more: phrases.length + cleanups.length - shown.length,
  };
}
