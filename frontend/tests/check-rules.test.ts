// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RULES_EN } from "@/lib/check/rules-en";
import { RULES_FR } from "@/lib/check/rules-fr";
import { scanText, type RuleSet } from "@/lib/check/scan";
import { applyEdits } from "@/lib/rewrite/apply";
import { factChange, whyDrop } from "@/lib/rewrite/guard";
import type { Lang } from "@/lib/style/language";

const phrasesOf = (set: RuleSet) => [
  ...set.openers,
  ...set.closers,
  ...set.wrappers,
  ...set.greetings,
  ...set.filler.map(([phrase]) => phrase),
  ...set.inflated.map(([phrase]) => phrase),
];

// A phrase, a text it is found in and what accepting that gives, then a text it must not be found in:
// a near miss of the words, or the same words in the wrong place
type Sample = readonly [
  phrase: string,
  found: string,
  accepted: string,
  notFound: string,
];

const EN: Sample[] = [
  [
    "in today's (fast-paced|digital|ever-changing|rapidly changing|modern) (world|age|era),",
    "In today's digital age, we read less.",
    "We read less.",
    "We read less in today's digital age, as expected.",
  ],
  [
    "it('s| is) important to (note|remember) that",
    "It's important to note that prices rose.",
    "Prices rose.",
    "It is important to note the date.",
  ],
  [
    "it('s| is) worth (noting|mentioning|pointing out) that",
    "It is worth mentioning that prices rose.",
    "Prices rose.",
    "It is worth mentioning the date.",
  ],
  [
    "it should be noted that",
    "It should be noted that prices rose.",
    "Prices rose.",
    "Prices rose, and it should be noted that wages fell.",
  ],
  [
    "it('s| is) crucial to understand that",
    "It is crucial to understand that prices rose.",
    "Prices rose.",
    "It is crucial to understand the date.",
  ],
  [
    "it goes without saying that",
    "It goes without saying that prices rose.",
    "Prices rose.",
    "He said it goes without saying that prices rose.",
  ],
  [
    "needless to say,",
    "Needless to say, prices rose.",
    "Prices rose.",
    "It was needless to say, in the end.",
  ],
  [
    "as we all know,",
    "As we all know, prices rose.",
    "Prices rose.",
    "He left as we all know, and came back.",
  ],
  [
    "here('s| is) the thing:",
    "Here's the thing: prices rose.",
    "Prices rose.",
    "Here is the thing you asked for.",
  ],
  [
    "without further ado,",
    "Without further ado, prices rose.",
    "Prices rose.",
    "They began without further ado, then stopped.",
  ],
  [
    "moreover,",
    "Moreover, prices rose.",
    "Prices rose.",
    "Prices, moreover, rose.",
  ],
  [
    "furthermore,",
    "Furthermore, prices rose.",
    "Prices rose.",
    "Prices, furthermore, rose.",
  ],
  [
    "additionally,",
    "Additionally, prices rose.",
    "Prices rose.",
    "Prices, additionally, rose.",
  ],
  [
    "in conclusion,",
    "In conclusion, prices rose.",
    "Prices rose.",
    "He spoke in conclusion, then left.",
  ],
  [
    "in summary,",
    "In summary, prices rose.",
    "Prices rose.",
    "He spoke in summary, then left.",
  ],
  [
    "to sum up,",
    "To sum up, prices rose.",
    "Prices rose.",
    "He tried to sum up, then left.",
  ],
  [
    "to summari(s|z)e,",
    "To summarize, prices rose.",
    "Prices rose.",
    "He tried to summarise, then left.",
  ],
  [
    "all in all,",
    "All in all, prices rose.",
    "Prices rose.",
    "He gave it all in all, then left.",
  ],
  [
    "i hope this helps",
    "Prices rose. I hope this helps!",
    "Prices rose.",
    "I hope this helps you decide.",
  ],
  [
    "let that sink in",
    "Prices rose. Let that sink in.",
    "Prices rose.",
    "Let that sink in slowly.",
  ],
  [
    "certainly",
    "Certainly! Prices rose.",
    "Prices rose.",
    "Prices rose. Certainly! They did.",
  ],
  [
    "great question",
    "Great question! Prices rose.",
    "Prices rose.",
    "It was a great question!",
  ],
  [
    "in order to",
    "We met in order to talk.",
    "We met to talk.",
    "We met in order, to talk.",
  ],
  [
    "due to the fact that",
    "We left due to the fact that it rained.",
    "We left because it rained.",
    "We left due to the fact.",
  ],
  [
    "despite the fact that",
    "We left despite the fact that it rained.",
    "We left although it rained.",
    "We left despite the facts.",
  ],
  [
    "in the event that",
    "Call us in the event that it rains.",
    "Call us if it rains.",
    "Call us in the event of rain.",
  ],
  [
    "at this point in time",
    "We are ready at this point in time.",
    "We are ready now.",
    "We are ready at this point in the film.",
  ],
  [
    "for the purpose of",
    "We met for the purpose of talking.",
    "We met for talking.",
    "We met for the purpose.",
  ],
  [
    "first and foremost",
    "She is first and foremost a writer.",
    "She is first a writer.",
    "She is first and last a writer.",
  ],
  [
    "each and every",
    "We read each and every page.",
    "We read every page.",
    "We read each and all.",
  ],
  [
    "plays a (crucial|pivotal|vital|key) role in",
    "Trust plays a key role in sales.",
    "Trust matters for sales.",
    "Trust plays a monkey role in sales.",
  ],
  [
    "play a (crucial|pivotal|vital|key) role in",
    "Trust and care play a vital role in sales.",
    "Trust and care matter for sales.",
    "Trust and care play a small role in sales.",
  ],
  [
    "(is|stands as|serves as) a testament to",
    "It stands as a testament to patience.",
    "It shows patience.",
    "It is a test to patience.",
  ],
  [
    "are a testament to",
    "These are a testament to patience.",
    "These show patience.",
    "These are testaments to patience.",
  ],
  [
    "delve into",
    "We delve into the data.",
    "We look into the data.",
    "We delve in the data.",
  ],
  [
    "delves into",
    "She delves into the data.",
    "She looks into the data.",
    "She delves in the data.",
  ],
  [
    "delved into",
    "She delved into the data.",
    "She looked into the data.",
    "She delved in the data.",
  ],
  [
    "delving into",
    "We are delving into the data.",
    "We are looking into the data.",
    "We are delving in the data.",
  ],
  [
    "a (rich|vibrant) tapestry of",
    "It is a rich tapestry of sounds.",
    "It is a mix of sounds.",
    "It is a rich tapestry.",
  ],
  [
    "the ever-(evolving|changing) landscape of",
    "We track the ever-changing landscape of retail.",
    "We track the world of retail.",
    "We track the changing landscape of retail.",
  ],
];

