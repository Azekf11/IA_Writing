import { plainTypography } from "./locate";

const START = String.raw`(?<![\p{L}\p{N}\p{M}-])`;
const END = String.raw`(?![\p{L}\p{N}\p{M}-])`;
const QUOTE = String.raw`['’]`;
// A space in an entry stands for any whitespace: a quote can hold a line break or a no-break space
const anyOf = (list: string[], flags = "iu") =>
  new RegExp(
    `${START}(?:${list.join("|").replaceAll(" ", String.raw`\s+`)})${END}`,
    flags,
  );

// What a phrase needs ahead of it to be the phrase, and not a verb that happens to follow a word: "sans
// compter les frais" states a fact in the middle of a clause
const CLAUSE_START = String.raw`(?<=^\s{0,3}|[.!?\u2026,;:(\u2013\u2014]\s{0,3})`;
// What ends a clause, for the phrases that only stand alone: "or not.", but not "or not paid"
const CLAUSE_END = String.raw`(?=\s*(?:[.,;:!?\u2026)]|$))`;
// Set phrases that read as a negation and deny nothing. The site exists to remove several of them,
// so they cannot count against an edit. Each one holds only in the form that denies nothing: "no doubt
// remains" and "no surprise fees" are denials.
const PHRASES = [
  `(?<=whether\\s+)or not`,
  `or not${CLAUSE_END}`,
  `${CLAUSE_START}not to mention`,
  "not least",
  `(?:not|isn${QUOTE}t) surprising(?:ly)?`,
  "not (?:a coincidence|an accident|by chance|by accident)",
  "(?<!(?:may|might|must|shall|should|will|would|can|could|do|does|did)\\s)not without",
  "not more than",
  "not less than",
  "not uncommon",
  "not unlike",
  `let(?:${QUOTE}s| us) not forget`,
  `(?:must not|don${QUOTE}t|do not) forget`,
  `that${QUOTE}s not all(?=\\s*(?:[.,:;!\\u2026\\u2013\\u2014-]|$))`,
  "that is not all(?=\\s*(?:[.,:;!\\u2026\\u2013\\u2014-]|$))",
  `(?:don${QUOTE}t|do not) hesitate`,
  "no doubt(?! remains?)",
  "no wonder(?! drugs?)",
  "no matter(?! was| were| is)",
  "no less",
  "no more than",
  "no later than",
  "no fewer than",
  "no denying",
  "no question(?= that| about| whether|[.,;:!?]|$)",
  "no secret(?= that| to |[.,;:!?]|$)",
  "no coincidence(?= that|[.,;:!?]|$)",
  "no accident(?= that|[.,;:!?]|$)",
  "no small(?= feat| part| measure| number| amount| achievement| matter| task)",
  "no stranger(?= to )",
  "no stone unturned",
  "no surprise(?= that| to | there|[.,;:!?]|$)",
  "no exaggeration(?= to |[.,;:!?]|$)",
  "no easy (?:task|feat)",
  "no mean feat",
  "no shortage of",
  "make no mistake(?=\\s*[:,;\\u2013\\u2014-]|\\s+about)",
  "nothing short of",
  "nothing less",
  "nothing more than",
  "none the less",
  "none other than",
  "second to none",
  `never been (?:more(?! than)|(?:better|greater|higher|clearer|stronger)(?! than(?! (?:now|today|(?:it|they) (?:is|are) (?:now|today))${END}))|so(?! much as)|easier|a better)`,
  "like never before",
  "without (?:a |any |a shadow of a )?doubt",
  "without question",
  "without further ado",
  "goes without saying",
  `(?:cannot|can not|can${QUOTE}t|should not|shouldn${QUOTE}t|must not|mustn${QUOTE}t) be (?:overstated|understated|underestimated|overlooked|ignored|denied|(?:stressed|emphasi[sz]ed) enough)`,
  `ou non${CLAUSE_END}`,
  `ou pas${CLAUSE_END}`,
  `sans (?:aucun |nul |le moindre |l${QUOTE}ombre d${QUOTE}un )?doute`,
  "plus aucun doute",
  "aucun doute",
  "pas de doute",
  "pas un hasard",
  "pas par hasard",
  "pas une coïncidence",
  `(?:${CLAUSE_START}n${QUOTE}oublie|n${QUOTE}oubli(?:ons|ez)) pas`,
  "il ne (?:faut|faudrait) pas (?:oublier|perdre de vue|sous-estimer|négliger)",
  "sans cesse",
  `${CLAUSE_START}sans compter`,
  `${CLAUSE_START}sans oublier`,
  `${CLAUSE_START}sans parler(?= d(?:e |u |es |${QUOTE}))`,
  "va sans dire",
  "sans conteste",
  "sans précédent",
  "sans pareil",
  "sans (?:grande )?surprise",
  "sans faille",
  "sans plus (?:attendre|tarder)",
  "sans réserve",
  "sans équivoque",
  "sans relâche",
  "sans ambiguïté",
  "sans égal",
  "non négligeable",
  "non sans",
  "non loin",
  "non moins",
  "pas à pas",
  "pas moins de",
  "pas plus de",
  "(?:pas|nul) besoin de (?:rappeler|préciser|dire|souligner)",
  "ni plus ni moins",
  "à jamais",
  "si jamais",
  "comme jamais",
  "(?:plus|mieux|moins|autant) que jamais",
  // "n'a jamais été aussi riche que lui" compares, but "aussi importante qu'aujourd'hui" is the stock form
  `jamais été (?:aussi|si|plus(?! d(?:e |${QUOTE})))(?![^.!?\\u2026,;:]*\\squ(?:e\\s|${QUOTE})(?!aujourd|maintenant|actuellement|à\\s))`,
  `comme si de rien (?:n${QUOTE}était|ne s${QUOTE}était)`,
  "un rien",
  `rien que (?:pour|de|d${QUOTE}\\p{L}+|le|la|les)${END}(?<!${START}(?:ne\\s|n${QUOTE})[^.!?]*)`,
  `rien d${QUOTE}étonnant`,
  "secret pour personne",
  `(?:${CLAUSE_START}n${QUOTE}hésite|n${QUOTE}hésit(?:ons|ez)) pas`,
  `n${QUOTE}est pas (?:inutile|exagéré|surprenant|étonnant|anodine?|rare|négligeable)`,
  `n${QUOTE}est plus à (?:démontrer|prouver|faire)`,
  "pas (?:étonnant|surprenant)",
  `n${QUOTE}est pas tout(?=\\s*(?:[.,:;!\\u2026\\u2013\\u2014-]|$))`,
  "ne nous y trompons pas",
  "(?:on ne peut(?: pas)?|on ne saurait|nul ne peut|personne ne peut) (?:nier|ignorer)",
  `n${QUOTE}est (?:pas|plus) un secret`,
  `(?:nul|personne) n${QUOTE}ignore`,
  "on ne le dira jamais assez",
  `n${QUOTE}en (?:reste|demeure|est) pas moins`,
  `ne dat[^\\s.,;:!?]* pas d${QUOTE}hier`,
  `à n${QUOTE}en pas douter`,
  `ne manqu[^\\s.,;:!?]* pas(?! (?:à )?(?:(?:un|une|le|la|les|ce|cet|cette|ces|son|sa|ses|leurs?|mon|ma|mes|notre|nos|votre|vos) |l${QUOTE}))`,
  "ne cess(?:e|ent|ait|aient) de",
];
const SET_PHRASES = anyOf(PHRASES, "giu");
// Four of them hold only in some forms. Read whole, the way they were first written, they can still be what
// a text means: "ne manque pas un vote" denies, and yet "ne vote pas" says the opposite. So an edit has to
// hold on both readings.
const WHOLE_PHRASES = anyOf(
  [
    ...PHRASES,
    "not without",
    "never been (?:more(?! than)|so(?! much as)|easier|a better|better|greater|higher|clearer|stronger)",
    `jamais été (?:aussi|si|plus)(?![^.!?\\u2026,;:]*\\squ(?:e\\s|${QUOTE})(?!aujourd|maintenant|actuellement|à\\s))`,
    "ne manqu[^\\s.,;:!?]* pas",
  ],
  "giu",
);
// The word that makes a set phrase sound like a denial
const NEGATIVE_WORD = anyOf(
  [
    `(?:cannot|can not|can${QUOTE}t|should not|shouldn${QUOTE}t|must not|mustn${QUOTE}t) be`,
    "no",
    "none",
    "not",
    "do not",
    `(?:do|does|is)n${QUOTE}t`,
    "cannot",
    "can not",
    `can${QUOTE}t`,
    "never",
    "nothing",
    "without",
    "aucun",
    "nul",
    "pas de",
    "pas (?:un|par)(?= hasard)",
    "pas une(?= coïncidence)",
    "pas",
    "sans",
    "non",
    "ni",
    "rien",
    "pour personne",
    "personne",
    "plus(?= un secret| aucun doute| à )",
    "jamais(?= été)",
  ],
  "giu",
);
const PARTICLE = new RegExp(`${START}(?:ne\\s+|n${QUOTE}(?:en\\s+)?)`, "giu");
// Read whole, the "en" of "n'en" stays with the phrase
const WHOLE_PARTICLE = new RegExp(`${START}(?:ne\\s+|n${QUOTE})`, "giu");

