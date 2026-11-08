import { describe, expect, it } from "vitest";
import { applyEdits } from "@/lib/rewrite/apply";
import { locateEdits } from "@/lib/rewrite/locate";

const edit = (original: string, replacement = "X") => ({
  original,
  replacement,
  reason: "r",
});

describe("locateEdits", () => {
  it("computes offsets from the quote", () => {
    const text = "Hello brave new world";
    const [result] = locateEdits(text, [edit("brave new")]);
    expect(result.start).toBe(6);
    expect(result.end).toBe(15);
    expect(text.slice(result.start, result.end)).toBe("brave new");
  });

  it("drops quotes that are not in the text", () => {
    expect(locateEdits("Hello world", [edit("goodbye")])).toEqual([]);
  });

  it("drops no-op and empty edits", () => {
    const result = locateEdits("Hello world", [
      edit("Hello", "Hello"),
      edit("", "x"),
    ]);
    expect(result).toEqual([]);
  });

  it("uses the next free occurrence for repeated quotes", () => {
    const result = locateEdits("go go go", [edit("go"), edit("go")]);
    expect(result.map((e) => e.start)).toEqual([0, 3]);
  });

  it("drops edits that overlap an earlier one", () => {
    const result = locateEdits("one two three", [
      edit("one two"),
      edit("two three"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("one two");
  });

  it("sorts by position and assigns stable ids", () => {
    const result = locateEdits("alpha beta gamma", [
      edit("gamma"),
      edit("alpha"),
    ]);
    expect(result.map((e) => [e.id, e.original])).toEqual([
      ["edit-0", "alpha"],
      ["edit-1", "gamma"],
    ]);
  });

  it("handles accents and multi-byte characters", () => {
    const text = "Café ☕ au lait";
    const [result] = locateEdits(text, [edit("au lait")]);
    expect(text.slice(result.start, result.end)).toBe("au lait");
  });

  it("finds a quote the model retyped with straight quotes", () => {
    const text = "She said “it’s fine” and left.";
    const [result] = locateEdits(text, [edit('said "it\'s fine"')]);
    expect(text.slice(result.start, result.end)).toBe("said “it’s fine”");
    // The edit now carries the exact original text, so the diff lines up
    expect(result.original).toBe("said “it’s fine”");
  });

  it("finds a quote whose line break was replaced by a space", () => {
    const text = "first line\nsecond line continues here";
    const [result] = locateEdits(text, [edit("line second line")]);
    expect(text.slice(result.start, result.end)).toBe("line\nsecond line");
  });

  it("finds a quote the model typed with a plain space", () => {
    const text = "Le prix : 5 euros";
    const [result] = locateEdits(text, [
      edit("prix : 5 euros", "tarif : 5 euros"),
    ]);
    expect(text.slice(result.start, result.end)).toBe("prix : 5 euros");
  });

  it("finds a quote across the kinds of no-break space and hyphen", () => {
    const text = "Un co\u2011auteur, 5\u202f000 euros\u00a0: voil\u00e0.";
    const [result] = locateEdits(text, [
      edit(
        "co-auteur, 5 000 euros : voil\u00e0",
        "coauteur, 5 000 euros : oui",
      ),
    ]);
    expect(text.slice(result.start, result.end)).toBe(
      "co\u2011auteur, 5\u202f000 euros\u00a0: voil\u00e0",
    );
  });

  it("finds a quote the model typed with curly quotes where the text has straight ones", () => {
    const text = 'He said "no" twice.';
    const [result] = locateEdits(text, [edit("said \u201cno\u201d")]);
    expect(result.original).toBe('said "no"');
  });

  it("does not double the spaces when a loose match leaves out the quote's outer spaces", () => {
    const text = "It is\u00a0crucial to act.";
    const [result] = locateEdits(text, [
      edit(" is crucial to ", " matters to "),
    ]);
    expect(result.original).toBe("is\u00a0crucial to");
    expect(result.replacement).toBe("matters to");
    expect(
      text.slice(0, result.start) + result.replacement + text.slice(result.end),
    ).toBe("It matters to act.");
  });

  it("keeps a replacement's outer space on a loose match when a word comes next and the text has no space there", () => {
    const text = "It works\u2014and it is fast.";
    const [result] = locateEdits(text, [edit(" \u2014 ", ", ")]);
    expect(result.replacement).toBe(", ");
    expect(
      text.slice(0, result.start) + result.replacement + text.slice(result.end),
    ).toBe("It works, and it is fast.");
  });

  it.each([
    ["It works\u2014\u201cfast\u201d they say.", ", ", ", "],
    ["They call it \u201cnormal\u201d\u2014a phrase.", " and ", " and "],
    ["Up 12%\u2014a record.", " and ", " and "],
  ])(
    "keeps a loose replacement's outer space beside what closes or opens a word: %s",
    (text, replacement, kept) => {
      const [result] = locateEdits(text, [edit(" \u2014 ", replacement)]);
      expect(result.replacement).toBe(kept);
    },
  );

  it("keeps both outer spaces of a loose replacement where the text has neither", () => {
    const text = "It was black\u2014white.";
    const [result] = locateEdits(text, [edit(" \u2014 ", " and ")]);
    expect(result.replacement).toBe(" and ");
  });

  it("does not put a replacement's outer space before punctuation on a loose match", () => {
    const text = "It is\u00a0very good, ok";
    const [result] = locateEdits(text, [edit(" is very good ", " is great ")]);
    expect(result.replacement).toBe("is great");
  });

  it("keeps a replacement as written on an exact match", () => {
    const [result] = locateEdits("It is crucial to act.", [
      edit(" is crucial", " matters"),
    ]);
    expect(result.replacement).toBe(" matters");
  });

  it("uses the first free occurrence when a loose quote repeats", () => {
    const text = "bon\u00a0jour et bon\u00a0jour";
    const result = locateEdits(text, [edit("bon jour"), edit("bon jour")]);
    expect(result.map((e) => e.start)).toEqual([0, 12]);
  });

  it("drops a quote when a third identical edit finds no free occurrence", () => {
    const result = locateEdits("go go", [edit("go"), edit("go"), edit("go")]);
    expect(result).toHaveLength(2);
  });

  // Dropping is safe: the user loses a suggestion, never gets a wrong one
  it("drops rather than guesses when the punctuation differs beyond the folding table", () => {
    expect(
      locateEdits("Attendez\u2026 oui.", [edit("Attendez... oui")]),
    ).toEqual([]);
    expect(locateEdits("A \u2013 B", [edit("A - B")])).toEqual([]);
  });

  it("never lands inside a longer word", () => {
    const [key] = locateEdits("The monkey holds the key.", [
      edit("key", "main"),
    ]);
    expect(key.start).toBe(21);

    const fr = "C'est essentiellement faux, et c'est essentiel.";
    const [word] = locateEdits(fr, [edit("essentiel", "primordial")]);
    expect(word.start).toBe(fr.lastIndexOf("essentiel"));
  });

  it("drops a quote found only inside a longer word, accents and digits included", () => {
    expect(locateEdits("Its vitality matters.", [edit("vital")])).toEqual([]);
    expect(locateEdits("Un été", [edit("t")])).toEqual([]);
    expect(locateEdits("in 12019 only", [edit("2019")])).toEqual([]);
  });

  it("counts a combining accent as part of its letter", () => {
    const text = "C'est me\u0302me pour me\u0301";
    expect(locateEdits(text, [edit("me")])).toEqual([]);
    const other = "C'est me\u0302me pour me et toi";
    const [found] = locateEdits(other, [edit("me")]);
    expect(found.start).toBe(other.lastIndexOf("me"));
  });

  it("reads a letter that takes two code units as one letter", () => {
    const text = "\ud835\udcb3key and key";
    const [found] = locateEdits(text, [edit("key")]);
    expect(found.start).toBe(text.lastIndexOf("key"));
  });

  it("treats an apostrophe or a hyphen as the edge of a word", () => {
    const text = "Bref, d'ajouter est bien-être.";
    const result = locateEdits(text, [edit("ajouter"), edit("être")]);
    expect(result.map((e) => e.original)).toEqual(["ajouter", "être"]);
  });

  it("applies the same rule to a loose match", () => {
    const text = "The monkey\u00a0bars and the key\u00a0bars";
    const [found] = locateEdits(text, [edit("key bars")]);
    expect(found.start).toBe(text.lastIndexOf("key"));
  });

  it("does not match across a missing space", () => {
    expect(locateEdits("It is notable here", [edit("not able")])).toEqual([]);
    expect(locateEdits("It is at home", [edit("a t")])).toEqual([]);
  });

  it("keeps two edits that touch without overlapping", () => {
    const result = locateEdits("ab-cd", [edit("ab"), edit("-cd")]);
    expect(result.map((e) => [e.start, e.end])).toEqual([
      [0, 2],
      [2, 5],
    ]);
  });

  it("drops a quote made only of spaces", () => {
    expect(locateEdits("a b", [edit("   ")])).toEqual([]);
  });

  it("replaces a space the model quoted on its own", () => {
    const [found] = locateEdits("a b", [edit(" ")]);
    expect([found.start, found.end]).toEqual([1, 2]);
  });

  it("takes a deleted quote's outer space along on a loose match", () => {
    const text = "Bref, il est important d\u2019ajouter que le projet avance.";
    const [found] = locateEdits(text, [
      edit("il est important d'ajouter que ", ""),
    ]);
    expect(text.slice(0, found.start) + text.slice(found.end)).toBe(
      "Bref, le projet avance.",
    );
  });

  it("takes the space on the other side when another edit holds that one", () => {
    const result = locateEdits("a b\u2019c d", [
      edit(" d", ""),
      edit("b'c ", ""),
    ]);
    expect(result.map((e) => [e.start, e.end])).toEqual([
      [1, 5],
      [5, 7],
    ]);
  });

  const decide = (edits: { id: string }[]) =>
    Object.fromEntries(edits.map((e) => [e.id, "accepted" as const]));

  // What the reader gets after accepting the edit, when it was located at all
  const accepted = (text: string, raw: ReturnType<typeof edit>) => {
    const edits = locateEdits(text, [raw]);
    return edits.length === 0 ? null : applyEdits(text, edits, decide(edits));
  };

  describe("a deletion leaves clean spacing behind", () => {
    it.each([
      [
        "a sentence",
        "We shipped on Friday. Let that sink in. The team can rest.",
        "Let that sink in.",
        "We shipped on Friday. The team can rest.",
      ],
      [
        "a paragraph",
        "First para.\n\nA closer that repeats.\n\nLast para.",
        "A closer that repeats.",
        "First para.\n\nLast para.",
      ],
      ["a word", "It is very good.", "very", "It is good."],
      [
        "a paragraph's last sentence",
        "One. Delete me.\n\nNext para.",
        "Delete me.",
        "One.\n\nNext para.",
      ],
      [
        "a paragraph's first sentence",
        "One.\n\nDelete me. Next.",
        "Delete me.",
        "One.\n\nNext.",
      ],
      ["the opening", "Great news. We shipped.", "Great news.", "We shipped."],
      ["the closing", "We shipped. Great news.", "Great news.", "We shipped."],
      ["a quote with its space", "It is very good.", "very ", "It is good."],
      [
        "a quote with its other space",
        "It is very good.",
        " very",
        "It is good.",
      ],
      [
        "before punctuation",
        "We shipped it, really.",
        ", really",
        "We shipped it.",
      ],
      ["the whole text", "Only this.", "Only this.", ""],
      ["a quote with both spaces", "It is very good.", " very ", "It is good."],
      [
        "a French quote with both spaces",
        "C'est vraiment bien fait.",
        " vraiment ",
        "C'est bien fait.",
      ],
      [
        "a sentence with both spaces",
        "We shipped. Let that sink in. The team rests.",
        " Let that sink in. ",
        "We shipped. The team rests.",
      ],
      [
        "a word between figures",
        "From 2019 to 2021.",
        " to ",
        "From 2019 2021.",
      ],
      ["the last word", "It works well indeed.", "indeed", "It works well."],
      [
        "a word before a comma",
        "Cela marche vraiment, et vite.",
        "vraiment",
        "Cela marche, et vite.",
      ],
      ["a word before a mark", "Is it good enough?", "enough", "Is it good?"],
      [
        "a word before a French mark, which keeps its space",
        "C'est vraiment bien !",
        "bien",
        "C'est vraiment !",
      ],
      ["a word before a bracket", "(one two) three", "two", "(one) three"],
      [
        "a word after a bracket",
        "It works (very well) here.",
        "very",
        "It works (well) here.",
      ],
      [
        "a word after a quotation mark",
        'She said "very well" twice.',
        "very",
        'She said "well" twice.',
      ],
      [
        "a word before a closing quotation mark",
        'She said "well very" twice.',
        "very",
        'She said "well" twice.',
      ],
      [
        "a word before a hyphen, which stays",
        "It is very-good.",
        "very",
        "It is -good.",
      ],
    ])("%s", (_case, text, quote, result) => {
      expect(accepted(text, edit(quote, ""))).toBe(result);
    });

    it.each([
      [
        "a quote holding one line break of two",
        "First one.\n\nSecond.",
        "one.\n",
        "First\n\nSecond.",
      ],
      [
        "a quote holding the line break before it",
        "A.\n\nB. C.\n\nD.",
        "\nB.",
        "A.\n\nC.\n\nD.",
      ],
      [
        "a quote holding the space before a line break",
        "One. Two. \nNext.",
        "Two. ",
        "One.\nNext.",
      ],
      ["a loose quote between paragraphs", "A.\n\nB.\n\nC.", " B.", "A.\n\nC."],
      ["a loose quote opening a paragraph", "A.\n\nB. C.", " B.", "A.\n\nC."],
      [
        "a line after a paragraph break",
        "First para.\n\nDelete me.\nNext line.",
        "Delete me.",
        "First para.\n\nNext line.",
      ],
      [
        "a line before a paragraph break",
        "One.\nDelete me.\n\nNext para.",
        "Delete me.",
        "One.\n\nNext para.",
      ],
      [
        "a word opening a line, before a comma",
        "One.\nvery, then.",
        "very",
        "One.\n, then.",
      ],
      [
        "a quote holding the whole break",
        "One. Delete me.\n\nNext para.",
        "Delete me.\n\n",
        "One.\n\nNext para.",
      ],
      [
        "a paragraph quoted with both breaks",
        "A\n\nB\n\nC",
        "\n\nB\n\n",
        "A\n\nC",
      ],
    ])("keeps the line break: %s", (_case, text, quote, result) => {
      expect(accepted(text, edit(quote, ""))).toBe(result);
    });

    it("treats spaces in place of a word as a deletion", () => {
      expect(accepted("It is very good.", edit("very", " "))).toBe(
        "It is good.",
      );
      const [found] = locateEdits("It is very good.", [edit("very", " ")]);
      expect(found.replacement).toBe("");
    });

    it.each([
      ["It works\u2014and it is fast.", "\u2014", "It works and it is fast."],
      [
        "We shipped\u2014after months of work\u2014on Friday.",
        "\u2014after months of work\u2014",
        "We shipped on Friday.",
      ],
      [
        "Il est parti\u2013sans un mot\u2013hier.",
        "\u2013sans un mot\u2013",
        "Il est parti hier.",
      ],
      // Typed with spaces the text does not have
      ["It works\u2014and it is fast.", " \u2014 ", "It works and it is fast."],
      [
        "It works \u2014 and it is fast.",
        " \u2014 ",
        "It works and it is fast.",
      ],
    ])(
      "keeps a space written where nothing else keeps two words apart: %s",
      (text, quote, result) => {
        expect(accepted(text, edit(quote, " "))).toBe(result);
      },
    );

    it.each([
      [
        "Sales rose 12%\u2014a record year.",
        "\u2014",
        "Sales rose 12% a record year.",
      ],
      [
        "Sales rose 12%\u2014a record\u2014in 2019.",
        "\u2014a record\u2014",
        "Sales rose 12% in 2019.",
      ],
      ["Cost 5 \u20ac\u2014a bargain.", "\u2014", "Cost 5 \u20ac a bargain."],
      [
        "It works\u2014(and it is fast).",
        "\u2014",
        "It works (and it is fast).",
      ],
      ["It works (well)\u2014and fast.", "\u2014", "It works (well) and fast."],
      ["Why not?\u2014he asked.", "\u2014", "Why not? he asked."],
      ["Stop!\u2014he said.", "\u2014", "Stop! he said."],
      [
        "The \u201cnew normal\u201d\u2014a phrase.",
        "\u2014",
        "The \u201cnew normal\u201d a phrase.",
      ],
      [
        "He said\u2014\u201cnever\u201d.",
        "\u2014",
        "He said \u201cnever\u201d.",
      ],
      [
        "Il dit \u00ab non \u00bb\u2014sans un mot\u2014hier.",
        "\u2014sans un mot\u2014",
        "Il dit \u00ab non \u00bb hier.",
      ],
      ["He paid\u2014$5 in all.", "\u2014", "He paid $5 in all."],
    ])(
      "keeps it between what closes a word and what opens one: %s",
      (text, quote, result) => {
        expect(accepted(text, edit(quote, " "))).toBe(result);
      },
    );

    it.each([
      // Before punctuation, and inside quote marks or brackets, the deletion stays clean
      ["Is it good enough?", "enough", "Is it good?"],
      ["A great idea indeed!", "indeed", "A great idea!"],
      ["We shipped it indeed: a win.", "indeed", "We shipped it: a win."],
      [
        "She said \u201cwell very\u201d twice.",
        "very",
        "She said \u201cwell\u201d twice.",
      ],
      [
        "She said \u201cvery well\u201d twice.",
        "very",
        "She said \u201cwell\u201d twice.",
      ],
      ['She said "very well" twice.', "very", 'She said "well" twice.'],
      ["It works (really well).", "really", "It works (well)."],
      [
        "\u201cBut I thought\u2014\u201d she said.",
        "\u2014",
        "\u201cBut I thought\u201d she said.",
      ],
      ["(\u2014 see below)", "\u2014", "(see below)"],
    ])("adds no space where none belongs: %s", (text, quote, result) => {
      expect(accepted(text, edit(quote, " "))).toBe(result);
    });

    it("does not add that space where one is already there, or none belongs", () => {
      expect(accepted("It works \u2014 well.", edit("\u2014", " "))).toBe(
        "It works well.",
      );
      expect(accepted("We shipped it, really.", edit(", really", " "))).toBe(
        "We shipped it.",
      );
    });

    it("joins what a bare deletion joins: a hyphen can mean that", () => {
      expect(accepted("We co-operate here.", edit("-", ""))).toBe(
        "We cooperate here.",
      );
    });

    it("keeps a line break written in place of a dash", () => {
      expect(accepted("It works\u2014and fast.", edit("\u2014", "\n"))).toBe(
        "It works\nand fast.",
      );
    });

    it.each([
      ["The results\u2014truly remarkable\u2014speak.", "truly "],
      ["The results\u2014truly remarkable\u2014speak.", "truly"],
      ["The results\u2013truly remarkable\u2013speak.", "truly "],
    ])(
      "gives up the space after a dash that touched the word: %s",
      (text, quote) => {
        expect(accepted(text, edit(quote, ""))).toBe(
          text.replace("truly ", ""),
        );
      },
    );

    it.each([
      ["It was good indeed\u2014and we knew it.", " indeed"],
      ["It was good indeed\u2014and we knew it.", "indeed"],
      ["It was good indeed\u2013and we knew it.", " indeed"],
    ])(
      "gives up the space before a dash that touched the word: %s",
      (text, quote) => {
        expect(accepted(text, edit(quote, ""))).toBe(
          text.replace(" indeed", ""),
        );
      },
    );

    it("treats bold markers the same way", () => {
      expect(
        accepted("This is **truly important** for us.", edit("truly ", "")),
      ).toBe("This is **important** for us.");
      expect(
        accepted("This is **truly important** for us.", edit("important", "")),
      ).toBe("This is **truly** for us.");
    });

    it("leaves a spaced dash as it was", () => {
      expect(accepted("It works \u2014 truly well.", edit("truly ", ""))).toBe(
        "It works \u2014 well.",
      );
    });

    it.each([
      ["- One\n  - Sub\n- Next", "- Sub", "- One\n- Next"],
      ["- One\n  - Sub\n- Next", "  - Sub", "- One\n- Next"],
      ["- One\n  - Sub\n- Next", "  - Sub\n", "- One\n- Next"],
      ["- One\n  - Sub\n- Next", "\n  - Sub", "- One\n- Next"],
      ["Para.\n    Quoted line.\nNext.", "Quoted line.", "Para.\nNext."],
      [
        "Points :\n\t- d\u00e9tail\n- suite",
        "- d\u00e9tail",
        "Points :\n- suite",
      ],
      ["Para.\nDelete me.\n    Next.", "Delete me.", "Para.\n    Next."],
      ["One.  \nDelete me.\nNext.", "Delete me.", "One.  \nNext."],
      ["Title\n\n  Deleted.\nNext.", "Deleted.", "Title\n\nNext."],
      ["One.\n\n  Deleted.\n\n  Next.", "Deleted.", "One.\n\n  Next."],
    ])(
      "takes a line of its own along, not the next line's indent: %j",
      (text, quote, result) => {
        expect(accepted(text, edit(quote, ""))).toBe(result);
      },
    );

    it.each([
      ["Delete me.\n  Next.", "Delete me.", "  Next."],
      [
        "Delete me.\n\n    Hi Sam,\n\n    Thanks.",
        "Delete me.",
        "    Hi Sam,\n\n    Thanks.",
      ],
      ["  - Sub\n- Next", "- Sub", "- Next"],
      ["Delete me.\n", "Delete me.", ""],
      ["Delete me.\n  ", "Delete me.", ""],
      ["Delete me. Next.", "Delete me.", "Next."],
    ])("does the same on the first line: %j", (text, quote, result) => {
      expect(accepted(text, edit(quote, ""))).toBe(result);
    });

    it("leaves no blank line when the first two lines go", () => {
      const text = "Sure! Here it is:\n  - Let that sink in.\n  - Real point.";
      const edits = locateEdits(text, [
        edit("Sure! Here it is:", ""),
        edit("- Let that sink in.", ""),
      ]);
      expect(applyEdits(text, edits, decide(edits))).toBe("  - Real point.");
      expect(applyEdits(text, edits, { [edits[1].id]: "accepted" })).toBe(
        "Sure! Here it is:\n  - Real point.",
      );
      expect(applyEdits(text, edits, { [edits[0].id]: "accepted" })).toBe(
        "  - Let that sink in.\n  - Real point.",
      );
    });

    it("stays on the word when another edit holds its line's end", () => {
      const text = "- One\n  - Sub\n- Next";
      const edits = locateEdits(text, [
        edit("\n- Next", "\n- After"),
        edit("- Sub", ""),
      ]);
      expect(applyEdits(text, edits, decide(edits))).toBe("- One\n  \n- After");
    });

    it.each([
      ["Le bilan final\u00a0: positif.", "final", "Le bilan\u00a0: positif."],
      ["Le bilan final\u00a0: positif.", " final", "Le bilan\u00a0: positif."],
      [
        "Le bilan final\u00a0: positif.",
        "final\u00a0",
        "Le bilan\u00a0: positif.",
      ],
      ["C'est bien vraiment\u00a0!", "vraiment", "C'est bien\u00a0!"],
      ["Tout va bien vraiment\u202f?", "vraiment", "Tout va bien\u202f?"],
      ["Oui vraiment\u00a0; non.", "vraiment", "Oui\u00a0; non."],
      [
        "Il dit \u00ab\u00a0oui vraiment\u00a0\u00bb ici.",
        "vraiment",
        "Il dit \u00ab\u00a0oui\u00a0\u00bb ici.",
      ],
    ])(
      "keeps the no-break space before a French mark: %j",
      (text, quote, result) => {
        expect(accepted(text, edit(quote, ""))).toBe(result);
      },
    );

    it.each([
      // Away from a mark, it would tie the wrong words
      ["Le tr\u00e8s\u00a0bon plan.", "tr\u00e8s", "Le bon plan."],
      // A paragraph stays apart first
      ["Un.\n\nvraiment\u00a0: la suite.", "vraiment", "Un.\n\n: la suite."],
      // Both are no-break: the left one is as good
      ["A\u00a0vraiment\u00a0: b.", "vraiment", "A\u00a0: b."],
    ])("keeps the usual side otherwise: %j", (text, quote, result) => {
      expect(accepted(text, edit(quote, ""))).toBe(result);
    });

    it("takes the no-break space rather than leave two spaces, when another edit holds the left one", () => {
      const text = "Un bilan final\u00a0: positif.";
      const edits = locateEdits(text, [
        edit("Un bilan ", "Un compte "),
        edit("final", ""),
      ]);
      expect(applyEdits(text, edits, decide(edits))).toBe(
        "Un compte : positif.",
      );
    });

    it("keeps a line break written in place of a word", () => {
      expect(accepted("It is very good.", edit("very", "\n"))).toBe(
        "It is \n good.",
      );
    });

    it("takes out a space quoted on its own, and nothing more", () => {
      expect(accepted("a b", edit(" ", ""))).toBe("ab");
    });

    it("still replaces two spaces by one", () => {
      expect(accepted("a  b", edit("  ", " "))).toBe("a b");
    });

    it("takes the outer space of a loose quote, which the match leaves out", () => {
      expect(accepted("(d\u2019accord vraiment)", edit("d'accord ", ""))).toBe(
        "(vraiment)",
      );
      expect(accepted("Il est d\u2019accord.", edit(" d'accord", ""))).toBe(
        "Il est.",
      );
    });

    it("takes the other side's space when another edit holds this one", () => {
      const text = "We shipped on Friday. Let that sink in. The team can rest.";
      const raw = [
        edit(" The team can rest.", " The crew can rest."),
        edit("Let that sink in.", ""),
      ];
      const edits = locateEdits(text, raw);
      expect(applyEdits(text, edits, decide(edits))).toBe(
        "We shipped on Friday. The crew can rest.",
      );
      const deletion = edits.find((e) => e.replacement === "")!;
      expect(applyEdits(text, edits, { [deletion.id]: "accepted" })).toBe(
        "We shipped on Friday. The team can rest.",
      );
    });

    it("never takes a line break for that", () => {
      const text = "One.\n\nDelete me. The rest stays.";
      const edits = locateEdits(text, [
        edit(" The rest stays.", " It stays."),
        edit("Delete me.", ""),
      ]);
      expect(applyEdits(text, edits, decide(edits))).toBe("One.\n\n It stays.");
    });

    it("stays on the word when both sides are held", () => {
      const text = "One two three";
      const edits = locateEdits(text, [
        edit("One ", "Uno "),
        edit(" three", " tres"),
        edit("two", ""),
      ]);
      expect(edits.map((e) => text.slice(e.start, e.end))).toEqual([
        "One ",
        "two",
        " three",
      ]);
    });
  });

  describe("a quote whose outer space the replacement lost", () => {
    it.each([
      ["A very good idea here.", "very good ", "great", "A great idea here."],
      ["A very good idea here.", " very good", "great", "A great idea here."],
      ["L'idée très bonne ici.", "L'idée très bonne ", "L'idée", "L'idée ici."],
      ["A very good idea here.", " very good ", "great", "A great idea here."],
      [
        "It is very good. Next we go.",
        "It is very good. ",
        "It is good.",
        "It is good. Next we go.",
      ],
      ["Moreover, it is fine.", "Moreover, ", "Also,", "Also, it is fine."],
      [
        "Para one.\n\nPara two here.",
        "Para one.\n\n",
        "First para.",
        "First para.\n\nPara two here.",
      ],
      [
        'He said "yes" twice.',
        "He said ",
        "He answered",
        'He answered "yes" twice.',
      ],
      ["It costs $5 now.", "It costs ", "It is", "It is $5 now."],
      [
        "Il dit \u00ab oui \u00bb deux fois.",
        "Il dit ",
        "Il r\u00e9pond",
        "Il r\u00e9pond \u00ab oui \u00bb deux fois.",
      ],
      [
        "It fell by -5% in 2023.",
        "It fell by ",
        "It fell",
        "It fell -5% in 2023.",
      ],
      ["Il dit oui !", "dit oui ", "r\u00e9pond oui", "Il r\u00e9pond oui !"],
      [
        "Done. However, it works.",
        " However, it works.",
        "It works.",
        "Done. It works.",
      ],
      [
        "Fin.\nPuis autre chose.",
        "\nPuis autre chose",
        "Ensuite autre chose",
        "Fin.\nEnsuite autre chose.",
      ],
      ['"Yes" now.', " now", "today", '"Yes" today.'],
      [
        "It is\u00a0very good here.",
        "is very good ",
        "is good",
        "It is good here.",
      ],
      [
        "It is\u00a0very good-day.",
        "is very good ",
        "is good",
        "It is good-day.",
      ],
      ["the dogs' bones here", " bones", "toys", "the dogs' toys here"],
    ])("%s, %j", (text, quote, replacement, result) => {
      expect(accepted(text, edit(quote, replacement))).toBe(result);
    });

    it.each([
      ["a joined word", "See you next week end.", "week ", "week-", "week-end"],
      ["an elision", "Le nom de ami.", "de ", "d'", "d'ami"],
      ["a dash", "pre - war", " - ", "-", "pre-war"],
      [
        "an opening bracket",
        "A very good) idea.",
        "very ",
        "(",
        "A (good) idea.",
      ],
      [
        "a closing mark",
        "He said yes , then.",
        " ,",
        ",",
        "He said yes, then.",
      ],
      [
        "a bracket before",
        "It works ( very well) here.",
        " very",
        "so",
        "It works (so well) here.",
      ],
    ])(
      "lets the spacing go for %s",
      (_case, text, quote, replacement, result) => {
        expect(accepted(text, edit(quote, replacement))).toContain(result);
      },
    );

    it("does not keep a space at the very edge of the text", () => {
      expect(accepted(" Very good idea", edit(" Very good", "Great"))).toBe(
        "Great idea",
      );
      expect(accepted("A very good ", edit("very good ", "great"))).toBe(
        "A great",
      );
    });

    it("does not double a space that is already there", () => {
      expect(accepted("A  very good idea", edit(" very good", "great"))).toBe(
        "A great idea",
      );
      expect(accepted("A very good  idea", edit("very good ", "great"))).toBe(
        "A great idea",
      );
    });

    it("keeps one line break of two, which is no spare space", () => {
      expect(accepted("A.\n\nB is here.", edit("\nB is", "B was"))).toBe(
        "A.\n\nB was here.",
      );
      expect(accepted("It is A.\n\nB.", edit("is A.\n", "was A."))).toBe(
        "It was A.\n\nB.",
      );
    });

    it("still loses a stray space before punctuation", () => {
      expect(
        accepted("He said yes , then left.", edit("said yes ", "answered yes")),
      ).toBe("He answered yes, then left.");
    });

    it("keeps a replacement that brought its own space", () => {
      expect(accepted("A very good idea.", edit("very good ", "great "))).toBe(
        "A great idea.",
      );
    });
  });

  describe("a quote that holds a figure's unit, without its digits", () => {
    it.each([
      ["a budget of 3 million here", "million", "billion"],
      ["un budget de 3 millions ici", "millions", "milliards"],
      ["a 5 km walk", "km", "miles"],
      ["ça coûte 40 euros", "euros", "dollars"],
      ["en 3 jours", "jours", "semaines"],
      ["a budget of 3 million here", "million", ""],
    ])(
      "drops it when the figure would read otherwise: %s",
      (text, quote, by) => {
        expect(locateEdits(text, [edit(quote, by)])).toEqual([]);
      },
    );

    it.each([
      ["a 5 km walk", "km", "kilometres"],
      ["ça coûte 40 euros", "euros", "€"],
      ["a 5 km walk", "walk", "hike"],
      ["a budget of 3 million here", "here", "there"],
    ])("keeps it when the figure reads the same: %s", (text, quote, by) => {
      expect(locateEdits(text, [edit(quote, by)])).toHaveLength(1);
    });
  });

  describe("a quote that stops inside a figure", () => {
    it.each([
      ["a minus", "Revenue fell by -5% in 2023.", "fell by -", "fell by "],
      [
        "a minus sign",
        "It fell by \u22125 points.",
        "fell by \u2212",
        "fell by ",
      ],
      ["a minus before a currency", "A change of -$5 here.", "of -$", "of $"],
      ["a thousands mark", "It cost 1,200 dollars.", "cost 1,", "cost 1."],
      ["a decimal mark", "The rate is 3.5 today", ".", ""],
      [
        "a decimal mark, quoted up to it",
        "The rate is 3.5 today.",
        "is 3.",
        "is 3",
      ],
      ["a percent sign", "Sales rose 12% in 2019.", "% in", " in"],
      ["a range", "Between 5-10 people.", "-", ""],
      ["a time", "Open at 10:30 today.", ":", ""],
      [
        "a time, from its colon on",
        "Open at 10:30 today.",
        ":30 today",
        " 30 today",
      ],
      ["a currency", "It costs $40 now.", "costs $", "costs €"],
    ])("drops %s", (_case, text, quote, replacement) => {
      expect(locateEdits(text, [edit(quote, replacement)])).toEqual([]);
    });

    // What the guard reads as one figure, with the digits outside the quote
    it.each([
      ["a minus before a dollar", "A change of -$5 here.", "of -", "of "],
      ["a minus before a euro", "A change of -\u20ac5 here.", "-", ""],
      [
        "a minus sign before a euro",
        "A change of \u2212\u20ac5 here.",
        "of \u2212",
        "of ",
      ],
      [
        "a percent after a space",
        "Sales fell 12 % in 2019.",
        "% in",
        "points in",
      ],
      ["a space before a percent", "Sales fell 12 % in 2019.", " %", ""],
      [
        "a percent after a no-break space",
        "Sales fell 12\u00a0% in 2019.",
        "% in",
        "points in",
      ],
      ["a per mille", "Up 5 \u2030 in 2019.", "\u2030 in", "% in"],
      ["a thousands space", "It cost 1 200 dollars.", "cost 1 ", "cost 1,"],
    ])("drops %s", (_case, text, quote, replacement) => {
      expect(locateEdits(text, [edit(quote, replacement)])).toEqual([]);
    });

    // The quote holds no digit, so only the result can show it
    it.each([
      ["a minus", "Revenue fell by 5% in 2023.", "by ", "by -"],
      ["a minus sign", "Revenue fell by 5% in 2023.", "by ", "by \u2212"],
      ["a minus, up front", "We had 12 cases.", "We had ", "We had -"],
      ["a percent", "It costs 12 dollars.", " dollars", "% dollars"],
    ])(
      "drops %s brought by the replacement",
      (_case, text, quote, replacement) => {
        expect(locateEdits(text, [edit(quote, replacement)])).toEqual([]);
      },
    );

    it("drops a deletion that joins two figures into one", () => {
      expect(
        locateEdits("We counted 5 or 300 people.", [edit("or", "")]),
      ).toEqual([]);
    });

    it("does not take the place of the edit that follows", () => {
      const text = "We counted 5 or 300 people.";
      const edits = locateEdits(text, [
        edit("or", ""),
        edit("or 300", "or 300 of"),
      ]);
      expect(edits.map((e) => e.original)).toEqual(["or 300"]);
    });

    it("keeps a rewording that leaves the figures as they read", () => {
      expect(
        accepted("It cost 1,200 dollars.", edit("It cost ", "It was ")),
      ).toBe("It was 1,200 dollars.");
    });

    it("takes an apostrophe for a thousands mark only after a digit", () => {
      expect(
        accepted("Il gagne près d'1,5 million.", edit("près d'", "environ ")),
      ).toBe("Il gagne environ 1,5 million.");
    });

    it("keeps a scale word replaced where no figure stands before it", () => {
      expect(
        accepted(
          "In 2020 millions of people lost their jobs.",
          edit("millions of people", "many people"),
        ),
      ).toBe("In 2020 many people lost their jobs.");
    });

    // A limit: each edit is judged on its own
    it("cannot see two edits that join two figures only together", () => {
      const text = "Between 5 or and 300 people came.";
      const edits = locateEdits(text, [edit("or", ""), edit("and", "")]);
      expect(applyEdits(text, edits, decide(edits))).toBe(
        "Between 5 300 people came.",
      );
    });

    it.each([
      [
        "a comma after a figure",
        "In 2019, the firm grew.",
        ", the firm",
        "; the firm",
      ],
      [
        "a period after a figure",
        "We sold 5. Then we left.",
        ". Then",
        ". And then",
      ],
      [
        "a whole figure",
        "It cost 1,200 dollars.",
        "1,200 dollars",
        "a full 1,200 dollars",
      ],
      [
        "words before a figure",
        "It cost 1,200 dollars.",
        "It cost ",
        "It was ",
      ],
    ])("keeps %s", (_case, text, quote, replacement) => {
      expect(locateEdits(text, [edit(quote, replacement)])).toHaveLength(1);
    });
  });

  describe("the figures around an edit, in a long text", () => {
    const far = "Word ".repeat(100);

    it("sees a unit that a quote takes from the figure before it", () => {
      const text = `${far}It cost 3 million here. ${far}`;
      expect(locateEdits(text, [edit("million", "thousand")])).toEqual([]);
    });

    it("sees a figure that a deletion joins to the next one", () => {
      const text = `${far}Between 5 and 300 people. ${far}`;
      expect(accepted(text, edit("and", ""))).toBeNull();
    });

    it("is not held back by figures it leaves alone", () => {
      const text = `1 2 3 ${far}crucial step ${far}4 5 6`;
      expect(locateEdits(text, [edit("crucial", "key")])).toHaveLength(1);
    });
  });

  describe("a dash after a word separates", () => {
    it.each([
      [
        "The line works\u201412 of them run daily.",
        "\u2014",
        ", ",
        "The line works, 12 of them run daily.",
      ],
      [
        "The line works\u201412 of them run daily.",
        "works\u2014",
        "works: ",
        "The line works: 12 of them run daily.",
      ],
      [
        "One figure stands out\u201412%.",
        "\u2014",
        ": ",
        "One figure stands out: 12%.",
      ],
      [
        "Le bilan est clair\u201412 lignes rouvrent.",
        "\u2014",
        " : ",
        "Le bilan est clair : 12 lignes rouvrent.",
      ],
    ])("in %s, %s can go", (text, quote, by, result) => {
      expect(accepted(text, edit(quote, by))).toBe(result);
    });

    it("but stays a sign after a space", () => {
      expect(
        locateEdits("It fell by -5% in 2023.", [edit("by -", "by ")]),
      ).toEqual([]);
    });
  });

  describe("every mark of a figure holds the quote back", () => {
    it.each([
      ["It fell by -5% in 2023.", "by -", "by \u2212"],
      ["It fell by \u22125% in 2023.", "by \u2212", "by -"],
      ["It costs $40 now.", "costs $", "was $"],
      ["It cost 1,200 dollars.", "cost 1,", "was 1,"],
      ["The rate is 3.5 today.", "is 3.", "was 3."],
      ["Open at 10:30 today.", "at 10:", "by 10:"],
      ["Signed on 12/03 today.", "on 12/", "by 12/"],
      ["It cost 1'200 dollars.", "cost 1'", "was 1'"],
      ["It cost 1\u2019200 dollars.", "cost 1\u2019", "was 1\u2019"],
      ["Sales rose 12% in 2019.", "% in", "% by"],
      ["Up 5\u2030 in 2019.", "\u2030 in", "\u2030 by"],
      ["It cost 5$ in all.", "$ in", "$ at"],
      ["Open at 10:30 today.", ":30 today", ":30 now"],
      ["A rate of 3.5 today.", ".5 today", ".5 now"],
      ["the A320 flew", "A", "B"],
      ["the A320 flew", "A3", "B3"],
    ])(
      "in %s, %s stops inside, and the figure reads the same after",
      (text, quote, by) => {
        expect(locateEdits(text, [edit(quote, by)])).toEqual([]);
      },
    );

    it.each([
      ["Rate 3.5 today. Then.", ".", "!", "Rate 3.5 today! Then."],
      ["Cost 1,200 dollars, in all.", ",", ";", "Cost 1,200 dollars; in all."],
      ["At 10:30 sharp: go.", ":", ";", "At 10:30 sharp; go."],
      [
        "From 5-10 people - maybe.",
        "-",
        "\u2014",
        "From 5-10 people \u2014 maybe.",
      ],
      ["On 12/03, and/or later.", "/", " ", "On 12/03, and or later."],
      ["Cost 1'200 it's said.", "'", "\u2019", "Cost 1'200 it\u2019s said."],
      [
        "Cost 1\u2019200 it\u2019s said.",
        "\u2019",
        "'",
        "Cost 1\u2019200 it's said.",
      ],
      [
        "Up 12% in the % column.",
        "%",
        "percent",
        "Up 12% in the percent column.",
      ],
      [
        "Up 5\u2030 in the \u2030 column.",
        "\u2030",
        "%",
        "Up 5\u2030 in the % column.",
      ],
      [
        "It cost 5$ in the $ column.",
        "$",
        "dollar",
        "It cost 5$ in the dollar column.",
      ],
    ])("%s takes the next %s", (text, quote, by, result) => {
      expect(accepted(text, edit(quote, by))).toBe(result);
    });

    it.each([
      ["It costs $5 a month.", "$5 a month", "$5 monthly"],
      ["It fell -5% then.", "-5% then", "-5% later"],
      ["A rate of .5 today.", ".5 today", ".5 now"],
    ])("%s keeps %s", (text, quote, by) => {
      expect(locateEdits(text, [edit(quote, by)])).toHaveLength(1);
    });

    it("an elision and a curly opening quote", () => {
      expect(
        accepted(
          "Il gagne pr\u00e8s d\u20191,5 million.",
          edit("pr\u00e8s d\u2019", "environ "),
        ),
      ).toBe("Il gagne environ 1,5 million.");
      expect(
        locateEdits("un \u2018mot\u2019 ici", [edit("'mot'", "terme")]),
      ).toHaveLength(1);
    });
  });

  describe("the spacing marks, one by one", () => {
    it.each([
      ["See [1]\u2014and more.", "See [1] and more."],
      ["See {1}\u2014and more.", "See {1} and more."],
      [
        "He said \u2018no\u2019\u2014and left.",
        "He said \u2018no\u2019 and left.",
      ],
      ["Up 5\u2030\u2014a record.", "Up 5\u2030 a record."],
      ["It works\u2014[and fast].", "It works [and fast]."],
      ["It works\u2014{and fast}.", "It works {and fast}."],
      ["He said\u2014\u2018never\u2019.", "He said \u2018never\u2019."],
      ["Il dit\u2014\u00ab non \u00bb.", "Il dit \u00ab non \u00bb."],
      ["Dijo\u2014\u00bfcu\u00e1ndo?", "Dijo \u00bfcu\u00e1ndo?"],
      ["Dijo\u2014\u00a1ya!", "Dijo \u00a1ya!"],
    ])("%s keeps a space", (text, result) => {
      expect(accepted(text, edit("\u2014", " "))).toBe(result);
    });

    it.each([
      ["It works [really well].", "really", "It works [well]."],
      ["It works {really well}.", "really", "It works {well}."],
      [
        "Il dit \u00abreally bien\u00bb ici.",
        "really",
        "Il dit \u00abbien\u00bb ici.",
      ],
      [
        "He said \u2018really well\u2019 twice.",
        "really",
        "He said \u2018well\u2019 twice.",
      ],
      ["He said 'really well' twice.", "really", "He said 'well' twice."],
      ["Dijo \u00bfreally bien?", "really", "Dijo \u00bfbien?"],
      ["Dijo \u00a1really bien!", "really", "Dijo \u00a1bien!"],
      ["A great idea indeed\u2026", "indeed", "A great idea\u2026"],
      ["It works [well indeed].", "indeed", "It works [well]."],
      ["It works {well indeed}.", "indeed", "It works {well}."],
      [
        "He said \u2018well indeed\u2019 twice.",
        "indeed",
        "He said \u2018well\u2019 twice.",
      ],
      ["He said 'well indeed' twice.", "indeed", "He said 'well' twice."],
      ["a half-baked idea", "baked", "a half- idea"],
      ["and/or more", "or", "and/ more"],
    ])("deleting from %s", (text, quote, result) => {
      expect(accepted(text, edit(quote, ""))).toBe(result);
    });

    it.each([
      ["Done . Next", " .", ".", "Done. Next"],
      ["Done ; Next", " ;", ";", "Done; Next"],
      ["Done : Next", " :", ":", "Done: Next"],
      ["Done ! Next", " !", "!", "Done! Next"],
      ["Done ? Next", " ?", "?", "Done? Next"],
      ["Done \u2026 Next", " \u2026", "\u2026", "Done\u2026 Next"],
      ["(done ) next", " )", ")", "(done) next"],
      ["[done ] next", " ]", "]", "[done] next"],
      ["{done } next", " }", "}", "{done} next"],
      ["\u201cdone \u201d next", " \u201d", "\u201d", "\u201cdone\u201d next"],
      ["\u00abdone \u00bb next", " \u00bb", "\u00bb", "\u00abdone\u00bb next"],
      ["l 'ami", " '", "'", "l'ami"],
      ["l \u2019ami", " \u2019", "\u2019", "l\u2019ami"],
      ["un mot", " mot", "\u2212mot", "un\u2212mot"],
      ["de ami", "de ", "d\u2019", "d\u2019ami"],
      ["see one", "see ", "see [", "see [one"],
      ["see one", "see ", "see {", "see {one"],
      ["dijo que", "dijo ", "dijo \u00bf", "dijo \u00bfque"],
      ["dijo ya", "dijo ", "dijo \u00a1", "dijo \u00a1ya"],
      ["said one", "said ", "said \u201c", "said \u201cone"],
      ["said one", "said ", "said \u2018", "said \u2018one"],
      ["One.  Two", "  ", " ", "One. Two"],
    ])("in %s, %s decides its own spacing", (text, quote, by, result) => {
      expect(accepted(text, edit(quote, by))).toBe(result);
    });

    it.each(["[", "{", "\u00bf", "\u00a1", "\u201c", "\u2018"])(
      "no space after %s",
      (mark) => {
        expect(accepted(`it ${mark} very good`, edit(" very", "great"))).toBe(
          `it ${mark}great good`,
        );
      },
    );

    it.each([".", "\u2026", ")", "]", "}"])("no space before %s", (mark) => {
      expect(accepted(`it is very ${mark} next`, edit("very ", "great"))).toBe(
        `it is great${mark} next`,
      );
    });
  });

  describe("an emoji touching a word", () => {
    it.each([
      ["\u26A0\uFE0FAttention au départ.", "Attention au départ"],
      ["\u2714\uFE0FGain de temps réel.", "Gain de temps"],
      ["1\uFE0F\u20E3Premier point clair.", "Premier point"],
      ["\u2705Attention au départ.", "Attention au départ"],
    ])("finds the word after it in %s", (text, quote) => {
      expect(locateEdits(text, [edit(quote)])).toHaveLength(1);
    });

    it("finds the emoji itself, to take it out", () => {
      expect(
        accepted("\u26A0\uFE0FAttention au départ.", edit("\u26A0\uFE0F", "")),
      ).toBe("Attention au départ.");
    });
  });

  it("still drops a quote that is really absent", () => {
    expect(locateEdits("Hello world", [edit("goodbye moon")])).toEqual([]);
  });
});