const FR: Sample[] = [
  [
    "dans un monde en (constante|perpétuelle) évolution,",
    "Dans un monde en constante évolution, les prix montent.",
    "Les prix montent.",
    "Nous vivons dans un monde en constante évolution, dit-il.",
  ],
  [
    "dans le monde (actuel|d'aujourd'hui),",
    "Dans le monde d'aujourd'hui, les prix montent.",
    "Les prix montent.",
    "Nous vivons dans le monde actuel, dit-il.",
  ],
  [
    "(à|a) l'ère (du numérique|numérique),",
    "À l'ère du numérique, les prix montent.",
    "Les prix montent.",
    "Nous vivons à l'ère du numérique, dit-il.",
  ],
  [
    "il est (important|essentiel|crucial|intéressant) de (noter|souligner|rappeler) qu(e|')",
    "Il est important de noter que les prix montent.",
    "Les prix montent.",
    "Il est important de noter la date.",
  ],
  [
    "il convient de (noter|souligner|rappeler) qu(e|')",
    "Il convient de rappeler qu'il pleut.",
    "Il pleut.",
    "Il convient de noter la date.",
  ],
  [
    "il faut (noter|souligner) qu(e|')",
    "Il faut noter que les prix montent.",
    "Les prix montent.",
    "Il faut noter la date.",
  ],
  [
    "il est à noter qu(e|')",
    "Il est à noter que les prix montent.",
    "Les prix montent.",
    "Il est à noter la date.",
  ],
  [
    "il est (crucial|essentiel) de comprendre qu(e|')",
    "Il est crucial de comprendre que les prix montent.",
    "Les prix montent.",
    "Il est crucial à comprendre que les prix montent.",
  ],
  [
    "il va sans dire qu(e|')",
    "Il va sans dire que les prix montent.",
    "Les prix montent.",
    "Cela va sans dire.",
  ],
  [
    "force est de constater qu(e|')",
    "Force est de constater que les prix montent.",
    "Les prix montent.",
    "Force est de le constater.",
  ],
  [
    "comme chacun le sait,",
    "Comme chacun le sait, les prix montent.",
    "Les prix montent.",
    "Il part comme chacun le sait, puis revient.",
  ],
  [
    "sans plus attendre,",
    "Sans plus attendre, les prix montent.",
    "Les prix montent.",
    "Il part sans plus attendre, puis revient.",
  ],
  [
    "de plus,",
    "De plus, les prix montent.",
    "Les prix montent.",
    "Il en veut de plus, puis revient.",
  ],
  [
    "en outre,",
    "En outre, les prix montent.",
    "Les prix montent.",
    "Les prix, en outre, montent.",
  ],
  [
    "en conclusion,",
    "En conclusion, les prix montent.",
    "Les prix montent.",
    "Il parle en conclusion, puis part.",
  ],
  [
    "pour conclure,",
    "Pour conclure, les prix montent.",
    "Les prix montent.",
    "Il parle pour conclure, puis part.",
  ],
  [
    "en résumé,",
    "En résumé, les prix montent.",
    "Les prix montent.",
    "Il parle en résumé, puis part.",
  ],
  [
    "en somme,",
    "En somme, les prix montent.",
    "Les prix montent.",
    "Il parle en somme, puis part.",
  ],
  [
    "en fin de compte,",
    "En fin de compte, les prix montent.",
    "Les prix montent.",
    "Il parle en fin de compte, puis part.",
  ],
  [
    "au bout du compte,",
    "Au bout du compte, les prix montent.",
    "Les prix montent.",
    "Il parle au bout du compte, puis part.",
  ],
  [
    "j'espère que cela (vous aide|vous sera utile|vous a aidé)",
    "Les prix montent. J'espère que cela vous sera utile.",
    "Les prix montent.",
    "J'espère que cela vous sera utile demain.",
  ],
  [
    "bien sûr",
    "Bien sûr ! Les prix montent.",
    "Les prix montent.",
    "Les prix montent. Bien sûr ! Ils montent.",
  ],
  [
    "certainement",
    "Certainement ! Les prix montent.",
    "Les prix montent.",
    "Les prix montent. Certainement !",
  ],
  [
    "excellente question",
    "Excellente question ! Les prix montent.",
    "Les prix montent.",
    "C'est une excellente question !",
  ],
  [
    "dans le but de",
    "Il part dans le but de voir.",
    "Il part pour voir.",
    "Il part dans le but.",
  ],
  [
    "dans le but d'",
    "Il part dans le but d'aider.",
    "Il part pour aider.",
    "Il part dans le bureau d'Anne.",
  ],
  [
    "en raison du fait que",
    "Il part en raison du fait que tout ferme.",
    "Il part parce que tout ferme.",
    "Il part en raison du fait.",
  ],
  [
    "en raison du fait qu'",
    "Il part en raison du fait qu'il pleut.",
    "Il part parce qu'il pleut.",
    "Il part en raison du fait, qui est grave.",
  ],
  [
    "(à|a) l'heure (actuelle|d'aujourd'hui)",
    "Nous sommes prêts à l'heure actuelle.",
    "Nous sommes prêts aujourd'hui.",
    "Nous arrivons à l'heure dite.",
  ],
  [
    "joue un rôle (essentiel|crucial|clé|majeur|déterminant|primordial|fondamental) dans",
    "La confiance joue un rôle clé dans les ventes.",
    "La confiance compte dans les ventes.",
    "La confiance joue un rôle mineur dans les ventes.",
  ],
  [
    "jouent un rôle (essentiel|crucial|clé|majeur|déterminant|primordial|fondamental) dans",
    "Ces outils jouent un rôle crucial dans les ventes.",
    "Ces outils comptent dans les ventes.",
    "Ces outils jouent un rôle mineur dans les ventes.",
  ],
  [
    "revêt une importance (capitale|cruciale)",
    "Ce point revêt une importance capitale.",
    "Ce point compte beaucoup.",
    "Ce point revêt une importance relative.",
  ],
  [
    "revêtent une importance (capitale|cruciale)",
    "Ces points revêtent une importance cruciale.",
    "Ces points comptent beaucoup.",
    "Ces points revêtent une importance relative.",
  ],
  [
    "il est (crucial|essentiel|primordial) de ne pas",
    "Il est essentiel de ne pas confondre.",
    "Il ne faut pas confondre.",
    "Il est utile de ne pas confondre.",
  ],
  [
    "il est (crucial|essentiel|primordial) de ne plus",
    "Il est crucial de ne plus attendre.",
    "Il ne faut plus attendre.",
    "Il est utile de ne plus attendre.",
  ],
  [
    "il est (crucial|essentiel|primordial) de",
    "Il est essentiel de vérifier.",
    "Il faut vérifier.",
    "Il est utile de vérifier.",
  ],
  [
    "il est (crucial|essentiel|primordial) d'",
    "Il est crucial d'agir.",
    "Il faut agir.",
    "Il est crucial.",
  ],
  [
    "s'impose comme un véritable",
    "La ville s'impose comme un véritable modèle.",
    "La ville s'impose comme un modèle.",
    "La ville s'impose comme un modèle.",
  ],
  [
    "s'impose comme une véritable",
    "La ville s'impose comme une véritable référence.",
    "La ville s'impose comme une référence.",
    "La ville s'impose comme une référence.",
  ],
  [
    "marque un tournant décisif",
    "Cette loi marque un tournant décisif.",
    "Cette loi marque un tournant.",
    "Cette loi marque un tournant.",
  ],
];