// "pas" is also a step: "un pas en avant", and "autre pas" with it, but "d'autres pas" is a denial
const NOT_A_STEP = `(?<!${START}(?:un|le|les|des|du|au|aux|ce|ces|son|ses|mon|mes|ton|tes|nos|vos|leurs?|notre|votre|premiers?|derniers?|seconds?|prochains?|nouveaux?|petits?|grands?|gros|bons?|vrais?|véritables?|immenses?|énormes?|faux|mauvais|quelques|chaque|autre|tels?|seuls?|deux|trois|quatre|cinq|dix|cent|mille|\\d+|à)\\s)`;
// "personne" is also a noun: "cette personne n'a que 5 ans", "par personne", "en personne"
const NOT_A_NOUN = `(?<!${START}(?:(?:la|une|cette|chaque|toute|quelle|ma|ta|sa|leur|notre|votre|autre)\\s(?:(?:dernière|première|seule|même|jeune|tierce|vieille|autre|bonne|mauvaise|seconde|deuxième|troisième|simple)\\s)?|par\\s|en\\s))`;
// "point" and "personne" after a determiner are nouns: "qu'il n'aborde ce point"
const NOT_DETERMINED = `(?<!${START}(?:un|une|le|la|ce|cette|chaque|du|au|sa|son|ma|ta|mon|ton|notre|votre|leur|tel|telle|quel|quelle|quelque)\\s)`;
// "ne" alone says little: "avant qu'il ne parte" and "il ne reste que 5" deny nothing, and "ne ... que"
// can hold a "personne", a "point" or a "plus" of its own. A few verbs deny with it alone, in a written
// style: "elle ne peut accepter", unless "que" follows. "No." before a digit is a number after a word
// ("the No. 5"), and an answer anywhere else. "D'aucuns" means "some".
const MARKER = new RegExp(
  [
    `${START}(?:not|cannot|never|none|nobody|nothing|nowhere|neither|nor|without|no-one)${END}`,
    String.raw`${START}(?:no(?!\.\s?\d)|(?<!\p{L}\s)no)${END}`,
    String.raw`\p{L}n${QUOTE}t${END}`,
    `${START}(?:jamais|(?<!d${QUOTE})aucune?s|aucune?|aucunement|nullement|rien|ni|sans|guère|non|nulle part)${END}`,
    `${START}${NOT_A_STEP}pas${END}`,
    String.raw`${START}(?:ne\s+|n${QUOTE})(?:(?!qu(?:e\s|${QUOTE}))\S{1,40}\s+){0,3}?(?:plus(?!\s+qu(?:e\s|${QUOTE}))|${NOT_DETERMINED}(?:personne|point))${END}`,
    String.raw`${START}(?:nul(?:le)?|${NOT_A_NOUN}personne)\s+n(?:e\s|${QUOTE})`,
    String.raw`${START}(?:nul(?:le)?\s+(?:besoin|trace)|ne\s+saurai(?:t|ent))${END}`,
    String.raw`${START}(?:ne\s+(?:peu(?:t|vent)|pouv(?:ait|aient)|pourr(?:a|ont|ait|aient)|sai[st]|sav(?:ent|ait|aient)|os(?:e|ent|ait|aient))|n${QUOTE}os(?:e|ent|ait|aient))${END}(?!\s+(?:pas|qu(?:e\s|${QUOTE})))`,
  ].join("|"),
  "iu",
);

