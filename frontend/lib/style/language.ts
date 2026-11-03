export type Lang = "en" | "fr";

// Short function words are the cheapest reliable signal between these two languages. Words both
// languages use all the time ("a", "on", "plus", "son") are in neither list: they would only tip the
// count.
const EN = new Set(
  "the of and to in is that it was for with as his her he she they at be this have from or by not but are were which an their you we had has been would there what when who will more if no".split(
    " ",
  ),
);
const FR = new Set(
  "le la les de des du et un une est que qui dans pour pas sur au aux avec ce cette ces il elle ils elles nous vous je tu se sa ses leur mais ou par ne y en était sont à".split(
    " ",
  ),
);

// French words that lose their vowel and stick to the next word: "l'homme", "Qu'il". A capital
// after the apostrophe is a name, and English text has those too: L'Oréal, D'Souza.
const ELIDED = /^(?:[lLdDnNcCjJsSmMtT]|[qQ][uU])'\p{Ll}/u;

// Which language a text is written in, or null when it is too short or too close to call
export function guessLanguage(text: string): Lang | null {
  const words = text.replace(/\u2019/g, "'").match(/[\p{L}']+/gu) ?? [];
  if (words.length < 8) return null;

  let en = 0;
  let fr = 0;
  for (const raw of words) {
    if (ELIDED.test(raw)) {
      fr++;
      continue;
    }
    // "it's" counts as "it"
    const word = raw.toLowerCase().split("'")[0];
    if (EN.has(word)) en++;
    if (FR.has(word)) fr++;
  }
  if (en + fr < 3) return null;
  if (fr > en * 1.3) return "fr";
  if (en > fr * 1.3) return "en";
  return null;
}
