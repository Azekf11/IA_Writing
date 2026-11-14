import { describe, expect, it } from "vitest";
import { KNOWN_ERROR_CODES } from "@/lib/rewrite/client";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

// Flatten nested messages into dotted keys, e.g. "Home.title"
function entries(obj: object, prefix = ""): [string, string][] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? entries(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)] as [string, string]],
  );
}

describe("messages", () => {
  it("has the same keys in en and fr", () => {
    const keys = (m: object) =>
      entries(m)
        .map(([key]) => key)
        .sort();
    expect(keys(fr)).toEqual(keys(en));
  });

  it("has no empty translation", () => {
    for (const messages of [en, fr]) {
      const empty = entries(messages).filter(([, value]) => !value.trim());
      expect(empty).toEqual([]);
    }
  });

  // French spaces these marks off from the word before them, with a space a line cannot break at:
  // the mark would otherwise start the next line on its own
  it("keeps each French colon, semicolon, question and exclamation mark with its word", () => {
    const breakable = entries(fr)
      .filter(([, value]) => / [:;?!](?=[\s}]|$)/.test(value))
      .map(([key]) => key);
    expect(breakable).toEqual([]);
  });

  it("uses the same placeholders in both languages", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]).sort();
    const french = new Map(entries(fr));
    for (const [key, value] of entries(en)) {
      expect(placeholders(french.get(key) ?? ""), key).toEqual(
        placeholders(value),
      );
    }
  });

  it("has a message for every error code, in both languages", () => {
    for (const code of KNOWN_ERROR_CODES) {
      for (const messages of [en, fr]) {
        expect(messages.Errors[code], code).toBeTruthy();
      }
    }
  });

  it("says trying again is no use while rewriting is unavailable, and that the attempt counted", () => {
    expect(en.Errors.provider_unavailable).toContain("won't help");
    expect(en.Errors.provider_unavailable).toContain(
      "count toward today's limit",
    );
    expect(fr.Errors.provider_unavailable).toContain(
      "Inutile de r\u00e9essayer",
    );
    expect(fr.Errors.provider_unavailable).toContain(
      "comptent dans la limite du jour",
    );
  });

  it("blames nobody for that, and promises no date", () => {
    for (const messages of [en, fr]) {
      expect(messages.Errors.provider_unavailable).not.toMatch(
        /credit|cr\u00e9dit|anthropic|account|compte\b|tomorrow|demain|soon|bient\u00f4t|\d/i,
      );
    }
  });

  it("says no suggestion passed the checks and that the attempt counted, without asking to retry", () => {
    expect(en.Errors.no_usable_edit).toContain("passed our checks");
    expect(en.Errors.no_usable_edit).toContain("counts toward today's limit");
    expect(en.Errors.no_usable_edit).not.toMatch(/try again/i);
    expect(fr.Errors.no_usable_edit).toContain("nos contr\u00f4les");
    expect(fr.Errors.no_usable_edit).toContain("compte dans la limite du jour");
    expect(fr.Errors.no_usable_edit).not.toMatch(/r\u00e9essa/i);
  });

  // The route also refuses half a character in the text or the writing sample, and a body this page
  // would not send: the message has to hold for each cause, not put it down to the length
  it("words a refused request so that it holds whatever the cause", () => {
    for (const [messages, limits, characters, blame] of [
      [en, /limits/, /unusual characters/, /this text|its length/i],
      [fr, /limites/, /caractère inhabituel/, /ce texte|sa longueur/i],
    ] as const) {
      expect(messages.Errors.invalid_request).toMatch(limits);
      expect(messages.Errors.invalid_request).toMatch(characters);
      expect(messages.Errors.invalid_request).not.toMatch(blame);
    }
  });

  // The count is per UTC day, so "tomorrow" is wrong for part of every night
  it("says when the daily limit comes back", () => {
    expect(en.Errors.quota_exceeded).toContain("midnight UTC");
    expect(en.Errors.quota_exceeded).not.toMatch(/tomorrow/i);
    expect(fr.Errors.quota_exceeded).toContain("minuit UTC");
    expect(fr.Errors.quota_exceeded).not.toMatch(/demain/i);
  });

  // The excerpts leave the server for Anthropic: the text must never say otherwise again
  it("says where the style excerpts and the writing sample go", () => {
    expect(en.Home.sourcesBody).toContain("sent to Anthropic");
    expect(fr.Home.sourcesBody).toContain("envoy\u00e9s \u00e0 Anthropic");
    expect(en.Privacy.ai).toMatch(/writing sample.*excerpts/);
    expect(fr.Privacy.ai).toMatch(
      /extrait d'\u00e9criture.*extraits du corpus/,
    );
  });

  // What the privacy page says with STYLE_REFERENCES=off
  it("says nothing of excerpts when they are off, and the rest stays", () => {
    expect(en.Privacy.aiWithoutExcerpts).not.toMatch(/excerpt/i);
    expect(fr.Privacy.aiWithoutExcerpts).not.toMatch(/corpus|extraits/i);
    for (const messages of [en, fr]) {
      const [opening, ...rest] = messages.Privacy.ai.split(". ");
      expect(messages.Privacy.aiWithoutExcerpts).toContain(rest.join(". "));
      expect(
        opening.startsWith(messages.Privacy.aiWithoutExcerpts.slice(0, 40)),
      ).toBe(true);
    }
  });
  // One word for one thing: "correction" says the text had mistakes, which is not the promise
  it("calls an edit a modification all over the French interface", () => {
    const others = entries(fr).filter(([, value]) =>
      /correction|corrig/i.test(value),
    );
    expect(others).toEqual([]);
  });

  it("says what the intensity levels change, in the page's own words", () => {
    for (const hint of Object.values(en.Editor.strengthHint)) {
      expect(hint).not.toMatch(/\btells?\b/i);
      expect(hint).toMatch(/stock phrases/i);
    }
    for (const hint of Object.values(fr.Editor.strengthHint)) {
      expect(hint).not.toMatch(/\bsignes?\b/i);
      expect(hint).toMatch(/formules/i);
    }
  });

  it("says that suggestions arrived, not that something happened", () => {
    expect(fr.Review.cutShort).not.toContain("ce qui est arriv\u00e9");
    expect(fr.Review.cutShort).toContain("suggestions re\u00e7ues");
  });

  // The review only opens once a first edit has arrived
  it("has no wording for zero edits so far", () => {
    expect(en.Review.found).not.toContain("=0");
    expect(fr.Review.found).not.toContain("=0");
  });

  // localStorage, for up to an hour: the one place a typed text sits before any rewrite
  it("says what is kept when a sign-in link is asked for, and until when", () => {
    expect(en.Privacy.data).toContain("a copy of the text in the editor");
    expect(en.Privacy.data).toContain("Your writing sample is left out");
    expect(en.Privacy.data).toMatch(/when you sign out, or, after an hour/);
    expect(fr.Privacy.data).toContain("une copie du texte de l'\u00e9diteur");
    expect(fr.Privacy.data).toContain(
      "Votre extrait d'\u00e9criture n'en fait pas partie",
    );
    expect(fr.Privacy.data).toMatch(
      /quand vous vous d\u00e9connectez, ou, pass\u00e9 une heure/,
    );
  });

  it("still says the writing sample is not stored", () => {
    expect(en.Privacy.data).toContain("Your writing sample is not stored.");
    expect(fr.Privacy.data).toContain(
      "Votre extrait d'\u00e9criture n'est pas conserv\u00e9.",
    );
  });

  // Both are on the history page now, and nobody has to be asked for them
  it("says the reader can download the history and delete the account themselves", () => {
    expect(en.Privacy.data).toContain("download your whole history");
    expect(en.Privacy.data).toContain(
      "delete your account, which you can do yourself",
    );
    expect(fr.Privacy.data).toContain(
      "t\u00e9l\u00e9charger tout votre historique",
    );
    expect(fr.Privacy.data).toContain(
      "supprimiez votre compte, ce que vous pouvez faire vous-m\u00eame",
    );
  });

  // Supabase Auth keeps its own log, with the address in it, and deleting the account does not
  // reach it
  it("says in both languages that the sign-in log is not erased with the account", () => {
    expect(en.Privacy.data).toContain("is not removed with the account");
    expect(fr.Privacy.data).toContain("n'est pas effacé avec le compte");
  });

  // It names the address when the account is created, at each link asked for, each sign-in and
  // sign-out, each renewal of the session, which comes on its own while the site is in use, and at
  // the deletion: not only at each sign-in
  it("says in both languages each time the sign-in log names the address", () => {
    const sentence = (text: string, start: string) => {
      const from = text.indexOf(start);
      expect(from).toBeGreaterThan(-1);
      return text.slice(from, text.indexOf(".", from));
    };
    const english = sentence(
      en.Privacy.data,
      "The sign-in service keeps its own log",
    );
    for (const moment of [
      "when your account is created",
      "each time you ask for a sign-in link, sign in or sign out",
      "each time your session is renewed automatically while you use the site",
      "when your account is deleted",
    ])
      expect(english).toContain(moment);
    const french = sentence(
      fr.Privacy.data,
      "Le service de connexion tient son propre journal",
    );
    for (const moment of [
      "à la création de votre compte",
      "à chaque demande de lien de connexion",
      "à chaque connexion et déconnexion",
      "à chaque renouvellement automatique de votre session pendant que vous utilisez le site",
      "à la suppression de votre compte",
    ])
      expect(french).toContain(moment);
  });

  // The question says what cannot be taken back, including what the site has no hold on
  it("says before an account goes that it is final, and what stays with Anthropic", () => {
    expect(en.Account.deleteConfirm).toMatch(
      /cannot be undone.*Anthropic.*own terms/,
    );
    expect(fr.Account.deleteConfirm).toMatch(
      /d\u00e9finitive.*Anthropic.*propres conditions/,
    );
  });

  it("says at the point of use where the text goes and how long it stays", () => {
    expect(en.Editor.notice).toMatch(/Anthropic.*history until you delete it/);
    expect(fr.Editor.notice).toMatch(
      /Anthropic.*historique jusqu'\u00e0 ce que vous le supprimiez/,
    );
  });

  describe("the choice not to keep a text", () => {
    it("is described on the privacy page in the words of the box", () => {
      expect(en.Privacy.data).toContain(`"${en.Editor.dontKeep}"`);
      expect(fr.Privacy.data).toContain(
        `\u00ab\u00a0${fr.Editor.dontKeep}\u00a0\u00bb`,
      );
    });

    // Fewer copies at Rewrity, and no fewer anywhere else
    it("claims no more than it does, on the privacy page", () => {
      expect(en.Privacy.data).toMatch(/still counts.*still goes to Anthropic/);
      expect(fr.Privacy.data).toMatch(
        /compte quand m\u00eame.*tout de m\u00eame envoy\u00e9 \u00e0 Anthropic/,
      );
    });

    it("says beside the box what it does not do", () => {
      expect(en.Editor.dontKeepHint).toMatch(
        /still goes to Anthropic.*still counts.*only on this page/,
      );
      expect(fr.Editor.dontKeepHint).toMatch(
        /tout de m\u00eame envoy\u00e9 \u00e0 Anthropic.*compte quand m\u00eame.*que sur cette page/,
      );
    });

    it("keeps the rest of the notice under the editor while ticked", () => {
      for (const messages of [en, fr]) {
        expect(messages.Editor.noticeNotKept).toContain("Anthropic");
        expect(messages.Editor.noticeNotKept).toContain(
          `<privacy>${messages.Footer.privacy}</privacy>`,
        );
      }
      expect(en.Editor.noticeNotKept).toContain(
        "The free check runs in your browser and sends nothing.",
      );
      expect(fr.Editor.noticeNotKept).toContain(
        "La v\u00e9rification gratuite se fait dans votre navigateur et n'envoie rien.",
      );
    });

    it("says the kept copy for a sign-in holds the choice", () => {
      expect(en.Privacy.data).toContain("of your choice not to keep the text");
      expect(fr.Privacy.data).toContain(
        "de l'option de ne pas conserver le texte",
      );
    });
  });

  // The site-wide ceilings can stop an attempt sooner: the number must read as a ceiling
  it("never words the attempts as a promise", () => {
    expect(en.Allowance.visitor).toMatch(/^Up to /);
    expect(en.Allowance.member).toContain("up to # of {limit}");
    expect(fr.Allowance.visitor).toMatch(/^Jusqu'\u00e0 /);
    expect(fr.Allowance.member).toContain("au plus #");
  });

  it("promises no date for the end of a pause", () => {
    expect(en.Allowance.paused).not.toMatch(/soon|tomorrow|\d/i);
    expect(fr.Allowance.paused).not.toMatch(/bient\u00f4t|demain|\d/i);
  });

  it("says that an account is needed and that asking for a link creates one", () => {
    expect(en.Auth.accountNote).toMatch(/need an account.*link creates one/);
    expect(fr.Auth.accountNote).toMatch(
      /Il faut un compte.*vous en cr\u00e9ez un/,
    );
  });

  it("links both notes to the privacy page, in both languages", () => {
    for (const messages of [en, fr]) {
      for (const note of [messages.Editor.notice, messages.Auth.accountNote]) {
        expect(note).toContain(`<privacy>${messages.Footer.privacy}</privacy>`);
      }
    }
  });

  it("has a short name for the writing sample, in both languages", () => {
    expect(en.Editor.voice).toContain(en.Editor.voiceShort);
    expect(fr.Editor.voice).toContain(fr.Editor.voiceShort);
  });

  it("compares the items of a list, not only its length", () => {
    const keys = entries(en).map(([key]) => key);
    expect(keys).toContain("Editor.exampleEdits.0.reason");
    expect(keys).toContain("Editor.exampleEdits.4.original");
    expect(new Map(entries(fr)).get("Editor.exampleEdits.0.reason")).toBe(
      fr.Editor.exampleEdits[0].reason,
    );
  });

  describe("what the example and the free check say", () => {
    const allOf = (messages: typeof en) => [
      messages.Editor.check,
      messages.Review.leaveSample,
      messages.Review.checkNoEdits,
      messages.Review.checkMore,
      ...Object.values(messages.Review.sourceNotice),
      ...Object.values(messages.Review.checkReason),
      ...messages.Editor.exampleEdits.map((edit) => edit.reason),
    ];

    it.each([
      ["en", en],
      ["fr", fr],
    ] as const)(
      "claims nothing about who wrote a text, in %s",
      (_, messages) => {
        for (const message of allOf(messages)) {
          expect(message).not.toMatch(
            /\bAI\b|\bIA\b|artificial|artificielle|detect|d\u00e9tect|human|humain|robot|machine|\bscore|\bauthor|\bauteur|written by|\u00e9crit par|\bprove|\bprouv|\blikely|probab|\bpercent|%/i,
          );
        }
      },
    );

    it("says nothing was sent, no attempt was used and there is no history row", () => {
      for (const notice of Object.values(en.Review.sourceNotice)) {
        expect(notice).toContain(
          "Nothing was sent, no attempt was used and nothing goes to your history.",
        );
      }
      for (const notice of Object.values(fr.Review.sourceNotice)) {
        expect(notice).toContain(
          "Rien n'a \u00e9t\u00e9 envoy\u00e9, aucune tentative n'a \u00e9t\u00e9 utilis\u00e9e et rien ne va dans votre historique.",
        );
      }
    });

    // A phrase list cannot tell an actor's role from a figurative one, so the reason asks rather than asserts
    it("does not claim that plainer words for inflated wording say the same thing", () => {
      expect(en.Review.checkReason.inflated).not.toMatch(/same thing/i);
      expect(fr.Review.checkReason.inflated).not.toMatch(/la même chose/i);
    });

    it("names the button it sends the writer to, as that button reads", () => {
      expect(en.Review.checkMore).toContain(en.Review.editResult);
      expect(fr.Review.checkMore).toContain(fr.Review.editResult);
    });

    // A list that found nothing says little: "reads naturally" would be a verdict on the text
    it("does not call a text natural because a short list found nothing", () => {
      expect(en.Review.checkNoEdits).not.toBe(en.Review.noEdits);
      expect(fr.Review.checkNoEdits).not.toBe(fr.Review.noEdits);
      expect(en.Review.checkNoEdits).not.toMatch(/natural|\bgood\b|\bfine\b/i);
      expect(fr.Review.checkNoEdits).not.toMatch(/naturel|bon\b|bien\b/i);
      expect(en.Review.checkNoEdits).toMatch(/list is short/);
      expect(fr.Review.checkNoEdits).toMatch(/Elle est courte/);
    });

    it("tells the writer at the point of use, and on the privacy page, that it stays in the browser", () => {
      const sentence = "The free check runs in your browser and sends nothing.";
      const phrase =
        "La v\u00e9rification gratuite se fait dans votre navigateur et n'envoie rien.";
      expect(en.Editor.notice).toContain(sentence);
      expect(fr.Editor.notice).toContain(phrase);
      expect(en.Privacy.ai).toContain(sentence);
      expect(fr.Privacy.ai).toContain(phrase);
      expect(en.Privacy.aiWithoutExcerpts).toContain(sentence);
      expect(fr.Privacy.aiWithoutExcerpts).toContain(phrase);
    });
  });
});
