// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanText, type Category } from "@/lib/check/scan";
import { applyEdits } from "@/lib/rewrite/apply";
import { factChange, MAX_EDITS, whyDrop } from "@/lib/rewrite/guard";
import type { Edit } from "@/lib/rewrite/types";
import { MAX_CHECK_CHARS } from "@/lib/text";
import type { Lang } from "@/lib/style/language";

const scan = (text: string, lang: Lang = "en") => scanText(text, lang).edits;
const originals = (edits: Edit[]) => edits.map((edit) => edit.original);
const accept = (text: string, edits: Edit[]) =>
  applyEdits(
    text,
    edits,
    Object.fromEntries(edits.map((edit) => [edit.id, "accepted"])),
  );
const fixed = (text: string, lang: Lang = "en") =>
  accept(text, scan(text, lang));

const MIXED =
  "In today's digital age, we met in order to talk. Moreover, it is important to note that  the  plan delves into costs.\n\n**Summary:** due to the fact that it rained, nobody came. I hope this helps!";

describe("scanText", () => {
  describe("the edits it gives back", () => {
    it("point at exactly what they quote", () => {
      const edits = scan(MIXED);
      expect(edits.length).toBeGreaterThan(4);
      for (const edit of edits) {
        expect(MIXED.slice(edit.start, edit.end)).toBe(edit.original);
      }
    });

    it("are in reading order and do not overlap", () => {
      const edits = scan(MIXED);
      edits.forEach((edit, index) => {
        expect(edit.id).toBe(`edit-${index}`);
        if (index) {
          expect(edit.start).toBeGreaterThanOrEqual(edits[index - 1].end);
        }
      });
    });

    it("carry a category, which the page turns into words", () => {
      const allowed: Category[] = [
        "opener",
        "closer",
        "wrapper",
        "filler",
        "inflated",
        "invisible",
        "markup",
        "spaces",
        "frenchSpacing",
      ];
      for (const edit of scan(MIXED)) {
        expect(allowed).toContain(edit.reason as Category);
      }
    });

    it("read back into the text they were made on", () => {
      expect(fixed(MIXED)).toBe(
        "We met to talk. The plan looks into costs.\n\nSummary: because it rained, nobody came.",
      );
    });

    it("find nothing in a plain text", () => {
      expect(scanText("We walked to the sea.", "en")).toEqual({
        edits: [],
        more: 0,
      });
    });
  });

  describe("how a phrase is matched", () => {
    it("takes whole words: a part of a longer word is another word", () => {
      expect(scan("Trust plays a monkey role in sales.")).toEqual([]);
      expect(scan("It was within order to talk.")).toEqual([]);
      expect(scan("We met in order toward talking.")).toEqual([]);
    });

    it("ignores case, and writes the new words in the same case", () => {
      expect(fixed("IN ORDER TO win, we met.")).toBe("TO win, we met.");
      expect(fixed("In order to win, we met.")).toBe("To win, we met.");
      expect(fixed("How We Met In Order To Win")).toBe("How We Met To Win");
    });

    it("reads straight and curly apostrophes alike", () => {
      expect(originals(scan("In today's digital age, we met."))[0]).toContain(
        "today's",
      );
      expect(
        originals(scan("In today\u2019s digital age, we met."))[0],
      ).toContain("today\u2019s");
    });

    it("writes the apostrophe the text uses", () => {
      expect(
        fixed("Nous sommes prêts à l'heure actuelle, et c'est bien.", "fr"),
      ).toBe("Nous sommes prêts aujourd'hui, et c'est bien.");
      expect(
        fixed(
          "Nous sommes prêts à l\u2019heure actuelle, et c\u2019est bien.",
          "fr",
        ),
      ).toBe("Nous sommes prêts aujourd\u2019hui, et c\u2019est bien.");
    });

    it("reads a no-break space as a space", () => {
      expect(fixed("We met in\u00a0order\u00a0to talk.")).toBe(
        "We met to talk.",
      );
      expect(fixed("We met in\u202forder to talk.")).toBe("We met to talk.");
    });

    it("reads across a line break, but not across a paragraph", () => {
      expect(fixed("We met in order\nto talk.")).toBe("We met to talk.");
      expect(scan("We met in order\n\nto talk.")).toEqual([]);
    });

    it("does not join a phrase across a line that starts a new thought", () => {
      expect(
        scan("Put the files in order\nTo finish, run the script."),
      ).toEqual([]);
      expect(fixed("WE MET IN ORDER\nTO TALK.")).toBe("WE MET TO TALK.");
    });

    it("stays when a second member repeats the word it drops", () => {
      for (const [text, lang] of [
        [
          "Il est essentiel de comprendre les enjeux et de proposer des solutions.",
          "fr",
        ],
        [
          "Il est crucial d'anticiper les besoins, mais aussi de prévoir un budget.",
          "fr",
        ],
        [
          "Diet plays a key role in preventing disease and in speeding recovery.",
          "en",
        ],
        [
          "Due to the fact that the river rose and that the road closed, nobody came.",
          "en",
        ],
      ] as const) {
        expect(scan(text, lang)).toEqual([]);
      }
    });

    it("stays when a longer link joins the second member", () => {
      for (const [text, lang] of [
        [
          "Il est essentiel de ne pas punir les élèves, mais plutôt de leur expliquer les règles.",
          "fr",
        ],
        [
          "Il est essentiel de réduire les coûts ou encore de former les équipes.",
          "fr",
        ],
        [
          "Il est essentiel de réduire les coûts ainsi que de former les équipes.",
          "fr",
        ],
        [
          "The bridge is a testament to the skill of its builders as well as to the patience of the town.",
          "en",
        ],
        [
          "Diet plays a key role in preventing disease and, above all, in speeding recovery.",
          "en",
        ],
        [
          "Il faut noter que le problème ne vient pas des prix, mais plutôt que les salaires stagnent.",
          "fr",
        ],
        [
          "It is important to note that prices rose, as well as that wages fell.",
          "en",
        ],
      ] as const) {
        expect(scan(text, lang)).toEqual([]);
      }
    });

    it("reads the sentence on past the stop of an abbreviation", () => {
      for (const [text, lang] of [
        [
          "Il est essentiel de contacter M. Durand et de prévenir Mme Leroy avant lundi.",
          "fr",
        ],
        [
          "Due to the fact that Mr. Lee resigned and that the board split, the vote failed.",
          "en",
        ],
        [
          "Despite the fact that the U.S. economy grew and that jobs followed, wages fell.",
          "en",
        ],
        [
          "Diet plays a key role in preventing disease, e.g. flu, and in speeding recovery.",
          "en",
        ],
        [
          "Il est essentiel de contacter les clients, les fournisseurs, etc\u2026 et de prévenir la direction avant lundi.",
          "fr",
        ],
      ] as const) {
        expect(scan(text, lang)).toEqual([]);
      }
    });

    it("still swaps when the later word is something else", () => {
      expect(
        fixed(
          "Il est essentiel de comprendre les enjeux de la ville et de la région.",
          "fr",
        ),
      ).toBe("Il faut comprendre les enjeux de la ville et de la région.");
      expect(
        fixed(
          "Il est essentiel de comprendre les enjeux de la ville ainsi que de la région.",
          "fr",
        ),
      ).toBe(
        "Il faut comprendre les enjeux de la ville ainsi que de la région.",
      );
      expect(
        fixed(
          "Trust plays a key role in sales, in particular for small firms.",
        ),
      ).toBe("Trust matters for sales, in particular for small firms.");
      expect(
        fixed(
          "The bridge is a testament to the skill of its builders as well as the patience of the town.",
        ),
      ).toBe(
        "The bridge shows the skill of its builders as well as the patience of the town.",
      );
    });

    it("still swaps when the new wording keeps the word", () => {
      expect(
        fixed("Il part en raison du fait qu'il pleut et que tout ferme.", "fr"),
      ).toBe("Il part parce qu'il pleut et que tout ferme.");
      expect(fixed("We met in order to talk and to plan.")).toBe(
        "We met to talk and to plan.",
      );
    });

    it.each([
      "He read the chapters in order to the end.",
      "Everything was in order to the last detail.",
      "Line the names up in order to the left.",
      "The files were in order to my surprise.",
    ])("leaves 'in order' that leads somewhere: %s", (text) => {
      expect(scan(text)).toEqual([]);
    });

    it.each([
      "Here is a testament to the power of community.",
      "There is a testament to his courage in every line.",
      "In every line there is a testament to his courage.",
    ])("leaves 'a testament to' that has no subject before it: %s", (text) => {
      expect(scan(text)).toEqual([]);
    });

    it.each([
      "She read In Order to Live, a memoir by Yeonmi Park.",
      "We hired First and Foremost Ltd.",
      "She gives to Each and Every Child, a charity.",
    ])("leaves a title in the middle of a sentence: %s", (text) => {
      expect(scan(text)).toEqual([]);
    });

    it("leaves 'a l'heure' where 'a' is the verb", () => {
      expect(
        scan(
          "Elle a l'heure actuelle sur son téléphone, mais elle ne regarde jamais sa montre.",
          "fr",
        ),
      ).toEqual([]);
      expect(fixed("A l'heure actuelle, rien ne bouge.", "fr")).toBe(
        "Aujourd'hui, rien ne bouge.",
      );
      expect(
        fixed("Nous ne disposons pas à l'heure actuelle de données.", "fr"),
      ).toBe("Nous ne disposons pas aujourd'hui de données.");
    });

    it("still swaps those phrases where they mean what the list means", () => {
      expect(fixed("We met in order to answer the letters.")).toBe(
        "We met to answer the letters.",
      );
      expect(fixed("This is a testament to patience.")).toBe(
        "This shows patience.",
      );
      expect(fixed("We read each and every page.")).toBe("We read every page.");
    });

    it("leaves the writer's verb, so a denial or a mood stays as it is", () => {
      expect(
        fixed(
          "Aucun acteur ne s'impose comme un véritable leader sur ce marché.",
          "fr",
        ),
      ).toBe("Aucun acteur ne s'impose comme un leader sur ce marché.");
      expect(
        fixed(
          "Bien que la ville s'impose comme un véritable modèle, elle reste petite.",
          "fr",
        ),
      ).toBe("Bien que la ville s'impose comme un modèle, elle reste petite.");
    });

    it("puts a denial around the verb it brings", () => {
      expect(
        fixed(
          "Il est essentiel de ne pas confondre la vitesse et la précipitation.",
          "fr",
        ),
      ).toBe("Il ne faut pas confondre la vitesse et la précipitation.");
      for (const text of [
        "Il est essentiel de ne pas confondre la vitesse et la précipitation, et de ne pas oublier les délais.",
        "Il est crucial de ne plus attendre et de ne plus hésiter.",
      ]) {
        expect(scan(text, "fr")).toEqual([]);
      }
    });

    it("prefers the longest phrase that starts at the same place", () => {
      const [edit] = scan(
        "Il est crucial de comprendre que les prix montent ici.",
        "fr",
      );
      expect(edit.reason).toBe("opener");
      expect(edit.replacement).toBe("Les");
    });

    it("still finds the shorter one where the longer one cannot be", () => {
      const [edit] = scan(
        "Selon nous, il est crucial de comprendre que les prix montent ici.",
        "fr",
      );
      expect(edit.reason).toBe("inflated");
      expect(edit.original).toBe("il est crucial de");
      expect(edit.replacement).toBe("il faut");
    });
  });

  describe("quotation marks", () => {
    it.each([
      ["straight", 'He wrote "in order to" twice.'],
      ["curly", "He wrote \u201cin order to\u201d twice."],
      ["guillemets", "Il a écrit « afin, dans le but de » deux fois."],
      ["single curly", "He wrote \u2018in order to\u2019 twice."],
      ["single straight", "He wrote 'in order to' twice."],
    ])("keep what is inside %s", (_, text) => {
      expect(scan(text, text.includes("écrit") ? "fr" : "en")).toEqual([]);
    });

    it("do not cover what comes after them", () => {
      expect(fixed('He wrote "in order to" twice in order to tease.')).toBe(
        'He wrote "in order to" twice to tease.',
      );
    });

    it("do not silence the text when one is left open", () => {
      expect(fixed('She said "wait. We met in order to talk.')).toBe(
        'She said "wait. We met to talk.',
      );
    });

    it("do not run over a paragraph", () => {
      expect(fixed('She said "wait.\n\nWe met in order to talk." Then')).toBe(
        'She said "wait.\n\nWe met to talk." Then',
      );
    });

    it("are not inches", () => {
      expect(fixed('A 5" screen, in order to test, and a 6" one.')).toBe(
        'A 5" screen, to test, and a 6" one.',
      );
    });

    it("are not apostrophes", () => {
      expect(fixed("It's late and we met in order to talk, didn't we?")).toBe(
        "It's late and we met to talk, didn't we?",
      );
    });

    it("keep an opener inside them", () => {
      expect(scan('"Moreover, it rained," he said.')).toEqual([]);
    });

    it("keep a straight single quotation with an apostrophe in it", () => {
      expect(scan("'I can't stay in order to please them,' he said")).toEqual(
        [],
      );
      expect(
        fixed("'I can't stay,' he said, and left in order to catch the bus."),
      ).toBe("'I can't stay,' he said, and left to catch the bus.");
    });

    it("keep what is inside code", () => {
      expect(scan("Replace `in order to` with `to` in every section")).toEqual(
        [],
      );
      expect(
        scan(
          "```\n// in order to avoid a race, each and every call waits\n```",
        ),
      ).toEqual([]);
      expect(scan("Watch `app/api/**` and `lib/**` for changes.")).toEqual([]);
      expect(fixed("Use the `--force` flag in order to overwrite it.")).toBe(
        "Use the `--force` flag to overwrite it.",
      );
      expect(fixed("A stray ` backtick, then we met in order to talk.")).toBe(
        "A stray ` backtick, then we met to talk.",
      );
    });

    it("are not lines of ~~~, which break scenes in prose", () => {
      expect(
        fixed(
          "She left in order to think.\n\n~~~\n\nMoreover, he stayed in order to wait.\n\n~~~\n\nThey met.",
        ),
      ).toBe(
        "She left to think.\n\n~~~\n\nHe stayed to wait.\n\n~~~\n\nThey met.",
      );
    });
  });

  describe("an opener", () => {
    it("counts where a sentence starts", () => {
      expect(fixed("It rained. Moreover, we left.")).toBe(
        "It rained. We left.",
      );
      expect(fixed("It rained! Moreover, we left.")).toBe(
        "It rained! We left.",
      );
      expect(fixed('He said "go." Moreover, we left.')).toBe(
        'He said "go." We left.',
      );
    });

    it("does not count in the middle of one", () => {
      expect(scan("It rained, moreover, all week.")).toEqual([]);
    });

    it("counts at the top of a paragraph, whatever its case", () => {
      expect(fixed("First.\n\nmoreover, we left.")).toBe("First.\n\nwe left.");
    });

    it("counts on a list line and after a heading mark", () => {
      expect(fixed("- Moreover, we left.")).toBe("- We left.");
      expect(fixed("1. Moreover, we left.")).toBe("1. We left.");
    });

    it("needs a capital at the start of a wrapped line", () => {
      expect(scan("It rained and\nmoreover, we left.")).toEqual([]);
      expect(fixed("It rained and\nMoreover, we left.")).toBe(
        "It rained and\nWe left.",
      );
    });

    it("gives its capital to what follows", () => {
      const [edit] = scan("In conclusion, by working we win.");
      expect(edit.original).toBe("In conclusion, by");
      expect(edit.replacement).toBe("By");
    });

    it("takes French letters along", () => {
      expect(fixed("En conclusion, à Paris il pleut.", "fr")).toBe(
        "À Paris il pleut.",
      );
      expect(fixed("En conclusion, œuvrer rassure.", "fr")).toBe(
        "Œuvrer rassure.",
      );
      expect(fixed("En conclusion, l'écoute compte.", "fr")).toBe(
        "L'écoute compte.",
      );
    });

    it("leaves a lower-case sentence in lower case", () => {
      expect(fixed("in conclusion, we win.")).toBe("we win.");
    });

    it("leaves alone what cannot take a capital", () => {
      expect(fixed("In conclusion, 5 of 7 agree.")).toBe("5 of 7 agree.");
      expect(fixed("In conclusion, Paris won.")).toBe("Paris won.");
      expect(fixed("In conclusion, iPhone sales rose.")).toBe(
        "iPhone sales rose.",
      );
      expect(fixed('In conclusion, "this" won.')).toBe('"this" won.');
    });

    it("leaves an address as it is written", () => {
      expect(fixed("Moreover, https://example.com is down")).toBe(
        "https://example.com is down",
      );
      expect(fixed("In conclusion, www.example.com is down")).toBe(
        "www.example.com is down",
      );
      expect(
        fixed("De plus, jean.dupont@exemple.fr ne répond pas.", "fr"),
      ).toBe("jean.dupont@exemple.fr ne répond pas.");
      expect(fixed("In conclusion, e.g. this one won.")).toBe(
        "E.g. this one won.",
      );
    });

    it("makes one capital of a ligature", () => {
      expect(
        fixed("En conclusion, \ufb01nalement les prix montent.", "fr"),
      ).toBe("Finalement les prix montent.");
    });

    it("keeps capitals through a merged phrase", () => {
      expect(fixed("MOREOVER, IN ORDER TO WIN, WE MET.")).toBe(
        "TO WIN, WE MET.",
      );
      expect(fixed("Moreover, in order to win, we met.")).toBe(
        "To win, we met.",
      );
    });

    it.each([
      ["De plus, ajouta-t-il, le train était parti.", "fr"],
      ["— De plus, dit-il, le train était parti.", "fr"],
      ["De plus, dis-je, le train était parti.", "fr"],
      ["En outre, et c'est essentiel, les gens sont partis.", "fr"],
      ["Moreover, and this is key, the team stayed.", "en"],
    ] as const)("stays in front of an aside: %s", (text, lang) => {
      expect(scan(text, lang)).toEqual([]);
    });

    it("still goes in front of a question", () => {
      expect(
        fixed("De plus, faut-il rappeler que le projet est mort ?", "fr"),
      ).toBe("Faut-il rappeler que le projet est mort ?");
    });

    it("merges with the openers after it", () => {
      const [edit, ...others] = scan(
        "Moreover, it is important to note that listening helps.",
      );
      expect(others).toEqual([]);
      expect(edit.original).toBe(
        "Moreover, it is important to note that listening",
      );
      expect(edit.replacement).toBe("Listening");
    });

    it("merges through French elisions", () => {
      expect(
        fixed("De plus, il est important de noter qu'il pleut.", "fr"),
      ).toBe("Il pleut.");
      expect(
        fixed("En outre, il faut noter qu'en conclusion, il pleut.", "fr"),
      ).toBe("Il pleut.");
    });

    it("stays when a second clause repeats the word it ends on", () => {
      expect(
        scan("It is important to note that prices rose and that wages fell."),
      ).toEqual([]);
      expect(
        scan(
          "Il est important de noter que les prix montent et que les salaires baissent.",
          "fr",
        ),
      ).toEqual([]);
      expect(
        scan(
          "Il faut noter que le réseau a vieilli, mais aussi que les pannes se multiplient.",
          "fr",
        ),
      ).toEqual([]);
    });

    it("reads the sentence on past the stop of an abbreviation", () => {
      for (const [text, lang] of [
        [
          "Il convient de rappeler que M. Durand a validé le budget et que Mme Leroy a signé la convention.",
          "fr",
        ],
        [
          "It is worth noting that Mr. Lee has agreed to chair the panel and that the board approved the budget.",
          "en",
        ],
        [
          "It is important to note that the U.S. economy grew and that jobs followed.",
          "en",
        ],
        [
          "It is important to note that prices rose, e.g. for bread, and that wages fell.",
          "en",
        ],
        [
          "Il est important de noter que les ventes, les coûts, etc\u2026 ont baissé et que les marges ont fondu.",
          "fr",
        ],
        [
          "Il est important de noter que les ventes, les coûts, etc... ont baissé et que les marges ont fondu.",
          "fr",
        ],
        [
          "It is important to note that rents, fees, etc\u2026 rose and that wages fell.",
          "en",
        ],
        [
          "It is important to note that rents, fees, etc... rose and that wages fell.",
          "en",
        ],
      ] as const) {
        expect(scan(text, lang)).toEqual([]);
      }
    });

    it("still ends the sentence at a stop after a longer word", () => {
      expect(
        fixed(
          "It is worth noting that Dr. Smith approved the plan. The board met and that was all.",
        ),
      ).toBe("Dr. Smith approved the plan. The board met and that was all.");
      expect(
        fixed(
          "Il convient de rappeler que la réunion a lieu demain. Chacun sait ce qu'il doit faire et que tout doit être prêt.",
          "fr",
        ),
      ).toBe(
        "La réunion a lieu demain. Chacun sait ce qu'il doit faire et que tout doit être prêt.",
      );
    });

    it("still ends the sentence at a question, an exclamation or an ellipsis", () => {
      expect(
        fixed(
          "It is worth noting that sales rose a lot! The board met and that was all.",
        ),
      ).toBe("Sales rose a lot! The board met and that was all.");
      expect(
        fixed(
          "It is important to note that the plan is new. Is it? Yes, and that is why we chose it.",
        ),
      ).toBe("The plan is new. Is it? Yes, and that is why we chose it.");
      expect(
        fixed(
          "It is worth noting that sales rose a lot\u2026 The board met and that was all.",
        ),
      ).toBe("Sales rose a lot\u2026 The board met and that was all.");
      expect(
        fixed(
          "It is worth noting that sales rose a lot... The board met and that was all.",
        ),
      ).toBe("Sales rose a lot... The board met and that was all.");
      expect(
        fixed(
          "Il est important de noter que les prix ont monté, et pas qu'un peu\u2026 Chacun sait ce qu'il doit faire et que tout doit être prêt.",
          "fr",
        ),
      ).toBe(
        "Les prix ont monté, et pas qu'un peu\u2026 Chacun sait ce qu'il doit faire et que tout doit être prêt.",
      );
    });

    it("gives up the last link of a chain only", () => {
      expect(
        fixed(
          "Moreover, it is important to note that prices rose and that wages fell.",
        ),
      ).toBe("It is important to note that prices rose and that wages fell.");
    });

    it("still goes when the later word is something else", () => {
      expect(
        fixed(
          "Il convient de rappeler que tous les salariés, qu'ils soient en CDI ou en CDD, ont droit à cette prime.",
          "fr",
        ),
      ).toBe(
        "Tous les salariés, qu'ils soient en CDI ou en CDD, ont droit à cette prime.",
      );
    });

    it("takes the phrase that follows it into the same edit", () => {
      expect(fixed("Moreover, in order to win, we met.")).toBe(
        "To win, we met.",
      );
      expect(scan("Moreover, in order to win, we met.")).toHaveLength(1);
    });

    it("stays when nothing follows it in its paragraph", () => {
      expect(scan("In conclusion,")).toEqual([]);
      expect(scan("In conclusion,\n\nWe win.")).toEqual([]);
    });

    it("stays when emphasis is stuck to it", () => {
      const edits = scan("**In conclusion,** we win.");
      expect(edits.map((edit) => edit.reason)).toEqual(["markup"]);
    });
  });

  describe("a whole sentence", () => {
    it("takes the blanks on its right when the line goes on", () => {
      expect(fixed("I hope this helps! We met.")).toBe("We met.");
    });

    it("takes the blanks on its left at the end of the text", () => {
      expect(fixed("We met. I hope this helps.")).toBe("We met.");
    });

    it("keeps the paragraphs apart", () => {
      expect(fixed("One.\n\nI hope this helps!\n\nTwo.")).toBe("One.\n\nTwo.");
    });

    it("counts without a stop at the end of its line", () => {
      expect(fixed("One.\nI hope this helps\nTwo.")).toBe("One.\nTwo.");
    });

    it("takes the mark with a sentence that fills its line", () => {
      expect(fixed("- I hope this helps\n- Let me know how it goes")).toBe(
        "- Let me know how it goes",
      );
      expect(fixed("Intro\n- I hope this helps")).toBe("Intro");
      expect(fixed("## I hope this helps\nThe rest")).toBe("The rest");
      expect(fixed("- I hope this helps! More follows here")).toBe(
        "- More follows here",
      );
    });

    it("keeps the paragraph break before a line it takes", () => {
      expect(fixed("Notes.\n\n- I hope this helps\n- Next point")).toBe(
        "Notes.\n\n- Next point",
      );
      expect(fixed("Intro.\n\nI hope this helps\nNext line")).toBe(
        "Intro.\n\nNext line",
      );
    });

    it("offers nothing on a numbered line, whose figure would go with it", () => {
      expect(scan("1. Let that sink in.\n2. Now read the rest")).toEqual([]);
    });

    it("does not count when the sentence goes on", () => {
      expect(scan("I hope this helps us.")).toEqual([]);
    });

    it("does not count in the middle of a sentence", () => {
      expect(scan("And I hope this helps.")).toEqual([]);
    });

    it("counts a greeting only as the first words of the text", () => {
      expect(fixed("Certainly! Here it is.")).toBe("Here it is.");
      expect(fixed("  Certainly!\n\nHere it is.")).toBe("  Here it is.");
      expect(scan("Is it? Certainly! Here it is.")).toEqual([]);
      expect(scan("Certainly. Here it is.")).toEqual([]);
    });

    it("leaves a greeting that the sentence carries on from", () => {
      expect(scan("Bien sûr ! répondit-il en riant.", "fr")).toEqual([]);
      expect(scan("Certainly! he said, and left.")).toEqual([]);
    });

    it("reads the French space before the exclamation mark", () => {
      expect(fixed("Bien sûr\u00a0! Voici le texte.", "fr")).toBe(
        "Voici le texte.",
      );
      expect(fixed("Bien sûr! Voici le texte.", "fr")).toBe("Voici le texte.");
    });
  });

  describe("the language", () => {
    const FRENCH =
      "De plus, les prix de la commune sont en hausse depuis le début de l'année.";

    it("is the text's own, whatever the page's", () => {
      expect(scan(FRENCH, "en").map((edit) => edit.replacement)).toEqual([
        "Les",
      ]);
    });

    it("is the page's when the text is too short to say", () => {
      expect(scan("De plus, il part.", "fr")).toHaveLength(1);
      expect(scan("De plus, il part.", "en")).toEqual([]);
      expect(scan("Moreover, he left.", "en")).toHaveLength(1);
      expect(scan("Moreover, he left.", "fr")).toEqual([]);
    });
  });

  describe("the number of edits", () => {
    const many = (count: number) =>
      Array.from({ length: count }, () => "We met in order to talk.").join(" ");

    it("stops at the most one answer may carry, and says how many more", () => {
      const { edits, more } = scanText(many(MAX_EDITS + 5), "en");
      expect(edits).toHaveLength(MAX_EDITS);
      expect(more).toBe(5);
      expect(edits[MAX_EDITS - 1].id).toBe(`edit-${MAX_EDITS - 1}`);
    });

    it("has nothing to say at the limit itself", () => {
      const { edits, more } = scanText(many(MAX_EDITS), "en");
      expect(edits).toHaveLength(MAX_EDITS);
      expect(more).toBe(0);
    });

    it("keeps room for the phrases, whatever the clean-up finds before them", () => {
      const spaced = Array.from(
        { length: MAX_EDITS + 10 },
        (_, n) => `word${n}  word`,
      ).join(". ");
      const text = `${spaced}. We met in order to talk.`;
      const { edits, more } = scanText(text, "en");
      expect(edits).toHaveLength(MAX_EDITS);
      expect(edits.some((edit) => edit.reason === "filler")).toBe(true);
      expect(more).toBeGreaterThan(0);
    });
  });

  describe("the clean-up", () => {
    const cases: [string, string, string, Lang?][] = [
      ["a zero-width space", "co\u200boperate", "cooperate"],
      ["a word joiner", "foo\u2060bar here", "foobar here"],
      ["a byte order mark", "\ufeffHello there", "Hello there"],
      ["a soft hyphen", "auto\u00admatic", "automatic"],
      ["several in one word", "a\u200bb\u200bc\u00add", "abcd"],
      ["a joiner between Latin letters", "foo\u200dbar", "foobar"],
      ["a zero-width character alone", "foo \u200b bar", "foo bar"],
      ["a doubled space", "one  two", "one two"],
      ["a tripled space", "one   two", "one two"],
      ["a doubled space after a stop", "One.  Two.", "One. Two."],
      ["bold marks", "It was **very** good.", "It was very good."],
      [
        "bold marks around a phrase",
        "**Key points:** here.",
        "Key points: here.",
      ],
      ["a heading mark", "## The title\nText", "The title\nText"],
      ["the deepest heading mark", "###### Title", "Title"],
    ];

    it.each(cases)("removes %s", (_, text, after) => {
      expect(fixed(text)).toBe(after);
    });

    it("reports each kind under its own category", () => {
      expect(scan("co\u200boperate")[0].reason).toBe("invisible");
      expect(scan("auto\u00admatic")[0].reason).toBe("invisible");
      expect(scan("It was **good**.")[0].reason).toBe("markup");
      expect(scan("# Title")[0].reason).toBe("markup");
      expect(scan("one  two")[0].reason).toBe("spaces");
      expect(scan("Bonjour!", "fr")[0].reason).toBe("frenchSpacing");
    });

    it("shows the word beside what it changes", () => {
      expect(originals(scan("one  two"))).toEqual(["one  two"]);
      expect(originals(scan("co\u200boperate"))).toEqual(["co\u200boperate"]);
    });

    it("makes one edit of doubled spaces in a row", () => {
      const edits = scan("one  two  three");
      expect(originals(edits)).toEqual(["one  two  three"]);
      expect(edits[0].replacement).toBe("one two three");
    });

    it("makes one edit of a pair of bold marks", () => {
      expect(originals(scan("It was **very good** here."))).toEqual([
        "**very good**",
      ]);
    });

    it("keeps the line break after an invisible character", () => {
      expect(fixed("One.\n\u200b\nTwo.")).toBe("One.\n\nTwo.");
      expect(fixed("One. \ufeff\nTwo.")).toBe("One. \nTwo.");
      expect(fixed("foo \u200b bar")).toBe("foo bar");
    });

    it("keeps edits apart on two byte order marks", () => {
      const text = "x \ufeff\ufeff y";
      const edits = scan(text);
      expect(edits.length).toBeGreaterThan(0);
      edits.forEach((edit, index) => {
        if (index)
          expect(edit.start).toBeGreaterThanOrEqual(edits[index - 1].end);
      });
      expect(applyEdits(text, edits, {})).toBe(text);
    });

    it("keeps a word apart from the next on byte order marks in a row", () => {
      expect(fixed("Hello\ufeff\ufeff world.")).toBe("Hello world.");
      expect(fixed("Bonjour\ufeff\ufeff\ufeff tout le monde.", "fr")).toBe(
        "Bonjour tout le monde.",
      );
      expect(fixed("We met in order to\ufeff\ufeff talk.")).toBe(
        "We met to talk.",
      );
      // At the start of the text, the blank after them stays, as after one
      expect(fixed("\ufeff\ufeff Hello there")).toBe(" Hello there");
      // Between two blanks, they still take one along
      expect(fixed("x \ufeff\ufeff y")).toBe("x y");
      const text = "Hello\ufeff\ufeff world.";
      const edits = scan(text);
      for (const { id } of edits) {
        const one = applyEdits(text, edits, { [id]: "accepted" });
        expect(one.replaceAll("\ufeff", "")).toBe("Hello world.");
      }
    });

    it("does not cut a pair in two", () => {
      for (const text of [`${"😀".repeat(30)}a  b`, `a  b${"😀".repeat(30)}`]) {
        const [edit] = scan(text);
        expect(edit.original.isWellFormed()).toBe(true);
        expect(text.slice(0, edit.start).isWellFormed()).toBe(true);
        expect(text.slice(edit.end).isWellFormed()).toBe(true);
      }
    });

    it("leaves a joiner that belongs to an emoji or another script", () => {
      expect(scan("👩\u200d💻 at work")).toEqual([]);
      expect(scan("क्\u200dष is here")).toEqual([]);
    });

    it.each([
      ["a run of spaces that lines things up", "name      age"],
      ["an indent", "    indented line"],
      ["a mark inside a word", "2**3 and 4**5"],
      ["a bold mark left alone", "It was **good."],
      ["a hashtag", "#launch day"],
      ["a mark that is not a heading", "#1 priority"],
      ["a number after a hash inside a line", "We are # 1 here"],
    ])("leaves %s", (_, text) => {
      expect(scan(text)).toEqual([]);
    });

    it("leaves the padding of a Markdown table", () => {
      expect(
        scan("| Step   | Owner |\n|--------|-------|\n| Build  |  Sam  |"),
      ).toEqual([]);
      expect(fixed("Two  spaces here.\n\n| a  | b |")).toBe(
        "Two spaces here.\n\n| a  | b |",
      );
    });

    it("leaves the # that opens a shell comment", () => {
      expect(scan("# install the dependencies\nnpm install")).toEqual([]);
      expect(scan("npm run build\n# Then start it\n$ npm start")).toEqual([]);
      expect(
        scan("# 1. Fetch the books\n#    and the catalog\nmkdir -p data"),
      ).toEqual([]);
      expect(
        scan(
          "# Fetch the books,\n# then the catalog,\n# then the rest\nuv sync",
        ),
      ).toEqual([]);
      expect(scan("# Run the backup\n~/bin/backup.sh")).toEqual([]);
      expect(scan("~/bin/backup.sh\n# Then check the log")).toEqual([]);
      expect(fixed("# Release notes\nThe build is done.")).toBe(
        "Release notes\nThe build is done.",
      );
    });

    // The limit the README states: with no command right beside it, a shell comment reads as a heading
    it.each([
      [
        "above a blank line",
        "# Install the dependencies\n\nnpm ci\n",
        "# Install",
      ],
      [
        "above an upper-case variable",
        "#!/bin/sh\n# Where the backups go\nBACKUP_DIR=/var/backups\n",
        "# Where",
      ],
      ["after a blank line", "make all\n\n# Done\n", "# Done"],
    ])("takes a shell comment %s for a heading", (_, text, mark) => {
      expect(originals(scan(text))).toEqual([mark]);
    });

    it("still takes the marks off headings that follow one another", () => {
      expect(fixed("# Title\n## Section\n\nSome text here.")).toBe(
        "Title\nSection\n\nSome text here.",
      );
      expect(fixed("\n# Title\n\nSome text here.")).toBe(
        "\nTitle\n\nSome text here.",
      );
      // A line of ~~~ breaks scenes in prose: it is no line of a script
      expect(fixed("~~~\n# Part Two\nIt was late.")).toBe(
        "~~~\nPart Two\nIt was late.",
      );
    });

    it("leaves a figure it cannot be sure of", () => {
      const edits = scan("It cost 1\u200b000 euros.");
      for (const edit of edits) {
        expect(factChange(edit.original, edit.replacement)).toBeNull();
      }
    });

    it("leaves what is inside quotation marks", () => {
      expect(scan('He wrote "one  two" here.')).toEqual([]);
      expect(scan("He wrote \u201cco\u200boperate\u201d here.")).toEqual([]);
    });

    it("gives way to a phrase on the same words", () => {
      const edits = scan("We met in  order to talk in order to win.");
      expect(edits.map((edit) => edit.reason)).toContain("filler");
    });

    it("never changes a number or a denial", () => {
      for (const text of [
        "It did not  cost 12  euros.",
        "**not** 12 and 1  000",
        "## 12 do not\nText",
      ]) {
        for (const edit of scan(text)) {
          expect(factChange(edit.original, edit.replacement)).toBeNull();
        }
      }
    });

    it("passes the guard, which calls a change of spaces no change at all", () => {
      expect(whyDrop(scan("one  two")[0])).toBe("unchanged");
      for (const text of ["co\u200boperate", "It was **good**.", "# Title"]) {
        expect(whyDrop(scan(text)[0])).toBeNull();
      }
      expect(whyDrop(scan("Bonjour!", "fr")[0])).toBeNull();
    });
  });

  describe("French spacing", () => {
    const NB = "\u00a0";

    it.each([
      ["Bonjour! Ça va?", `Bonjour${NB}! Ça va${NB}?`],
      ["Voici la liste: un, deux.", `Voici la liste${NB}: un, deux.`],
      ["Oui; non.", `Oui${NB}; non.`],
      ["Quoi?! Non.", `Quoi${NB}?! Non.`],
      ["Il dit «bonjour».", `Il dit «${NB}bonjour${NB}».`],
      ["Il dit «bonjour à tous».", `Il dit «${NB}bonjour à tous${NB}».`],
    ])("fixes %s", (text, after) => {
      expect(fixed(text, "fr")).toBe(after);
    });

    it.each([
      ["a time", "Il part à 12:30 pour Lyon."],
      ["an address", "Voir https://example.com pour Lyon."],
      ["a smiley", "Bonjour :) à tous."],
      ["a mark already spaced", "Bonjour ! Ça va ?"],
      ["a no-break space already there", `Bonjour${NB}! Ça va${NB}?`],
      ["guillemets already spaced", `Il dit «${NB}bonjour${NB}».`],
      ["plain spaces, which show the same", "Il dit « bonjour »."],
    ])("leaves %s", (_, text) => {
      expect(scan(text, "fr")).toEqual([]);
    });

    it("is for French only", () => {
      expect(scan("Hello! How are you? Fine: thanks.", "en")).toEqual([]);
    });

    it("leaves a paragraph that shows another language", () => {
      expect(
        scan(
          "Thanks for your help today: great job everyone! See you Monday?",
          "fr",
        ),
      ).toEqual([]);
      expect(scan("¿Quieres venir? Sí, claro: mañana!", "fr")).toEqual([]);
      expect(
        fixed(
          "Bonjour à tous, voici le compte rendu de lundi: les dates sont fixées et le budget est validé.\n\nHello everyone: here is the summary.",
          "fr",
        ),
      ).toBe(
        `Bonjour à tous, voici le compte rendu de lundi${NB}: les dates sont fixées et le budget est validé.\n\nHello everyone: here is the summary.`,
      );
    });

    it("keeps short French that shows nothing either way", () => {
      expect(fixed("Merci beaucoup!", "fr")).toBe(`Merci beaucoup${NB}!`);
    });

    it("leaves what is said inside the guillemets", () => {
      expect(fixed(`Il dit «${NB}quoi?${NB}» ici.`, "fr")).toBe(
        `Il dit «${NB}quoi?${NB}» ici.`,
      );
    });

    it("makes one edit of a one-word quotation", () => {
      expect(originals(scan("Il dit «bonjour».", "fr"))).toEqual([
        "«bonjour».",
      ]);
    });

    it.each([
      ["a span between backticks", "Insérez le champ `«Prénom»` en tête."],
      ["a pattern", "Le motif `/«([^»]+)»/` trouve les citations."],
      ["one edge", "Remplacez `x»` par autre chose."],
      ["the marks alone", "Tapez `«` pour ouvrir et `»` pour fermer."],
      ["a fenced block", "Voici le code :\n\n```\nprint(«bonjour»)\n```"],
    ])("leaves the guillemets of code: %s", (_, text) => {
      expect(scan(text, "fr")).toEqual([]);
    });

    it("still spaces a quotation, outside the code it holds", () => {
      expect(fixed("Il dit «bonjour», puis tapez `«x»`.", "fr")).toBe(
        `Il dit «${NB}bonjour${NB}», puis tapez \`«x»\`.`,
      );
      expect(fixed("Tapez «`npm install`» dans le terminal.", "fr")).toBe(
        `Tapez «${NB}\`npm install\`${NB}» dans le terminal.`,
      );
    });
  });

  describe("a long text", () => {
    const within = (ms: number, run: () => unknown) => {
      const start = performance.now();
      run();
      expect(performance.now() - start).toBeLessThan(ms);
    };
    const filled = (unit: string) =>
      unit
        .repeat(Math.ceil(MAX_CHECK_CHARS / unit.length))
        .slice(0, MAX_CHECK_CHARS);

    it("takes a limit far above what a rewrite takes", () => {
      expect(MAX_CHECK_CHARS).toBeGreaterThanOrEqual(50_000);
    });

    it.each([
      [
        "ordinary prose",
        "We walked to the sea and talked about nothing much. ",
      ],
      ["phrases everywhere", "Moreover, we met in order to talk.  "],
      ["quotation marks that never close", "\u201c"],
      ["guillemets that never close", "«"],
      ["straight quotes", '" '],
      ["straight single quotes around apostrophes", "'can't "],
      ["backticks", "`a"],
      ["code fences", "```\n"],
      ["list marks", "- "],
      ["dashes", "-"],
      ["stars", "*"],
      ["blanks", " "],
      ["line breaks", "\n"],
      ["one long word", "a"],
      ["invisible characters", "\u200b"],
      ["openings of sentences", "in "],
    ])("stays responsive on %s", (_, unit) => {
      within(1500, () => scanText(filled(unit), "en"));
      within(1500, () => scanText(filled(unit), "fr"));
    });

    it("stays responsive with a phrase word ahead of a run of blanks", () => {
      within(1500, () => scanText(`il${" ".repeat(49_998)}`, "fr"));
      const spread = "it is important to note".split(" ").join(" ".repeat(40));
      within(1500, () => scanText(`${spread}${" ".repeat(40)}zzz`, "en"));
    });
  });

  describe("the comparison texts", () => {
    const { texts }: { texts: { id: string; locale: Lang; text: string }[] } =
      JSON.parse(
        readFileSync(
          path.join(__dirname, "../../docs/research/comparison-texts.json"),
          "utf8",
        ),
      );

    // Written to hold such phrases, so these show the list works and say nothing of how often it would
    it.each([
      ["en-port", 4],
      ["en-sleep", 1],
      ["en-tram", 0],
      ["en-dairy", 2],
      ["en-school", 1],
      ["en-wind", 3],
      ["fr-budget", 4],
      ["fr-train", 3],
      ["fr-sante", 1],
      ["fr-cooperative", 2],
      ["fr-lycee", 1],
      ["fr-solaire", 1],
    ])("%s gives %i edits", (id, count) => {
      const { text, locale } = texts.find((entry) => entry.id === id)!;
      const edits = scan(text, locale);
      expect(edits).toHaveLength(count);
      for (const edit of edits) {
        expect(text.slice(edit.start, edit.end)).toBe(edit.original);
        expect(whyDrop(edit)).toBeNull();
      }
    });
  });
});