const accepted = (text: string, lang: Lang) => {
  const { edits } = scanText(text, lang);
  return applyEdits(
    text,
    edits,
    Object.fromEntries(edits.map((edit) => [edit.id, "accepted"])),
  );
};

describe.each([
  { lang: "en" as const, set: RULES_EN, samples: EN },
  { lang: "fr" as const, set: RULES_FR, samples: FR },
])("the $lang phrases", ({ lang, set, samples }) => {
  it("each have their samples", () => {
    expect(samples.map(([phrase]) => phrase).sort()).toEqual(
      phrasesOf(set).sort(),
    );
  });

  it("are written in lower case, one way only", () => {
    const phrases = phrasesOf(set);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const phrase of phrases) expect(phrase).toBe(phrase.toLowerCase());
  });

  it("stay few: a long list is a list of near misses", () => {
    expect(phrasesOf(set).length).toBeLessThanOrEqual(45);
  });

  describe.each(samples)("%s", (_, found, after, notFound) => {
    it("is found", () => {
      expect(scanText(found, lang).edits).toHaveLength(1);
      expect(accepted(found, lang)).toBe(after);
    });

    it("passes the real guard", () => {
      const [edit] = scanText(found, lang).edits;
      expect(whyDrop(edit)).toBeNull();
      expect(factChange(edit.original, edit.replacement)).toBeNull();
    });

    it("is not found where it should not be", () => {
      expect(scanText(notFound, lang).edits).toEqual([]);
    });
  });
});

describe("what every phrase leaves alone", () => {
  const FIGURE = "12 % of 3,400 people did not sign.";

  it.each(EN)(
    "%s, in English, keeps a figure and a denial",
    (_, found, after) => {
      const text = `${found} ${FIGURE}`;
      expect(accepted(text, "en")).toBe(`${after} ${FIGURE}`);
    },
  );

  const CHIFFRE = "12 % des 3 400 personnes n'ont pas signé.";

  it.each(FR)(
    "%s, in French, keeps a figure and a denial",
    (_, found, after) => {
      const text = `${found} ${CHIFFRE}`;
      expect(accepted(text, "fr")).toBe(`${after} ${CHIFFRE}`);
    },
  );
});