// The contrasts the prompt tells the model to take apart. "It's not just X, it's Y" must be able to
// become "It's Y", so a text that stages one is not held to its "not". The group is the word that goes
// with it: "n'est pas juste" can only become "est juste" by saying the opposite. Alone, "pas juste" and
// "not just" mean unfair, and "can't just" forbids. What is left around the group says the form is the
// contrast and not its look-alike: "not so much as apologize", "pas tant que ça", "ne s'arrête pas à Lyon".
const STAGED = anyOf([
  String.raw`(?:not|(?:is|are|was|were|do|does|did|wo|would|has|have|had)n${QUOTE}t)\s+(only|just(?=\s+\p{L})|merely|simply|solely|so\s+much(?=\s(?!as\s)[^.!?\u2026]*\sas\s))`,
  String.raw`(?:not|no\s+longer|(?:is|was)n${QUOTE}t)\s+(whether)`,
  String.raw`it(?:${QUOTE}s\s+not|\s+is\s+not|\s+isn${QUOTE}t)\s+(enough)(?=\s+to\s)`,
  String.raw`pas\s+(seulement|uniquement|simplement|juste(?=\s+\p{L}))`,
  String.raw`pas\s+(tant)(?!\s+d(?:e\s|${QUOTE}))(?=\s(?!qu)[^.!?\u2026]*\squ(?:e\s|${QUOTE}))`,
  String.raw`ne\s+se\s+(content|limit|résum|rédui|born)[^\s.,;:!?]*\s+pas(?=\s+(?:à|au|aux|de|d${QUOTE}))`,
  String.raw`ne\s+s${QUOTE}(arrêt)[^\s.,;:!?]*\s+pas(?=\s+là)`,
  String.raw`ne\s+(?:vous|nous)\s+(content)[^\s.,;:!?]*\s+pas`,
  String.raw`ne\s+(?:s${QUOTE}est|se\s+sont)\s+pas\s+(content)[^\s.,;:!?]*(?=\s+d(?:e\s|${QUOTE}))`,
  String.raw`ne\s+(?:s${QUOTE}est|se\s+sont)\s+pas\s+(limit|résum|rédui|born)[^\s.,;:!?]*(?=\s+(?:à|au|aux)\s)`,
  String.raw`ne\s+(?:s${QUOTE}est|se\s+sont)\s+pas\s+(arrêt)[^\s.,;:!?]*(?=\s+là)`,
  String.raw`(?:ne\s+f(?:ait|ont|aisai\p{L}+|er\p{L}+)\s+pas|n${QUOTE}(?:a|ont)\s+pas\s+fait)\s+(que)`,
  String.raw`il\s+ne\s+(suffi)t\s+pas(?=\s+d(?:e\s|${QUOTE}))`,
  String.raw`(?:n${QUOTE}(?:est|était)|ne\s+s${QUOTE}agit)\s+(?:pas|plus)\s+de\s+savoir\s+(si|s${QUOTE}ils?)`,
  String.raw`n${QUOTE}(?:est|était)\s+pas\s+(qu${QUOTE}une?)`,
  String.raw`ne\s+sont\s+pas\s+(que\s+des)`,
  String.raw`et\s+pas\s+(que)(?=\s*(?:[.,;:!?\u2026]|$))`,
  "non (seulement)",
  String.raw`non\s+(pas)(?![^.!?\u2026]*(?:,|\smais\s))`,
]);
const ALL_STAGED = new RegExp(STAGED.source, "giu");
// What "so much X as Y" and "pas tant X que Y" deny, so X cannot stay
const WEIGHED = new RegExp(
  String.raw`(?:so\s+much|pas\s+tant)\s+(?:(?:an?|the|une?|l[ae]s?|des|du|de)\s+|[ld]${QUOTE})?(\p{L}+)(?!\p{L})[^.!?\u2026]*?\s(?:as\s|qu(?:e\s|${QUOTE}))`,
  "iu",
);
// A contrast split in two, whose first half can go: with the same pronoun ("We don't sell software, we
// sell trust"), after a bare "Not X." or two answered in their own terms ("Not for the money. For the
// love."), "Not a X, a Y", or a list down to its "just". Any other sentence that denies states a fact:
// "Not a cent was paid. The firm closed." "On" is a pronoun only in French.
const ARTICLE = String.raw`(?:an?|the|un|une|le|la|les|des)`;
const SPLIT = new RegExp(
  `^\\s*(?:${[
    String.raw`(we|i|you|they|it|nous|je|tu|on(?=\s+n(?:e\s|${QUOTE}))|il|elle|ils|elles|vous)${END}[^.!?\u2026]*?[.!?\u2026;:,\p{Pd}]\s+(?=\1${END})`,
    String.raw`(?:not|pas)\s+(?:[^\s.!?\u2026,]+[.!?\u2026]\s+|(\p{L}+)\s[^.!?\u2026]*[.!?\u2026]\s+(?=(?:not|pas)\s|\2${END}))`,
    String.raw`(?:not|pas)\s+${ARTICLE}\s+[^\s.!?\u2026,:;]+(?:\s+[^\s.!?\u2026,:;]+)?\s*[,:;\p{Pd}]\s+(?=${ARTICLE}\s)`,
    String.raw`(?:no${END}|pas\s+d(?:e\s|${QUOTE}))[^.!?\u2026]*?[.,;:!?\u2026\p{Pd}]\s+(?=(?:no|just|only|juste|seulement)${END})`,
    String.raw`(?:just|only|juste|seulement)\s+`,
  ].join("|")})`,
  "iu",
);
// A bare "Not a X. A Y." or "Pas de X. Des Y." is a contrast only as the whole quote, with its stop: a
// sentence ahead of it states a fact ("Not one paid. Not a cent. The fine."), and so can a quote that
// stops short ("Not a cent. The firm").
const BARE = new RegExp(
  String.raw`^\s*(?:(?:not|pas)\s+${ARTICLE}\s+|pas\s+d(?:e\s|${QUOTE}))[^\s.!?\u2026,:;]+[.!?\u2026]\s+((?:${ARTICLE}|du)\s+[^\s.!?\u2026,:;]+[.!?\u2026])\s*$`,
  "iu",
);
// The same with a name: "People don't buy products. They buy stories." can become "People buy stories."
// Only with a verb of its own in the present: "The firm did not pay. It sold." and "Le contrat n'a pas
// été signé. Il reste à négocier." state two facts.
const NOT_PRESENT = String.raw`(?!(?:(?:l|s|y|en|le|la|les|lui|leur|se|me|te|nous|vous)(?:${QUOTE}|\s+))*(?:a\s|ont\s|est\s|sont\s|fu(?:t|rent)\s|ét|av|aur|\p{L}+r(?:a|ont)\s|\p{L}{3,}ai(?:t|ent)\s))`;
const NAME_HALF = new RegExp(
  String.raw`^(.+?)\s(?:do(?:es)?(?:\s+not|n${QUOTE}t)\s|(?:ne\s|n${QUOTE})${NOT_PRESENT})[^.!?\u2026;:,]*?[.!?\u2026;:,\p{Pd}]\s+(?:it|they|il|elle|ils|elles)\s+`,
  "iu",
);
// The same contrast with the answer first: "It's a marathon, not a sprint". The part that goes names one
// thing, so "It's a new drug, not yet approved" says something, and so does a plain statement: "credits
// the timetable, not the tablets".
const LAST_CLAUSE = new RegExp(
  String.raw`((?:^\s*|[.!?\u2026]\s+)(?:it${QUOTE}s|it\s+is|it\s+was|this\s+is|that${QUOTE}s|these\s+are|they${QUOTE}re|they\s+are|they\s+were|c${QUOTE}est|c${QUOTE}était|ce\s+sont|il\s+s${QUOTE}agit)${END}[^.!?\u2026]*?)(?:\s?[,;\p{Pd}]\s+(?:et\s+)?(?:not|pas|non)|\set\s+(?:non|pas))\s+(?:(?:${ARTICLE}|du|de|d${QUOTE}une?|about|of)\s+(?:[^\s.!?\u2026,]+\s+)?)?[^\s.!?\u2026,]+(?=\s*(?:[.!?\u2026,]|$))`,
  "iu",
);
// What answers the denial later in the same text. After "because", it is the reason that is denied. A
// pronoun answers from a clause of its own. Inside a clause it states what is denied, whatever comes later:
// "n'est pas remboursé quand il est prescrit en France, mais il est vendu".
const NOT_A_REASON = `(?<!(?:(?:because|car)\\s|(?:parce\\s+|puis)qu(?:e\\s|${QUOTE})))`;
const PRONOUN_FORM = `(?:it${QUOTE}s|it is|that${QUOTE}s|this is|they${QUOTE}re|they are|these are|c${QUOTE}est|ce sont|(?:il|elle) est|(?:ils|elles) sont|il s${QUOTE}agit)`;
const ANSWER = new RegExp(
  `${NOT_A_REASON}${
    anyOf([
      "but",
      "rather",
      "instead",
      "mais",
      "plutôt",
      "au contraire",
      `${CLAUSE_START}${PRONOUN_FORM}`,
    ]).source
  }`,
  "iu",
);
const PRONOUN_INSIDE = new RegExp(
  `${NOT_A_REASON}${anyOf([PRONOUN_FORM]).source}`,
  "iu",
);
// What the answer sets aside, and so no longer says: "survival rather than growth"
const SET_ASIDE =
  /(?:rather\s+than|instead\s+of|plutôt\s+que|au\s+lieu\s+d)[^.!?\u2026,;:]*/giu;
