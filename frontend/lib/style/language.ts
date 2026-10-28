export type Lang = "en" | "fr";

// Short function words are the cheapest reliable signal between these two languages
const EN = new Set(
  "the of and to in is that it was for with as his her he she they at be this have from or by not but are were which an their you we had has been would there what when who will more if no".split(
    " ",
  ),
);
const FR = new Set(
  "le la les de des du et un une est que qui dans pour pas sur au aux avec ce cette ces il elle ils elles nous vous je tu on se sa son ses leur mais ou par plus ne y en était sont à a".split(
    " ",
  ),
);

// Which language a text is written in, or null when it is too short or too close to call
export function guessLanguage(text: string): Lang | null {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 8) return null;

  let en = 0;
  let fr = 0;
  for (const raw of words) {
    // "l'homme" and "d'un" carry a French article stuck to the next word
    const word = raw.includes("'") ? raw.split("'")[0] : raw;
    if (EN.has(word)) en++;
    if (FR.has(word)) fr++;
  }
  if (en + fr < 3) return null;
  if (fr > en * 1.3) return "fr";
  if (en > fr * 1.3) return "en";
  return null;
}
