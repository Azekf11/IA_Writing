import { figuresIn } from "./numbers";
import { readFigure, readsAsUnit, sameUnitsOf } from "./units";

// Capitalised words that open a sentence far more often than they name anything
const COMMON = new Set(
  "The An In On At By For From Of To And But Or It Its This That These Those As Le La Les Un Une Des Du De En Au Aux Dans Et Mais Ou Pour Par Sur Ce Cette Ces Moreover Furthermore However Additionally Meanwhile Also Yet Still Thus Hence Then So Ultimately Overall Finally Nevertheless Nonetheless Cependant Toutefois Néanmoins Ainsi Alors Puis Enfin Donc".split(
    " ",
  ),
);
const CAPITALISED = /(?<![\p{L}\p{N}\p{M}])\p{Lu}[\p{L}\p{M}\p{N}-]*/gu;

type Name = { name: string; start: number; end: number };
type Held = { key: string; units: string[] };

// Capitalised words, adjoining ones read as one name. One letter is too little to go on: "A", "L'". A
// unit next to a figure is no name ("5 GB", "50 Md€"), but "Sterling" away from any figure is one.
function namesIn(text: string): Name[] {
  const names: Name[] = [];
  for (const match of text.matchAll(CAPITALISED)) {
    const word = match[0];
    const end = match.index + word.length;
    const nextToFigure =
      /\d[\s\p{Pd}]?$/u.test(
        text.slice(Math.max(0, match.index - 2), match.index),
      ) || /^\s?\d/.test(text.slice(end, end + 2));
    if (
      word.length < 2 ||
      COMMON.has(word) ||
      (nextToFigure && readsAsUnit(word))
    ) {
      continue;
    }
    const last = names.at(-1);
    if (last && !text.slice(last.end, match.index).trim()) {
      last.name += ` ${word}`;
      last.end = end;
    } else {
      names.push({ name: word, start: match.index, end });
    }
  }
  return names;
}

// Which figures go with which name, or null when the order leaves any doubt. It only reads the two
// plain shapes: a name then its figures, every time, or the figures then their name, every time.
function pairsIn(text: string, shared: Set<string>) {
  const names = namesIn(text);
  // The digits of "A320" or "COVID-19" belong to the name
  const figures = figuresIn(text).filter(
    ({ start }) => !names.some((n) => n.start <= start && start < n.end),
  );
  const line = [
    ...names
      .filter(({ name }) => shared.has(name))
      .map(({ name, start }) => ({ at: start, name, figure: null })),
    ...figures.map((figure) => {
      const { scale, units } = readFigure(text, figure);
      return {
        at: figure.start,
        name: "",
        figure: { key: `${figure.value}\n${scale}`, units },
      };
    }),
  ].sort((a, b) => a.at - b.at);

  const namesFirst = Boolean(line[0]?.name);
  const groups: { name: string; figures: Held[] }[] = [];
  let waiting: Held[] = [];
  for (const { name, figure } of line) {
    if (figure) waiting.push(figure);
    else {
      if (namesFirst && groups.length > 0) {
        groups[groups.length - 1].figures = waiting;
        waiting = [];
      }
      groups.push({ name, figures: namesFirst ? [] : waiting });
      if (!namesFirst) waiting = [];
    }
  }
  if (namesFirst) {
    groups[groups.length - 1].figures = waiting;
    waiting = [];
  }
  // Figures with no name to go with, a name with no figure, or names that hold unequal numbers of
  // figures: in "Apple rose 12% and Google 40% in 2019" the date goes with both
  if (
    waiting.length > 0 ||
    groups.some((g) => g.figures.length !== groups[0].figures.length) ||
    groups[0]?.figures.length === 0
  ) {
    return null;
  }
  const pairs = groups.flatMap((g) =>
    g.figures.map((f) => ({ ...f, key: `${g.name}\n${f.key}` })),
  );
  const order = ({ key, units }: Held) => `${key}\n${units.join()}`;
  pairs.sort((a, b) => order(a).localeCompare(order(b)));
  return { namesFirst, pairs };
}

// False when both texts hold the same two or more names, in the same plain shape, and a figure, its
// scale or its unit has moved from one name to another. They read the same figures by now. Anything
// less clear gets no verdict, because a wrong refusal costs the reader a good suggestion.
export function sameAttribution(a: string, b: string): boolean {
  const inB = new Set(namesIn(b).map(({ name }) => name));
  const shared = new Set(
    namesIn(a)
      .map(({ name }) => name)
      .filter((name) => inB.has(name)),
  );
  if (shared.size < 2) return true;
  const left = pairsIn(a, shared);
  const right = pairsIn(b, shared);
  // The digits of "T5" belong to a name on one side and read as "5" on the other, so the counts can differ
  if (
    !left ||
    !right ||
    left.namesFirst !== right.namesFirst ||
    left.pairs.length !== right.pairs.length
  ) {
    return true;
  }
  return left.pairs.every(
    ({ key, units }, at) =>
      key === right.pairs[at].key && sameUnitsOf(units, right.pairs[at].units),
  );
}