// The same in the past, directly after what it denies: "and it was fined" answers nothing
const PAST_ANSWER = new RegExp(
  String.raw`(?:was\s+not|wasn${QUOTE}t|were\s+not|weren${QUOTE}t|n${QUOTE}était\s+pas|n${QUOTE}a\s+pas\s+été)\s([^.!?\u2026;:,\u2013\u2014]+)[.!?\u2026;:,\u2013\u2014]\s+(it\s+was|that\s+was|this\s+was|they\s+were|c${QUOTE}était|ce\s+fut)${END}`,
  "iu",
);
// The denied part of a cleft, and what it says instead: "It's not the price that matters, it's the timing".
// "It is not true that prices fell" denies its clause. A later opening in a clause can only try what the
// first one tried, so it stays out.
const CLEFT_OPENING = String.raw`(?:it${QUOTE}s\s+not|it\s+is\s+not|it\s+isn${QUOTE}t|ce\s+n${QUOTE}est\s+pas)`;
const NOT_A_CLAUSE = String.raw`(?!(?:\p{L}+\s+){0,3}(?:the\s+case|true|false|clear|certain|sure|likely|possible|obvious|evident|known|right|correct|necessary|vrai|faux|sûr|clair|exact|évident|probable|prouvé|établi|nécessaire|dit)\s+(?:(?:that|who|que|qui)\s|qu${QUOTE}))`;
const CLEFT = new RegExp(
  String.raw`${CLEFT_OPENING}(?<!${CLEFT_OPENING}\s[^.!?\u2026;:,\u2013\u2014]*${CLEFT_OPENING})\s${NOT_A_CLAUSE}([^.!?\u2026;:,\u2013\u2014]+)\s(?:(?:that|who|qui|que)\s|qu${QUOTE})[^.!?\u2026;:\u2013\u2014]*?[.!?\u2026;:,\u2013\u2014]?\s?${START}(?:it${QUOTE}s|it\s+is|c${QUOTE}est|but|mais)${END}\s*([^.!?\u2026;:,\u2013\u2014]*)`,
  "iu",
);

