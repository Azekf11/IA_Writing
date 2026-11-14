import type { RuleSet } from "./scan";

// Phrases only, and only those that say nothing a reader would miss: a single word is too often right
export const RULES_FR: RuleSet = {
  openers: [
    "dans un monde en (constante|perpétuelle) évolution,",
    "dans le monde (actuel|d'aujourd'hui),",
    "(à|a) l'ère (du numérique|numérique),",
    "il est (important|essentiel|crucial|intéressant) de (noter|souligner|rappeler) qu(e|')",
    "il convient de (noter|souligner|rappeler) qu(e|')",
    "il faut (noter|souligner) qu(e|')",
    "il est à noter qu(e|')",
    "il est (crucial|essentiel) de comprendre qu(e|')",
    "il va sans dire qu(e|')",
    "force est de constater qu(e|')",
    "comme chacun le sait,",
    "sans plus attendre,",
    "de plus,",
    "en outre,",
  ],
  closers: [
    "en conclusion,",
    "pour conclure,",
    "en résumé,",
    "en somme,",
    "en fin de compte,",
    "au bout du compte,",
  ],
  wrappers: ["j'espère que cela (vous aide|vous sera utile|vous a aidé)"],
  greetings: ["bien sûr", "certainement", "excellente question"],
  filler: [
    ["dans le but de", "pour"],
    ["dans le but d'", "pour "],
    ["en raison du fait que", "parce que"],
    ["en raison du fait qu'", "parce qu'"],
    ["(à|a) l'heure (actuelle|d'aujourd'hui)", "aujourd'hui"],
  ],
  inflated: [
    [
      "joue un rôle (essentiel|crucial|clé|majeur|déterminant|primordial|fondamental) dans",
      "compte dans",
    ],
    [
      "jouent un rôle (essentiel|crucial|clé|majeur|déterminant|primordial|fondamental) dans",
      "comptent dans",
    ],
    ["revêt une importance (capitale|cruciale)", "compte beaucoup"],
    ["revêtent une importance (capitale|cruciale)", "comptent beaucoup"],
    // The denial goes around the verb that comes in: "il ne faut pas", not "il faut ne pas"
    ["il est (crucial|essentiel|primordial) de ne pas", "il ne faut pas"],
    ["il est (crucial|essentiel|primordial) de ne plus", "il ne faut plus"],
    ["il est (crucial|essentiel|primordial) de", "il faut"],
    ["il est (crucial|essentiel|primordial) d'", "il faut "],
    // Only the adjective goes: the verb keeps the writer's denial and mood, "ne s'impose", "qu'elle
    // s'impose"
    ["s'impose comme un véritable", "s'impose comme un"],
    ["s'impose comme une véritable", "s'impose comme une"],
    ["marque un tournant décisif", "marque un tournant"],
  ],
};