// The verbs that stop something, in the forms that say so: "a cessé", and neither "cession" nor "cessez"
const STOPS = String.raw`(?:e|es|ent|er|é|ée|és|ées|ait|aient|era|eront|a|èrent)`;
// Words that say no by themselves, so "did not pass" can become "failed" and "not possible"
// "impossible". The group holds what to look for on the other side: "did not fail" is a flip. The last
// group holds adverbs, which a French verb comes ahead of.
const SAYS_NO = new RegExp(
  `${START}(avoid|lack|fail(?!l)|refus|unable|unlikely|unclear|unsafe|unknown|unfair|impossib|illegal|unnecessar|absen|missing|évit|manqu|échou|incapabl|inutil|illégal|dépourvu|exempt)\\p{L}*|(?<=\\p{L})-(free)${END}|${START}(free(?=${END})|gratuit(?=(?:e|s|es)?${END})|stop(?=(?:s|ped|ping)?${END})|ceas(?=(?:e|es|ed|ing)${END})|cess(?=${STOPS}${END})|arrêt(?=${STOPS}${END}))|${START}((?<!a\\s)few|(?<!a\\s)little|rarely|seldom|hardly|barely|scarcely|(?<!(?:un|quelque|à)\\s)peu(?!\\s+à)|rarement|à\\speine)${END}`,
  "giu",
);
// A word with its own "no" in front: "not available" can become "unavailable"
const NEGATED_WORD = new RegExp(
  `${START}(?:un(\\p{L}{4,})|i[nmlr](\\p{L}{5,}))`,
  "giu",
);

type Reading = { phrases: RegExp; particle: RegExp };
const NARROW: Reading = { phrases: SET_PHRASES, particle: PARTICLE };
const WHOLE: Reading = { phrases: WHOLE_PHRASES, particle: WHOLE_PARTICLE };
// What the two readings can differ on
const READS_WHOLE =
  /not\s+without|never\s+been|jamais\s+été|ne\s+manqu|n['’]en\s/iu;

const withoutSetPhrases = (text: string, { phrases }: Reading) =>
  text.replace(phrases, " ");

// Words as a comparable string: "More than" is in "it had more than 40." A model retypes apostrophes
// and hyphens, so they read the same.
const words = (text: string) =>
  ` ${plainTypography(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()} `;
// The same with elisions apart: "est un secret" is in "c'est un secret"
const looseWords = (text: string) => words(text).replace(/'/gu, " ");
const occurrences = (text: string, part: string) => text.split(part).length - 1;

// A set phrase denies nothing while it stays whole. "no more than 40" can become "at most 40", but
// "more than 40" says the opposite, and so does anything that adds the rest of the phrase, singular or
// plural, to what the text already holds elsewhere.
const losesItsDenial = (phrased: string, plain: string, reading: Reading) => {
  const after = looseWords(plain);
  const before = looseWords(withoutSetPhrases(phrased, reading));
  return Array.from(phrased.matchAll(reading.phrases)).some(([phrase]) => {
    const rest = looseWords(
      phrase.replace(NEGATIVE_WORD, " ").replace(reading.particle, " "),
    );
    const plural = `${rest.trimEnd()}s `;
    return (
      rest.trim().length > 3 &&
      occurrences(after, rest) + occurrences(after, plural) >
        occurrences(before, rest) + occurrences(before, plural)
    );
  });
};

const holds = (text: string, part: string) =>
  words(text)
    .trim()
    .split(" ")
    .some((word) => word.startsWith(part));

const stagesContrast = (denying: string, plain: string) => {
  const staged = STAGED.exec(denying);
  if (!staged) return false;
  const denied = WEIGHED.exec(denying)?.[1];
  if (denied && holds(plain, words(denied).trim().slice(0, 4))) return false;
  // By its start, so a verb that changes tense is still there ("se limitera"), and whole when it is short
  // ("si", "que")
  const found = looseWords(staged.slice(1).find(Boolean) ?? "");
  const word = found.trim().length < 4 ? found : found.trimEnd();
  const fewer = (part: string) =>
    occurrences(looseWords(plain), part) <
    occurrences(looseWords(denying), part);
  return (
    !MARKER.test(denying.replace(ALL_STAGED, " ")) &&
    fewer(word) &&
    // "Il suffira de payer" says the opposite, and "une somme suffisante" further on is another word
    (word !== " suffi" || fewer(" suffit"))
  );
};

const dropsAnsweredPart = (original: string, kept: string) => {
  const wanted = words(kept);
  if (words(original.replace(LAST_CLAUSE, "$1")) === wanted) return true;
  const half = NAME_HALF.exec(original);
  if (half && words(`${half[1]} ${original.slice(half[0].length)}`) === wanted)
    return true;
  const bare = BARE.exec(original);
  if (bare && words(bare[1]) === wanted) return true;
  let rest = original;
  for (let part = SPLIT.exec(rest); part; part = SPLIT.exec(rest)) {
    rest = rest.slice(part[0].length);
    if (words(rest) === wanted) return true;
  }
  return false;
};

// The word a denial stands on, by its first letters: the one after it and, past a determiner, the one after
// that, and the verb between "ne" and "pas" unless that verb only says "is" or "has"
const stem = (word?: string) =>
  word && word.length > 2 ? [word.toLowerCase().slice(0, 4)] : [];
const DETERMINED = new RegExp(
  String.raw`^\s*(?:(?:the|an?|une?|l[ae]s?|des|du|de|ces|ses)\s+|[ld]${QUOTE})?(\p{L}+)`,
  "iu",
);
const standsOn = (text: string) => [
  ...stem(/^\s*(\p{L}+)/u.exec(text)?.[1]),
  ...stem(DETERMINED.exec(text)?.[1]),
];
const nextWord = (denying: string, marker: RegExpExecArray) =>
  standsOn(denying.slice(marker.index + marker[0].length));
const BARE_VERB =
  /^(?:est|sont|ont|était|étaient|avait|avaient|sera|seront|aura|auront|fut|furent)$/iu;
const VERB_BEFORE = new RegExp(
  `${START}(?:ne\\s+|n${QUOTE})(\\p{L}+)\\s+$`,
  "iu",
);
const verbBefore = (denying: string, marker: RegExpExecArray) => {
  const verb = VERB_BEFORE.exec(denying.slice(0, marker.index))?.[1];
  return verb && !BARE_VERB.test(verb) ? stem(verb) : [];
};
// Where the first of those words stands in a text
const firstAt = (text: string, stems: string[]) => {
  const at = stems.length
    ? text.search(new RegExp(`${START}(?:${stems.join("|")})`, "iu"))
    : -1;
  return at === -1 ? Infinity : at;
};

// An answer that opens the plain side is what is left of the contrast. One further on answered nothing.
const stillStands = (plain: string, answer: string) =>
  words(plain).indexOf(words(answer), 1) !== -1;

// An answer only excuses a denial whose last word went with it: "This isn't about speed. It's about
// trust." can become "This is about trust.", but "The drug is not approved. It is safe." cannot become
// "The drug is approved. It is safe." A denial after the answer states a fact of its own.
const answersDenial = (
  denying: string,
  marker: RegExpExecArray,
  plain: string,
) => {
  const after = denying.slice(marker.index + marker[0].length);
  const answer = ANSWER.exec(after);
  if (!answer || MARKER.test(after.slice(answer.index + answer[0].length)))
    return false;
  const before = after.slice(0, answer.index);
  if (PRONOUN_INSIDE.test(before)) return false;
  const last = words(before.split(/[.!?\u2026;:,\u2013\u2014]/u)[0])
    .trim()
    .split(" ")
    .at(-1);
  // "Nothing but" says one thing and "No, it's a feature" opens with its denial, but "Profits did not, but
  // hiring held" denies profits.
  if (!last)
    return (
      !before.trim() ||
      /(?:^\s*|[.!?\u2026]\s+)$/u.test(denying.slice(0, marker.index))
    );
  if (holds(plain.replace(SET_ASIDE, " "), last)) return false;
  // An answer still there answered nothing, so the word the denial stood on has to go too
  return !(
    stillStands(plain, answer[0]) &&
    [...nextWord(denying, marker), ...verbBefore(denying, marker)].some(
      (word) => holds(plain, word),
    )
  );
};

const answersInThePast = (denying: string, plain: string) => {
  const past = PAST_ANSWER.exec(denying);
  if (
    !past ||
    words(plain).includes(words(past[1])) ||
    MARKER.test(denying.slice(past.index + past[0].length))
  )
    return false;
  return !(
    stillStands(plain, past[2]) &&
    [...standsOn(past[1]), ...stem(words(past[1]).trim().split(" ")[0])].some(
      (word) => holds(plain, word),
    )
  );
};

// What the cleft says instead has to stay: "It's not him who paid, it's Smith" cannot become "He paid"
const answersCleft = (denying: string, plain: string) => {
  const cleft = CLEFT.exec(denying);
  if (
    !cleft ||
    MARKER.test(denying.slice(0, cleft.index)) ||
    words(plain).includes(words(cleft[1])) ||
    MARKER.test(denying.slice(cleft.index + cleft[0].length - cleft[2].length))
  )
    return false;
  const said = words(cleft[2]).trim().split(" ").at(-1);
  return said ? holds(plain, said) : false;
};

// A word that says no, on the side that has no denial, and that the denying side did not already hold.
// Said after the word the denial stood on, it says something else: "approved and helps people stop". A
// French verb comes ahead of its adverb, so it stays out for those: "ne paient pas souvent" to "paient
// rarement".
const saysNoItself = (
  denying: string,
  marker: RegExpExecArray,
  plain: string,
) => {
  const lower = denying.toLowerCase();
  const denied = words(denying);
  const next = firstAt(plain, nextWord(denying, marker));
  const stood = Math.min(next, firstAt(plain, verbBefore(denying, marker)));
  return (
    Array.from(plain.matchAll(SAYS_NO)).some((match) => {
      const word = match[1] ?? match[2] ?? match[3] ?? match[4];
      return (
        !lower.includes(word.toLowerCase()) &&
        (match[2] !== undefined || match.index <= (match[4] ? next : stood))
      );
    }) ||
    Array.from(plain.matchAll(NEGATED_WORD)).some(
      (match) =>
        denied.includes(` ${(match[1] ?? match[2]).toLowerCase()} `) &&
        !denied.includes(` ${match[0].toLowerCase()} `) &&
        match.index <= stood,
    )
  );
};

// Whether an edit adds a denial to a text that has none, or takes away the only one it has, with the set
// phrases read one way. A "not" that moves, or a reversed word ("rose", "fell"), stays out of reach: see the
// limits in the docs.
const flipsOn = (a: string, b: string, reading: Reading) => {
  const [freeA, freeB] = [
    withoutSetPhrases(a, reading),
    withoutSetPhrases(b, reading),
  ];
  const [inA, inB] = [MARKER.exec(freeA), MARKER.exec(freeB)];
  if (
    (!inB && losesItsDenial(a, freeB, reading)) ||
    (!inA && losesItsDenial(b, freeA, reading))
  )
    return true;
  if (Boolean(inA) === Boolean(inB)) return false;
  if (inA && dropsAnsweredPart(a, b)) return false;

  const denying = inA ? freeA : freeB;
  const marker = (inA ?? inB) as RegExpExecArray;
  const plain = inA ? b : a;
  return !(
    stagesContrast(denying, plain) ||
    // A denial the edit adds answers something only when it opens the quote: "a feature" to "not a bug
    // but a feature", and not "The drug is safe." to "The drug is not approved. It is safe."
    ((inA || !denying.slice(0, marker.index).trim()) &&
      (answersDenial(denying, marker, plain) ||
        answersInThePast(denying, plain) ||
        answersCleft(denying, plain))) ||
    saysNoItself(denying, marker, inA ? freeB : freeA)
  );
};

// An edit has to hold with the set phrases read narrow and, where it can differ, read whole
export function flipsNegation(a: string, b: string): boolean {
  return (
    flipsOn(a, b, NARROW) ||
    ((READS_WHOLE.test(a) || READS_WHOLE.test(b)) && flipsOn(a, b, WHOLE))
  );
}
