import { describe, expect, it } from "vitest";
import { EditCollector } from "@/lib/rewrite/collect";
import { MAX_EDITS, whyDrop } from "@/lib/rewrite/guard";
import { locateEdits } from "@/lib/rewrite/locate";

// Each rule of the checks on the model's output, row by row: what it lets go and what it holds. The
// groups follow docs/ARCHITECTURE.md. Rows that pass on purpose are in guard.test.ts, "what it cannot see".
const edit = (original: string, replacement: string) => ({
  original,
  replacement,
  reason: "r",
});
const flipped = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).toBe("negation_changed");
const same = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).toBeNull();
const changed = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).toBe("units_changed");
const swapped = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).toBe("figures_swapped");
const numbers = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).toBe("numbers_changed");
const dropped = (original: string, replacement: string) =>
  expect(whyDrop(edit(original, replacement))).not.toBeNull();

describe("a denial and the answer that follows it", () => {
  it.each([
    ["It isn't, but it works.", "It is, but it works."],
    ["Il ne l'est pas, mais il fonctionne.", "Il l'est, mais il fonctionne."],
    [
      "Sales rose; profits did not, but hiring held.",
      "Sales rose; profits did too, but hiring held.",
    ],
    [
      "Les ventes ont monté, les marges non, mais l'emploi tient.",
      "Les ventes ont monté, les marges aussi, mais l'emploi tient.",
    ],
    [
      "The drug is not approved, so it is late.",
      "The drug is approved and it is late.",
    ],
    [
      "Le médicament n'est pas autorisé, donc c'est tard.",
      "Le médicament est autorisé et c'est tard.",
    ],
    [
      "The drug is not approved in France. It is safe.",
      "The drug is approved. It is safe.",
    ],
    [
      "Le médicament n'est pas autorisé en France. C'est prudent.",
      "Le médicament est autorisé. C'est prudent.",
    ],
    [
      "Il n'a pas signé le contrat, mais il a payé.",
      "Il a signé, mais il a payé.",
    ],
    [
      "The vaccine does not work at all, that's serious.",
      "The vaccine works, that's serious.",
    ],
    [
      "Le vaccin ne marche pas du tout, c'est grave.",
      "Le vaccin marche, c'est grave.",
    ],
    [
      "The contract has not been signed yet, but it will be.",
      "The contract has been signed, but it will be.",
    ],
    [
      "They are not paid yet. They are angry.",
      "They are paid. They are angry.",
    ],
    [
      "Il ne viendra pas demain, c'est trop tard.",
      "Il viendra, c'est trop tard.",
    ],
    [
      "Le vote n'aura pas lieu cette semaine, c'est décidé.",
      "Le vote aura lieu, c'est décidé.",
    ],
    ["We did not start. It is late.", "We started. It is late."],
  ])("%s cannot become %s", flipped);

  it.each([
    ["We do not sell software but trust.", "We sell trust."],
    ["Is it a bug? No, it's a feature.", "Is it a bug? It's a feature."],
    ["is nothing but a tool", "is only a tool"],
    ["This isn't about speed. It's about trust.", "This is about trust."],
    [
      "L'éducation n'est pas une dépense : elle est un investissement.",
      "L'éducation est un investissement.",
    ],
    [
      "Le projet n'est pas une dépense : il est un investissement de 5 millions d'euros.",
      "Le projet est un investissement de 5 millions d'euros.",
    ],
    [
      "Les éleveurs ne sont pas des clients : ils sont 54 associés.",
      "Les éleveurs sont 54 associés.",
    ],
    [
      "The goal is not growth but survival.",
      "The goal is survival rather than growth.",
    ],
    [
      "L'objectif n'est pas la croissance mais la survie.",
      "L'objectif est la survie plutôt que la croissance.",
    ],
    [
      "The firm needs not 40 engineers but 40 nurses.",
      "The firm needs 40 nurses rather than 40 engineers.",
    ],
    [
      "The goal is not to cut 40 jobs but to save the plant.",
      "The goal is to save the plant rather than cut 40 jobs.",
    ],
    ["Not because it's cheap, but because it works.", "Because it works."],
    [
      "We chose it not because it's cheap but because it lasts 20 years.",
      "We chose it because it lasts 20 years.",
    ],
    [
      "Pas parce que c'est moins cher, mais parce que ça dure.",
      "Parce que ça dure.",
    ],
  ])("%s can become %s", same);

  it.each([
    [
      "The goal is not growth but survival.",
      "The goal is growth rather than survival.",
    ],
    [
      "L'objectif n'est pas la croissance mais la survie.",
      "L'objectif est la croissance plutôt que la survie.",
    ],
    [
      "The firm did not sell the plant, but it hired.",
      "The firm sold the plant instead of hiring.",
    ],
    [
      "Le groupe n'a pas vendu l'usine, mais il a embauché.",
      "Le groupe a vendu l'usine au lieu d'embaucher.",
    ],
    ["Not because it's cheap, but because it works.", "Because it's cheap."],
    [
      "We did not choose it because it's cheap, but it lasts.",
      "We chose it because it's cheap, but it lasts.",
    ],
    [
      "Pas parce que c'est moins cher, mais parce que ça dure.",
      "Parce que c'est moins cher.",
    ],
    ["Not because it's cheap.", "Because it's cheap."],
    [
      "Le médicament n'est pas autorisé. Il est sûr.",
      "Le médicament est autorisé. Il est sûr.",
    ],
    [
      "Les prix ne sont pas stables. Ils sont bas.",
      "Les prix sont stables. Ils sont bas.",
    ],
    [
      "Le contrat n'a pas été signé. Il reste à négocier.",
      "Il reste à négocier.",
    ],
  ])("%s still cannot become %s", flipped);

  it.each([
    [
      "Le médicament n'est pas remboursé quand il est prescrit.",
      "Le médicament est remboursé.",
    ],
    [
      "Le médicament n'est pas autorisé tant qu'il est à l'essai.",
      "Le médicament est autorisé.",
    ],
    [
      "Les salariés ne sont pas payés quand ils sont malades.",
      "Les salariés sont payés.",
    ],
    [
      "Le contrat n'est pas valable s'il est signé par un mineur.",
      "Le contrat est valable.",
    ],
    [
      "Le client n'est pas couvert lorsqu'il est à l'étranger.",
      "Le client est couvert.",
    ],
    [
      "Les enfants ne sont pas admis s'ils sont seuls.",
      "Les enfants sont admis.",
    ],
    ["Le client n'a pas payé quand il est parti.", "Le client a payé."],
    ["Le contrat n'a pas été signé et il est tard.", "Le contrat a été signé."],
    ["The staff are not paid when they are ill.", "The staff are paid."],
    ["The drug is not sold where it's banned.", "The drug is sold."],
    ["The plan does not work if it's late.", "The plan works."],
    ["It's not that it's expensive.", "It's expensive."],
    ["Ce n'est pas que c'est cher.", "C'est cher."],
  ])("%s states its condition, which answers nothing: %s", flipped);

  it.each([
    [
      "Le médicament n'est pas remboursé quand il est prescrit en France, mais il est vendu.",
      "Le médicament est remboursé quand il est prescrit.",
    ],
    [
      "The label does not say that it's safe in pregnancy, but it sells.",
      "The label says that it's safe.",
    ],
    [
      "Acme did not claim that it's safe in Ohio, but it sells.",
      "Acme says that it's safe, but it sells.",
    ],
  ])(
    "%s holds a pronoun inside what it denies, so nothing further on answers it: %s",
    flipped,
  );

  it.each([
    [
      "L'éducation n'est pas une dépense : elle est un investissement.",
      "L'éducation est un investissement.",
    ],
    [
      "Les éleveurs ne sont pas des clients : ils sont 54 associés.",
      "Les éleveurs sont 54 associés.",
    ],
    [
      "Le médicament n'est pas une dépense, il est un investissement.",
      "Le médicament est un investissement.",
    ],
    [
      "It's not that it's expensive, it's that it's late.",
      "It's that it's late.",
    ],
    ["No it's a feature.", "It's a feature."],
  ])("%s has an answer in a clause of its own: %s", same);

  it.each([
    [
      "It's a marathon, not a sprint. And it's not over.",
      "It's a marathon. And it's over.",
    ],
    ["Il n'hésite pas à payer mais ne signe pas.", "Il paie et signe."],
    [
      "It's not the price. It's the timing, and it's not late.",
      "It's the timing, and it's late.",
    ],
    [
      "Ce n'est pas le prix, c'est le délai, et ce n'est pas grave.",
      "C'est le délai, et c'est grave.",
    ],
  ])("%s holds another denial after its answer, which %s loses", flipped);

  it.each([
    [
      "It's a marathon, not a sprint. And it's not over.",
      "It's a marathon. And it's not over.",
    ],
    [
      "Ce n'est pas le prix, c'est le délai, et ce n'est pas grave.",
      "C'est le délai, et ce n'est pas grave.",
    ],
  ])("%s keeps the denial after its answer: %s", same);

  it.each([
    [
      "The goal is not growth but survival.",
      "Rather than survival, the goal is growth.",
    ],
    [
      "The goal is not growth but survival.",
      "Instead of survival, the goal is growth.",
    ],
    [
      "The firm did not sell the plant, but it hired.",
      "Instead of hiring, the firm sold the plant.",
    ],
    [
      "The firm needs not 40 engineers but 40 nurses.",
      "Rather than 40 nurses, the firm needs 40 engineers.",
    ],
    [
      "L'objectif n'est pas la croissance mais la survie.",
      "Plutôt que la survie, l'objectif est la croissance.",
    ],
    [
      "Le groupe n'a pas vendu l'usine, mais il a embauché.",
      "Au lieu d'embaucher, le groupe a vendu l'usine.",
    ],
    [
      "Le plan n'est pas un prêt mais une subvention.",
      "Au lieu d'une subvention, le plan est un prêt.",
    ],
  ])("%s cannot set its answer aside: %s", flipped);

  it.each([
    [
      "The goal is not growth but survival.",
      "Rather than growth, the goal is survival.",
    ],
    [
      "L'objectif n'est pas la croissance mais la survie.",
      "Plutôt que la croissance, l'objectif est la survie.",
    ],
    [
      "The firm needs not 40 engineers but 40 nurses.",
      "Rather than 40 engineers, the firm needs 40 nurses.",
    ],
  ])("%s can set aside what it denies: %s", same);
});

describe("a denial in the past, answered directly", () => {
  it.each([
    [
      "The drug wasn't approved in time. It was safe.",
      "The drug was approved. It was safe.",
    ],
    [
      "The firm was not fined for fraud. It was audited.",
      "The firm was fined. It was audited.",
    ],
    [
      "The drug was not approved by the agency. It was safe.",
      "The agency approved the drug. It was safe.",
    ],
    [
      "They were not paid on time. They were angry.",
      "They were paid. They were angry.",
    ],
    [
      "Le contrat n'a pas été signé par le client. Ce fut une erreur.",
      "Le contrat a été signé. Ce fut une erreur.",
    ],
    [
      "Le contrat n'était pas signé par le client. C'était un brouillon.",
      "Le contrat était signé. C'était un brouillon.",
    ],
    [
      "Le projet n'était pas rentable cette année. C'était attendu.",
      "Le projet était rentable. C'était attendu.",
    ],
    [
      "Le vaccin n'a pas été testé sur les enfants : ce fut une erreur.",
      "Le vaccin a été testé : ce fut une erreur.",
    ],
    [
      "The launch wasn't a failure. It wasted money.",
      "The launch wasted money.",
    ],
  ])("%s cannot become %s", flipped);

  it.each([".", "!", "?", "…", ";", ":", ",", "–", "—"])(
    "the answer has to come directly, past %s",
    (mark) => {
      flipped(
        `The firm wasn't fined${mark} Sales fell. It was sold.`,
        "The firm was sold. Sales fell.",
      );
    },
  );

  it.each([
    [
      "The launch wasn't a failure. It was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "The launch was not a failure. It was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "The launches were not failures. They were lessons.",
      "The launches were lessons.",
    ],
    [
      "The launches weren't failures. They were lessons.",
      "The launches were lessons.",
    ],
    [
      "Le lancement n'était pas un échec. C'était une leçon.",
      "Le lancement était une leçon.",
    ],
    ["It wasn't the price. That was the timing.", "The timing mattered."],
    ["It wasn't the price. This was the timing.", "The timing mattered."],
    [
      "It wasn't the price that mattered; it was the timing.",
      "The timing mattered.",
    ],
    [
      "The launch wasn't a failure! It was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "The launch wasn't a failure, it was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "The launch wasn't a failure – it was a lesson.",
      "The launch was a lesson.",
    ],
    [
      "The launch wasn't a failure — it was a lesson.",
      "The launch was a lesson.",
    ],
  ])("%s can become %s", same);

  it.each([
    [
      "The drug wasn't approved in time. It was safe.",
      "The drug was approved. It was safe.",
    ],
    [
      "It wasn't a bug in France. It was a feature.",
      "It was a bug. It was a feature.",
    ],
    [
      "It wasn't the price. It was the timing, and it did not help.",
      "It was the timing, and it did help.",
    ],
  ])("%s cannot become %s, behind a determiner", flipped);
});

describe("a contrast that says what it is not, then what it is", () => {
  it.each([
    [
      "It's not the price that matters, it's the timing.",
      "The timing matters.",
    ],
    [
      "It's not what you know that counts, it's who you know.",
      "Who you know counts.",
    ],
    ["Ce n'est pas le prix qui compte, c'est le délai.", "Le délai compte."],
    [
      "Ce n'est pas le prix qui compte, c'est le délai de 5 ans.",
      "Ce qui compte, c'est le délai de 5 ans.",
    ],
    [
      "Ce n'est pas la taille qui compte, mais la qualité.",
      "La qualité compte.",
    ],
    [
      "Ce n'est pas le prix qui compte, mais les 5 ans de garantie.",
      "Ce sont les 5 ans de garantie qui comptent.",
    ],
    [
      "The question isn't whether AI will change work, but how.",
      "The question is how AI will change work.",
    ],
    [
      "The question is not whether Acme will cut 40 jobs, but when.",
      "The question is when Acme will cut 40 jobs.",
    ],
    [
      "The question is no longer whether prices will rise 5%, but when.",
      "The question is when prices will rise 5%.",
    ],
    [
      "La question n'est pas de savoir si le groupe supprimera 40 postes, mais quand.",
      "La question est de savoir quand le groupe supprimera 40 postes.",
    ],
    [
      "La question n'est pas de savoir s'il supprimera 40 postes, mais quand.",
      "La question est de savoir quand il supprimera 40 postes.",
    ],
    [
      "Il ne s'agit plus de savoir si le groupe supprimera 40 postes, mais quand.",
      "Il s'agit de savoir quand le groupe supprimera 40 postes.",
    ],
  ])("%s can become %s", same);

  it.each([
    ["It's not the price that matters, it's the timing.", "The price matters."],
    ["It is not Reyes who paid, it is Smith.", "Reyes paid."],
    ["Ce n'est pas Reyes qui a payé, c'est Smith.", "Reyes a payé."],
    [
      "Ce n'est pas vrai que Reyes a payé, mais ce n'est pas lui qui a signé, c'est Smith.",
      "C'est vrai que Reyes a payé, mais Smith a signé.",
    ],
    [
      "We do not claim that prices fell, but wages did.",
      "We say that prices fell, but wages did.",
    ],
    [
      "The question is not whether Acme will cut 40 jobs.",
      "The question is whether Acme will cut 40 jobs.",
    ],
    [
      "The report does not say whether Acme will cut 40 jobs.",
      "The report says Acme will cut 40 jobs.",
    ],
    [
      "La question n'est pas de savoir si le groupe supprimera 40 postes.",
      "La question est de savoir si le groupe supprimera 40 postes.",
    ],
  ])("%s cannot become %s", flipped);

  it.each([
    [
      "It's not the price in France. It's the timing.",
      "It's the price. It's the timing.",
    ],
    [
      "Ce n'est pas le prix en France. C'est le délai.",
      "C'est le prix. C'est le délai.",
    ],
  ])("%s cannot become %s, with the word it stood on", flipped);

  it.each([
    [
      "It is not true that prices fell, but wages did.",
      "Prices fell, but wages did.",
    ],
    [
      "It's not true that the firm paid. It's late.",
      "The firm paid. It's late.",
    ],
    [
      "It is not the case that the firm paid, but it will.",
      "The firm paid, but it will.",
    ],
    [
      "It is not entirely true that prices fell, but wages did.",
      "Prices fell, but wages did.",
    ],
    [
      "Ce n'est pas vrai que le médicament marche. C'est un placebo.",
      "Le médicament marche. C'est un placebo.",
    ],
    [
      "Ce n'est pas vrai qu'il a payé 40 €, c'est son frère.",
      "Il a payé 40 €, c'est son frère.",
    ],
  ])("%s denies its clause, so it cannot become %s", flipped);

  it.each([
    [
      "It's not the price that matters, it's the timing.",
      "What matters is price.",
    ],
    ["It's not him who paid, it's Smith.", "He paid."],
    ["Ce n'est pas lui qui a payé, c'est son frère.", "Il a payé."],
    ["It is not Mr Reyes who paid, it is Smith.", "Reyes paid."],
    [
      "It's not the plant that lost $5 million, it's the head office.",
      "The plants lost $5 million.",
    ],
    [
      "It's not the price that matters, it's the timing, and it's not late.",
      "The timing matters, and it's late.",
    ],
  ])("%s says who it was, so it cannot become %s", flipped);

  it.each([
    ["Ce n'est pas lui qui paie désormais.", "Il paie désormais."],
    ["It is not him who made his debut", "He made his debut"],
  ])("%s has no answer inside a word: %s", flipped);

  it.each([
    [
      "It's not the price that matters, it's the timing.",
      "What matters is the timing.",
    ],
    ["It's not him who paid, it's Smith.", "Smith paid."],
    ["It's not speed that matters, it's trust.", "Trust matters."],
    [
      "It's not the true cost that matters, it's the timing.",
      "The timing matters.",
    ],
  ])("%s can keep what it says instead: %s", same);
});

describe("a denial the edit adds", () => {
  it.each([
    ["The drug is safe.", "The drug is not approved. It is safe."],
    [
      "Le médicament est sûr.",
      "Le médicament n'est pas autorisé, mais il est sûr.",
    ],
    ["The firm sold it.", "The firm did not pay, but it sold it."],
    [
      "The launch was a lesson.",
      "The launch wasn't a failure. It was a lesson.",
    ],
    [
      "Le lancement fut une leçon.",
      "Le lancement n'a pas été un échec : ce fut une leçon.",
    ],
  ])("%s cannot become %s", flipped);

  it("can open the quote with what it answers", () => {
    same("a feature", "not a bug but a feature");
    same("a tool", "not just a tool");
  });
});

describe("words that say no", () => {
  it.each([
    ["it is not certain", "it is unclear"],
    ["it is not written", "it is unknown"],
    ["it is not right", "it is unfair"],
    ["it is not allowed", "it is illegal"],
    ["it is not suitable", "it is unsafe"],
    ["it is not doable", "it is impossible"],
    ["ce n'est pas nécessaire", "c'est inutile"],
    ["ce n'est pas autorisé", "c'est illégal"],
    ["The firm no longer sells cars.", "The firm has ceased selling cars."],
    [
      "L'entreprise ne vend plus de voitures.",
      "L'entreprise a cessé de vendre des voitures.",
    ],
    [
      "L'entreprise ne vend plus de voitures.",
      "L'entreprise a arrêté de vendre des voitures.",
    ],
    ["They do not often come.", "They seldom come."],
    ["They do not often come.", "They hardly come."],
    ["They do not often come.", "They barely come."],
    ["They do not often come.", "They scarcely come."],
    ["Ils ne viennent pas souvent.", "Ils viennent rarement."],
    ["Les clients ne paient pas souvent.", "Les clients paient rarement."],
    ["Il n'a pas eu le temps.", "Il a à peine eu le temps."],
    ["Do not use it", "Avoid using it"],
    ["Not available today", "Unavailable today"],
    ["He is not kind", "He is unkind"],
    ["It is not moral", "It is immoral"],
    ["It is not logical", "It is illogical"],
    ["It is not regular", "It is irregular"],
    [
      "There is not much evidence for the 5% claim.",
      "There is little evidence for the 5% claim.",
    ],
    [
      "The plan did not do much for the 40 shops.",
      "The plan did little for the 40 shops.",
    ],
    [
      "Le service est sans frais pour les 40 communes.",
      "Le service est gratuit pour les 40 communes.",
    ],
    ["There are no fees", "It is free"],
    ["The plan has no fees", "A fee-free plan"],
  ])("%s can become %s", same);

  it.each([
    ["The rebels did not sign the truce.", "The rebels signed the ceasefire."],
    [
      "Les rebelles n'ont pas signé la trêve.",
      "Les rebelles ont signé le cessez-le-feu.",
    ],
    [
      "Le groupe n'a pas vendu sa filiale.",
      "Le groupe a annoncé la cession de sa filiale.",
    ],
    ["Il n'a pas signé le contrat.", "Il a signé le contrat peu après."],
    ["Les ventes n'ont pas baissé.", "Les ventes ont quelque peu baissé."],
    ["Les ventes n'ont pas doublé.", "Les ventes ont à peu près doublé."],
    ["Les prix ne montent pas.", "Les prix montent peu à peu."],
    ["Le contrat n'est pas signé.", "Le contrat sera signé sous peu."],
    ["The firm did not hire staff.", "The firm hired freelance staff."],
    ["The plane did not land in Doha.", "The plane made a stopover in Doha."],
    ["Le train ne passe pas par Lyon.", "Le train marque un arrêt à Lyon."],
    ["Le maire n'a pas signé.", "Le maire a signé l'arrêté."],
    [
      "The drug is not approved.",
      "The drug is approved and helps patients stop smoking.",
    ],
    [
      "Le médicament n'est pas autorisé.",
      "Le médicament est autorisé et peu coûteux.",
    ],
    ["The plan will not work.", "The plan will work, free of charge."],
    [
      "The board did not approve the plan.",
      "The board approved the plan for the few who asked.",
    ],
    ["L'entreprise n'a pas fermé.", "L'entreprise a fait faillite."],
    ["The judge did not sign.", "Judge Freeman signed."],
    ["Les clients ne paient pas.", "Les clients paient sans faille."],
    [
      "Les prix n'augmentent pas sans cesse.",
      "Les prix augmentent sans cesse.",
    ],
    [
      "The loan is not paid and the debt is secured.",
      "The loan is paid and the debt is unsecured.",
    ],
    [
      "Le plan n'est pas validé et les fonds sont disponibles.",
      "Le plan est validé et les fonds sont indisponibles.",
    ],
    [
      "We did not sign the contract.",
      "We signed the contract after a failed attempt.",
    ],
    ["Il n'a pas payé.", "Il a payé, ce qui évite un procès."],
    [
      "La banque n'a pas réussi le test.",
      "La banque a réussi le test, à peine.",
    ],
    ["The plan does not cut wages", "The plan is a wage-freeze"],
    ["It is available, not unavailable.", "It is unavailable."],
    ["The drug is not approved", "The drug is important"],
    ["There is not a ban", "There is a curfew"],
    ["We did not sign the contracts.", "We signed a few contracts."],
    ["Il n'a pas signé.", "Il a signé un peu."],
    ["They did not form a group", "They did inform a group"],
    ["The room has no light", "The room has sunlight"],
    ["The plan did not cost little.", "The plan cost little."],
    ["Le service n'est pas gratuit.", "Le service est gratuit."],
  ])("%s cannot become %s", flipped);

  it.each([
    [
      "The board did not approve the plan.",
      "The board approved the plan for the few who asked.",
    ],
    ["Il n'a pas signé le contrat.", "Il a signé le contrat peu après."],
    [
      "The loan is not paid and the debt is secured.",
      "The loan is paid and the debt is unsecured.",
    ],
    ["The drug is not approved and safe.", "The drug is approved and unsafe."],
    ["The drug is not approved as safe.", "The drug is approved as unsafe."],
    ["We did not sign many contracts.", "We signed a few contracts."],
    [
      "The drug is not approved.",
      "The drug is approved and helps patients stop smoking.",
    ],
    [
      "Les clients n'ont pas les moyens.",
      "Les clients ont les moyens d'éviter ce coût.",
    ],
  ])("%s cannot become %s, with its word further on", flipped);
});

describe("a contrast split in two", () => {
  it.each([
    ["I don't sell software. I sell trust.", "I sell trust."],
    ["You don't sell software. You sell trust.", "You sell trust."],
    ["They don't sell software. They sell trust.", "They sell trust."],
    ["It doesn't sell software. It sells trust.", "It sells trust."],
    [
      "Je ne vends pas de logiciel. Je vends la confiance.",
      "Je vends la confiance.",
    ],
    [
      "Tu ne vends pas de logiciel. Tu vends la confiance.",
      "Tu vends la confiance.",
    ],
    [
      "Elle ne vend pas de logiciel. Elle vend la confiance.",
      "Elle vend la confiance.",
    ],
    [
      "Ils ne vendent pas de logiciel. Ils vendent la confiance.",
      "Ils vendent la confiance.",
    ],
    [
      "Elles ne vendent pas de logiciel. Elles vendent la confiance.",
      "Elles vendent la confiance.",
    ],
    [
      "Vous ne vendez pas de logiciel. Vous vendez la confiance.",
      "Vous vendez la confiance.",
    ],
    [
      "On n'a pas vendu de logiciel. On a vendu la confiance.",
      "On a vendu la confiance.",
    ],
    ["We don't sell cars, we sell trust, we win.", "We sell trust, we win."],
    ["Not an hour, an age.", "An age."],
    ["Not the price, the timing.", "The timing."],
    ["Not a bug, a flaw, a feature.", "A flaw, a feature."],
    ["Pas un outil, un métier.", "Un métier."],
    ["Pas une idée, une méthode.", "Une méthode."],
    ["Pas le prix, le délai.", "Le délai."],
    ["Pas la vitesse, la rigueur.", "La rigueur."],
    ["Pas les prix, les délais.", "Les délais."],
    ["Pas des outils, des métiers.", "Des métiers."],
    ["Not a sprint — a marathon.", "A marathon."],
    ["Not a sprint: a marathon of 42 km.", "A marathon of 42 km."],
    ["Pas un outil : un métier.", "Un métier."],
    ["Pas un outil — un métier.", "Un métier."],
    ["Pas un outil. Pas un gadget. Un métier.", "Un métier."],
    ["Not for the money. For the love.", "For the love."],
    ["Not because it was cheap. Because it was good.", "Because it was good."],
    ["Not speed. Trust.", "Trust."],
    ["No fluff, no jargon, just 40 pages of facts.", "40 pages of facts."],
    ["No fluff. No jargon. Just 40 pages of facts.", "40 pages of facts."],
    ["No fluff. No jargon. Just 40 pages of facts.", "Just 40 pages of facts."],
    [
      "Pas de blabla, pas de jargon, juste 40 pages de faits.",
      "40 pages de faits.",
    ],
    [
      "Pas de blabla. Pas de jargon. Juste 40 pages de faits.",
      "40 pages de faits.",
    ],
    [
      "The firm doesn't sell software. It sells trust.",
      "The firm sells trust.",
    ],
    ["People don't buy products. They buy stories.", "People buy stories."],
    [
      "The report doesn't offer solutions. It asks 5 questions.",
      "The report asks 5 questions.",
    ],
    ["Good design doesn't shout. It whispers.", "Good design whispers."],
    [
      "Le groupe ne vend pas de logiciels. Il vend de la confiance.",
      "Le groupe vend de la confiance.",
    ],
    [
      "Les clients n'achètent pas un produit. Ils achètent une histoire.",
      "Les clients achètent une histoire.",
    ],
    [
      "Le rapport n'offre pas de solutions. Il pose 5 questions.",
      "Le rapport pose 5 questions.",
    ],
  ])("%s can lose its first half: %s", same);

  it.each([
    ["Wells did not pay. We sold.", "We sold."],
    ["We did not pay. Wells sold.", "Wells sold."],
    ["Not a bug, we said.", "We said."],
    ["Not all tests passed. The release shipped.", "The release shipped."],
    ["Not a cent was paid. The firm closed.", "The firm closed."],
    ["Not a cent was paid, the firm closed.", "The firm closed."],
    ["Not one patient recovered. The trial ended.", "The trial ended."],
    ["Not approved by the agency. Sold in France.", "Sold in France."],
    [
      "Not all of them paid. Not all of them signed. The bank closed.",
      "The bank closed.",
    ],
    ["Not a single patient died, the trial ended.", "The trial ended."],
    [
      "Pas un centime n'a été versé. La société a fermé.",
      "La société a fermé.",
    ],
    [
      "Pas un centime n'a été versé, la société a fermé.",
      "La société a fermé.",
    ],
    ["Pas de remboursement. Le contrat est clos.", "Le contrat est clos."],
    [
      "Pas un seul patient n'a guéri. L'essai a pris fin.",
      "L'essai a pris fin.",
    ],
    ["Pas approuvé par l'agence. Vendu en France.", "Vendu en France."],
    ["Pas encore signé. Le contrat tient.", "Le contrat tient."],
    ["Pas de réponse du ministère. Le projet avance.", "Le projet avance."],
    ["Not a sprint: a marathon.", "A sprint: a marathon."],
    ["Not a sprint — a marathon.", "A sprint."],
    ["Not a loan: a grant of $5 million.", "A loan: a grant of $5 million."],
    ["Pas un outil : un métier.", "Un outil."],
    ["No refund, just a credit of $5.", "A refund, just a credit of $5."],
    ["No refund, just a credit.", "A refund."],
    ["Pas de remboursement, juste un avoir.", "Un remboursement."],
    [
      "People don't buy products. They buy stories.",
      "People buy products. They buy stories.",
    ],
    [
      "The firm did not pay the fine. It sold the plant.",
      "The firm sold the plant.",
    ],
    [
      "Le contrat n'a pas été signé. Il reste à négocier.",
      "Le contrat reste à négocier.",
    ],
  ])("%s cannot lose its first half: %s", flipped);

  it.each([
    ["Not a product. An experience.", "An experience."],
    ["Not a cost. An investment.", "An investment."],
    ["Not an hour. A lifetime.", "A lifetime."],
    ["Pas un outil. Une méthode.", "Une méthode."],
    ["Pas une idée. Un métier.", "Un métier."],
    ["Pas le prix. La qualité.", "La qualité."],
    ["Pas de promesses. Des preuves.", "Des preuves."],
    ["Pas de magie. Du travail.", "Du travail."],
    ["Pas un outil. Un métier.", "Un métier."],
    ["Pas un outil, une méthode.", "Une méthode."],
  ])("%s can lose its first half: %s, when it names one thing", same);

  it.each([
    ["Not a cent was paid. The firm closed.", "The firm closed."],
    [
      "Pas un centime n'a été versé. La société a fermé.",
      "La société a fermé.",
    ],
    ["Pas de remboursement. Le contrat est clos.", "Le contrat est clos."],
    ["Not a sprint: a marathon.", "A sprint: a marathon."],
    ["Not a cent. The firm", "The firm"],
    ["Not a chance. The study", "The study"],
    ["Pas un centime. La société", "La société"],
  ])("%s cannot lose its first half: %s, which says something", flipped);

  it.each([
    [
      "Le groupe ne paiera pas l'amende. Il vendra l'usine.",
      "Le groupe vendra l'usine.",
    ],
    [
      "Le groupe n'achètera pas l'usine. Il vendra ses parts.",
      "Le groupe vendra ses parts.",
    ],
    ["Le client ne l'a pas signé. Il a payé.", "Le client a payé."],
    [
      "Les élus ne l'ont pas voté. Ils ont quitté la salle.",
      "Les élus ont quitté la salle.",
    ],
    [
      "Les contrats ne sont pas signés. Ils restent à négocier.",
      "Les contrats restent à négocier.",
    ],
  ])("%s states a fact in another tense, so it cannot lose it: %s", flipped);

  it.each([
    [
      "Le groupe ne vend pas de logiciels. Il vend de la confiance.",
      "Le groupe vend de la confiance.",
    ],
    [
      "Les clients n'achètent pas un produit. Ils achètent une histoire.",
      "Les clients achètent une histoire.",
    ],
    ["Le groupe ne le vend pas. Il le loue.", "Le groupe le loue."],
    ["Les clients ne paient pas. Ils empruntent.", "Les clients empruntent."],
  ])("%s has a verb of its own in the present: %s", same);
});

describe("a contrast with its answer first", () => {
  it.each([
    ["It's a marathon, not a sprint", "It's a marathon"],
    ["It is a marathon, not a sprint.", "It is a marathon."],
    ["That's a marathon, not a sprint.", "That's a marathon."],
    ["Il s'agit d'un marathon, pas d'un sprint.", "Il s'agit d'un marathon."],
    ["These are 400 people, not numbers.", "These are 400 people."],
    ["It was a 5-year marathon, not a sprint.", "It was a 5-year marathon."],
    ["They're partners, not clients.", "They're partners."],
    ["They were partners, not clients.", "They were partners."],
    ["Ce sont 400 personnes, pas des chiffres.", "Ce sont 400 personnes."],
    [
      "C'était une leçon de 5 ans, pas un échec.",
      "C'était une leçon de 5 ans.",
    ],
    [
      "C'est un marathon de 42 km et non un sprint.",
      "C'est un marathon de 42 km.",
    ],
    ["It's a marathon — not a sprint.", "It's a marathon."],
    ["C'est un marathon — pas un sprint.", "C'est un marathon."],
    [
      "It's a marathon, not a sprint, and it lasts 5 years.",
      "It's a marathon, and it lasts 5 years.",
    ],
    [
      "It's a marathon, not a sprint. Sales rose.",
      "It's a marathon. Sales rose.",
    ],
    [
      "C'est un marathon, pas un sprint. Les ventes montent.",
      "C'est un marathon. Les ventes montent.",
    ],
    [
      "Sales rose. It's a marathon, not a sprint. Costs fell.",
      "Sales rose. It's a marathon. Costs fell.",
    ],
    ["It's about trust, not speed.", "It's about trust."],
    ["It's about trust, not about speed.", "It's about trust."],
    ["It's a question of will, not of money.", "It's a question of will."],
    [
      "C'est une question de volonté, pas d'argent.",
      "C'est une question de volonté.",
    ],
  ])("%s can become %s", same);

  it.each([".", "!", "?", "…"])("reads a sentence up to %s", (mark) => {
    same(
      `Sales rose${mark} It's a marathon, not a sprint.`,
      `Sales rose${mark} It's a marathon.`,
    );
    flipped(
      `It's late${mark} Reyes signed, not Smith.`,
      `It's late${mark} Reyes signed.`,
    );
    flipped(
      `It's a marathon, not a sprint${mark} Sales rose.`,
      "It's a marathon.",
    );
    same(`It's a marathon, not a sprint${mark}`, `It's a marathon${mark}`);
  });

  it.each([
    ["He said it's a marathon, not a sprint.", "He said it's a marathon."],
    ["It issues refunds, not loans.", "It issues refunds."],
    ["It's a new drug, not yet approved.", "It's a new drug."],
    [
      "C'est un nouveau médicament, pas encore autorisé.",
      "C'est un nouveau médicament.",
    ],
    [
      "It is approved for adults, not for children.",
      "It is approved for adults.",
    ],
    ["C'est autorisé en France, pas en Espagne.", "C'est autorisé en France."],
    ["Il s'agit d'un prêt, non remboursé à ce jour.", "Il s'agit d'un prêt."],
    ["It's a loan, not repaid to this day.", "It's a loan."],
    ["This is a contract, not signed by the client.", "This is a contract."],
    ["That's the plan, not approved by the board.", "That's the plan."],
    [
      "The report is out. It's a draft, not reviewed by anyone.",
      "The report is out. It's a draft.",
    ],
    [
      "Le rapport est sorti. C'est un brouillon, pas relu par le comité.",
      "Le rapport est sorti. C'est un brouillon.",
    ],
    ["They were paid, not all of them.", "They were paid."],
    ["It was paid, not in full.", "It was paid."],
    ["It's paid, not in full.", "It's paid."],
    ["C'était payé, pas en entier.", "C'était payé."],
    ["It was Reyes, not Smith.", "It was Smith."],
  ])("%s cannot become %s", flipped);

  it.each([
    ["It's a new drug, not yet approved.", "It's a new drug."],
    [
      "It is approved for adults, not for children.",
      "It is approved for adults.",
    ],
    ["C'est autorisé en France, pas en Espagne.", "C'est autorisé en France."],
    ["It's a loan, not repaid to this day.", "It's a loan."],
    ["They were paid, not all of them.", "They were paid."],
    ["It was paid, not in full.", "It was paid."],
    ["It was signed, not how the board wanted.", "It was signed."],
  ])("%s cannot become %s, when the part that goes limits what stays", flipped);
});

describe("a staged contrast", () => {
  it.each([
    ["This wouldn't just save time", "This would save time"],
    ["It hasn't just saved time", "It has saved time"],
    ["They haven't just saved time", "They have saved time"],
    ["It hadn't just saved time", "It had saved time"],
    [
      "Cette étude ne se limite pas aux notes",
      "Cette étude porte sur les notes",
    ],
    [
      "Cette étude ne se réduit pas aux notes",
      "Cette étude porte sur les notes",
    ],
    [
      "Cette étude ne se borne pas aux notes",
      "Cette étude porte sur les notes",
    ],
    ["Ce n'est pas qu'une idée.", "C'est une idée."],
    ["Ce n'était pas qu'un outil.", "C'était un outil."],
    ["not only fast and not only cheap", "fast and cheap"],
    [
      "L'éducation ne se résume pas aux notes : elle ouvre le champ des possibles.",
      "L'éducation ouvre le champ des possibles.",
    ],
    [
      "La réforme ne s'arrête pas là : elle touche aussi les retraites.",
      "La réforme touche aussi les retraites.",
    ],
    [
      "Le problème n'est pas tant le coût que le calendrier.",
      "Le problème est le calendrier.",
    ],
    ["The issue is not so much cost as timing.", "The issue is timing."],
    [
      "The new rule isn't so much a ban as a 5% levy.",
      "The new rule is a 5% levy.",
    ],
    [
      "It wasn't so much the price as the 5-year delay.",
      "It was the 5-year delay.",
    ],
    ["Il est rapide et pas que.", "Il est rapide."],
    ["Non pas un outil, mais un métier", "Un métier"],
    [
      "Le groupe ne s'est pas contenté de réduire ses coûts de 12 %, il a rebâti son offre.",
      "Le groupe a réduit ses coûts de 12 % et rebâti son offre.",
    ],
    [
      "Ils ne se sont pas contentés de réduire les coûts de 12 %, ils ont rebâti l'entreprise.",
      "Ils ont réduit les coûts de 12 % et rebâti l'entreprise.",
    ],
    [
      "Ce projet ne fait pas que réduire les coûts de 12 %, il change la donne.",
      "Ce projet réduit les coûts de 12 % et change la donne.",
    ],
    [
      "Le groupe n'a pas fait que réduire ses coûts de 12 %.",
      "Le groupe a réduit ses coûts de 12 %.",
    ],
    [
      "Ne vous contentez pas de lire les 40 pages : appliquez-les.",
      "Lisez les 40 pages et appliquez-les.",
    ],
    [
      "Il ne suffit pas de réduire les coûts de 12 %, il faut aussi embaucher.",
      "Il faut réduire les coûts de 12 % et embaucher.",
    ],
    [
      "It is not enough to cut costs by 12%; firms must also hire.",
      "Firms must cut costs by 12% and hire.",
    ],
  ])("%s can become %s", same);

  it.each([
    ["Il n'y a pas tant de monde", "Il y a du monde"],
    ["Il n'y a pas tant d'erreurs", "Il y a des erreurs"],
    [
      "Le contrat ne se limite pas aux salariés.",
      "Le contrat se limitera aux salariés.",
    ],
    [
      "Le contrat ne se limite pas aux salariés.",
      "Le contrat est limité aux salariés.",
    ],
    ["L'enquête ne s'arrête pas là.", "L'enquête s'est arrêtée là."],
    ["Le train ne s'arrête pas à Lyon.", "Le train fait halte à Lyon."],
    ["Le train ne s'arrête pas à Lyon.", "Le train s'arrêtera à Lyon."],
    ["La dette ne se réduit pas.", "La dette baisse."],
    ["La dette ne se réduit pas.", "La dette se réduira."],
    ["Le déficit ne se réduit pas.", "Le déficit recule."],
    ["Il ne se contente pas de payer.", "Il s'est contenté de payer."],
    ["Ils ne se limitent pas à payer.", "Ils se sont limités à payer."],
    [
      "Le coût ne se résume pas à la licence.",
      "Le coût se résumera à la licence.",
    ],
    ["Elle ne se borne pas à signer.", "Elle s'est bornée à signer."],
    [
      "On ne signera pas tant que le prix monte.",
      "On signera quand le prix monte.",
    ],
    [
      "Il ne paiera pas tant que le comité hésite.",
      "Il paiera pendant que le comité hésite.",
    ],
    ["The firm did not so much as apologize.", "The firm apologized."],
    ["The fee is not so much.", "The fee is high."],
    ["Il n'y a pas tant que ça.", "Il y en a beaucoup."],
    ["Il n'en a pas tant vendu.", "Il en a beaucoup vendu."],
    ["Les ventes ne montent pas tant.", "Les ventes montent beaucoup."],
    [
      "Elle demande que le client signe et pas que le client paie.",
      "Elle demande que le client signe et paie.",
    ],
    [
      "Il a signé non pas le contrat, mais l'avenant.",
      "Il a signé le contrat.",
    ],
    ["Le groupe ne s'est pas arrêté.", "Le groupe s'est arrêté."],
    ["Ne vous contentez pas de lire.", "Contentez-vous de lire."],
    [
      "La tablette ne fait pas que remplacer le manuel.",
      "La tablette ne fait que remplacer le manuel.",
    ],
    ["Il ne suffit pas de payer.", "Il suffit de payer."],
    ["It is not enough to pay.", "It is enough to pay."],
  ])("%s cannot become %s", flipped);

  it.each([
    ["La dette ne s'est pas réduite.", "La dette a baissé."],
    ["Le déficit ne s'est pas réduit de 5 %.", "Le déficit a reculé de 5 %."],
    [
      "Les dépenses ne se sont pas réduites de 12 %.",
      "Les dépenses ont baissé de 12 %.",
    ],
    ["Le chômage ne s'est pas réduit en 2024.", "Le chômage a baissé en 2024."],
    ["Le train ne s'est pas arrêté à Lyon.", "Le train a fait halte à Lyon."],
    ["Les usines ne se sont pas arrêtées.", "Les usines ont fermé."],
    ["L'enquête ne s'est pas arrêtée.", "L'enquête a pris fin."],
    ["La dette a baissé.", "La dette ne s'est pas réduite."],
  ])("%s is a plain verb in the past, so it cannot become %s", flipped);

  it.each([
    [
      "Le groupe ne s'est pas contenté de réduire ses coûts, il a rebâti son offre.",
      "Le groupe a réduit ses coûts et rebâti son offre.",
    ],
    [
      "La réforme ne s'est pas arrêtée là : elle touche aussi les retraites.",
      "La réforme touche aussi les retraites.",
    ],
    ["Il ne s'est pas borné à payer, il a signé.", "Il a payé et signé."],
  ])("%s stages a contrast in the past: %s", same);

  it.each([
    ["Il ne suffit pas.", "Il est suffisant."],
    [
      "Le budget est voté. Il ne suffit pas.",
      "Le budget est voté. Il est suffisant.",
    ],
    [
      "Il ne suffit pas à couvrir les 40 salaires.",
      "Il couvre les 40 salaires.",
    ],
    [
      "Il ne suffit pas à rembourser les 5 millions.",
      "Il rembourse les 5 millions.",
    ],
    ["Il ne suffit pas de payer.", "Il suffira de payer."],
  ])("%s has a real subject, so it cannot become %s", flipped);

  it.each([
    [
      "Il ne suffit pas de payer 40 €, il faut payer une somme suffisante.",
      "Il suffit de payer 40 €.",
    ],
  ])("%s cannot become %s, though a word further on starts the same", flipped);

  it.each([
    [
      "Il ne suffit pas de réduire les coûts de 12 %, il faut aussi embaucher.",
      "Il faut réduire les coûts de 12 % et embaucher.",
    ],
    [
      "Il ne suffit pas d'embaucher, il faut former.",
      "Il faut embaucher et former.",
    ],
  ])("%s stages it with il ne suffit pas de: %s", same);

  it.each([
    ["These aren't so much errors as choices.", "These are errors."],
    ["He didn't so much resign as get fired.", "He resigned."],
    [
      "The firm doesn't so much sell cars as lease them.",
      "The firm sells cars.",
    ],
    ["They weren't so much fired as moved.", "They were fired."],
    ["The issue is not so much cost as timing.", "The issue is cost."],
    ["Ce n'est pas tant le prix que le délai.", "C'est le prix."],
    ["Ce ne sont pas tant des erreurs que des choix.", "Ce sont des erreurs."],
  ])("%s denies its first half, so it cannot become %s", flipped);

  it.each([
    ["These aren't so much errors as choices.", "These are choices."],
    [
      "The new rule isn't so much a ban as a 5% levy.",
      "The new rule is a 5% levy.",
    ],
    [
      "It wasn't so much the price as the 5-year delay.",
      "It was the 5-year delay.",
    ],
    ["Ce n'est pas tant le prix que le délai.", "C'est le délai."],
    ["Ce ne sont pas tant des erreurs que des choix.", "Ce sont des choix."],
  ])("%s can keep its second half: %s", same);

  it.each([
    ["N'hésitez pas à nous contacter.", "Contactez-nous."],
    [
      "L'éducation n'a jamais été aussi importante qu'aujourd'hui.",
      "L'éducation est importante.",
    ],
    ["Make no mistake, the plan works.", "The plan works."],
  ])("%s can lose its filler: %s", same);

  it.each([
    [
      "Il n'oublie pas de payer ses impôts.",
      "Il a oublié de payer ses impôts.",
    ],
    ["Elle n'oublia pas de signer.", "Elle a oublié de signer."],
    [
      "Le conseil n'hésite pas à licencier.",
      "Le conseil a hésité à licencier.",
    ],
    ["Il n'hésite presque pas.", "Il doute."],
    ["Il n'oublie pas les 40 salariés.", "Il oublie les 40 salariés."],
    [
      "Elle n'a jamais été aussi riche que lui.",
      "Elle était aussi riche que lui.",
    ],
    [
      "Elle n'a jamais été aussi riche qu'en 2019.",
      "Elle était aussi riche qu'en 2019.",
    ],
    [
      "Le groupe n'a jamais été plus grand que son rival.",
      "Le groupe a été plus grand que son rival.",
    ],
    [
      "Les effectifs n'ont jamais été plus de 40.",
      "Les effectifs ont dépassé 40.",
    ],
    ["The auditors make no mistake.", "The auditors make a mistake."],
    [
      "We make no mistake in the accounts.",
      "We make a mistake in the accounts.",
    ],
    ["They make no mistakes.", "They err."],
  ])("%s keeps the word its filler stood on, so it cannot become %s", flipped);
});

describe("set phrases", () => {
  it.each([
    ["He chose not to mention the cost", "He chose to cite the cost"],
    ["Il a signé sans parler de son fils", "Il a signé en évoquant son fils"],
    ["Sans parler, il a signé", "En criant, il a signé"],
    ["No question was asked", "The panel stayed silent"],
    ["No small business was hurt", "Every firm survived"],
    ["That's not all it does", "It does everything"],
    ["That is not all it does", "It does everything"],
    ["Ce n'est pas tout ce qu'il fait", "Il fait cela"],
    ["Il n'oublie presque pas", "Il perd presque tout"],
    ["Il n'hésite presque pas", "Il doute"],
    ["He paid for not signing", "He paid for signing"],
    [
      "We make no mistake in the accounts.",
      "We make a mistake in the accounts.",
    ],
    ["The auditors make no mistake.", "The auditors make a mistake."],
    ["No surprise fees apply.", "Fees apply."],
    ["There are no surprise charges.", "There are charges."],
    ["Fees apply.", "No surprise fees apply."],
    ["No accident insurance is included.", "Insurance is included."],
    ["No accident victims were reported.", "Victims were reported."],
    ["No wonder drug exists.", "A drug exists."],
    ["No stranger entered the house.", "A man entered the house."],
    [
      "No exaggeration was found in the report.",
      "An error was found in the report.",
    ],
    ["No coincidence was recorded.", "A match was recorded."],
    ["No matter was left open.", "A point was left open."],
    [
      "No doubt remains about the results.",
      "Questions remain about the results.",
    ],
    ["He has never been so much as questioned.", "He has been questioned."],
    ["Prices have never been more than 40.", "Prices have been above 40."],
    [
      "Elle n'a jamais été aussi riche que lui.",
      "Elle était aussi riche que lui.",
    ],
    ["Invoices are paid late or not at all.", "Invoices are paid late."],
    ["The invoices were late or not paid.", "The invoices were late or paid."],
    [
      "Either the firm pays, or not all staff get paid.",
      "Either the firm pays, or all staff get paid.",
    ],
    [
      "Les salaires sont en retard ou pas payés.",
      "Les salaires sont en retard ou payés.",
    ],
    [
      "Les factures sont payées en retard ou pas du tout.",
      "Les factures sont payées en retard.",
    ],
    ["Les contrats sont signés ou non signés.", "Les contrats sont signés."],
    [
      "Il n'oublie pas de payer ses impôts.",
      "Il a oublié de payer ses impôts.",
    ],
    ["Elle n'oublia pas de signer.", "Elle a oublié de signer."],
    [
      "Le conseil n'hésite pas à licencier.",
      "Le conseil a hésité à licencier.",
    ],
    ["The refund cannot be denied.", "The refund is denied."],
    ["The risk cannot be overstated.", "The risk is overstated."],
    ["These orders cannot be ignored.", "These orders are ignored."],
    [
      "Ce n'est pas par hasard que les ventes ont baissé.",
      "C'est un hasard que les ventes ont baissé.",
    ],
    [
      "Ce n'est pas un hasard si les ventes ont baissé.",
      "C'est par hasard que les ventes ont baissé.",
    ],
    [
      "Ce n'est pas une coïncidence si le prix monte.",
      "C'est par coïncidence que le prix monte.",
    ],
    ["Personne n'ignore le coût", "Tout le monde ignore le coût"],
    ["Ce n'est plus un secret", "C'est un secret"],
    ["Ce n'est pas une coïncidence", "C'est une coïncidence"],
    [
      "The fund did not pay. Not to mention the fine.",
      "The fund paid. Not to mention the fine.",
    ],
    [
      "Le fonds n'a pas payé. Sans compter l'amende.",
      "Le fonds a payé. Sans compter l'amende.",
    ],
    ["It should not be underestimated.", "It should be underestimated."],
    ["It should not be overlooked.", "It is overlooked."],
    ["The stakes have never been higher.", "The stakes have been higher."],
    [
      "Son efficacité n'est plus à démontrer.",
      "Son efficacité est à démontrer.",
    ],
    ["Ce choix n'est pas anodin.", "Ce choix est anodin."],
    ["Les fonds ne manquent pas.", "Les fonds manquent."],
    [
      "Le groupe n'a pas plus de 40 salariés.",
      "Le groupe a plus de 40 salariés.",
    ],
    ["The project is not without risk.", "The project is without risk."],
  ])("%s is a denial that %s loses", flipped);

  it.each([";", ":", "(", "–", "—", ".", "!", "?"])(
    "a phrase stands after %s",
    (mark) => {
      same(
        `Le prix monte${mark} sans compter les frais`,
        `Le prix monte${mark} hors frais`,
      );
    },
  );

  it.each([".", ",", ";", ":", "!", "?"])(
    "no question and no secret end at %s",
    (mark) => {
      same(`There is no question${mark} it works`, "It works");
      same(`This is no secret${mark} sales fell`, "Sales fell");
    },
  );

  it.each([".", ",", ":", ";", "!", "…", "–", "—", " -"])(
    "not all ends at %s",
    (mark) => {
      same(`But that's not all${mark} we also hired.`, "We also hired.");
      same(`But that is not all${mark} we also hired.`, "We also hired.");
      same(
        `Et ce n'est pas tout${mark} le groupe embauche.`,
        "Le groupe embauche.",
      );
    },
  );

  it.each("part measure number amount achievement matter".split(" "))(
    "no small %s",
    (word) => {
      same(
        `It is due in no small ${word} to luck`,
        "It is largely due to luck",
      );
    },
  );

  it.each([".", "!", "?"])(
    "a ne before %s does not reach a later rien que",
    (mark) => {
      same(
        `Il ne reste que 5 places${mark} Rien que le coût pèse.`,
        `Il ne reste que 5 places${mark} Le coût pèse.`,
      );
    },
  );

  it.each([
    ["There is no question", "It is certain"],
    ["There is no question about it", "It is certain"],
    ["There is no question whether it works", "It works"],
    ["It is no secret", "Everyone knows"],
    ["It is no secret to anyone", "Everyone knows"],
    ["But that's not all", "Also"],
    ["But that is not all", "Also"],
    ["Et ce n'est pas tout", "Aussi"],
    ["Do not forget that costs rose 5%.", "Costs rose 5%."],
    ["sans plus tarder, signons", "signons"],
    ["Pas besoin de préciser que les ventes baissent", "Les ventes baissent"],
    ["Pas besoin de dire que les ventes baissent", "Les ventes baissent"],
    ["Pas besoin de souligner que les ventes baissent", "Les ventes baissent"],
    [
      "Il n'est pas étonnant que les ventes aient baissé.",
      "Les ventes ont baissé.",
    ],
    [
      "Il n'en demeure pas moins que les ventes baissent",
      "Les ventes baissent",
    ],
    [
      "Une seule chose : rien que le coût compte.",
      "Une seule chose : le coût compte.",
    ],
    [
      "Ce n'est pas un secret : c'est un secret de polichinelle.",
      "Tout le monde le sait : c'est un secret de polichinelle.",
    ],
    ["It comes as no surprise that sales fell.", "Sales fell."],
    ["No surprise there.", "As expected."],
    ["Make no mistake, the plan works.", "The plan works."],
    ["It has never been more important", "It is important"],
    ["whether or not it works", "whether it works"],
    ["qu'il vienne ou non", "qu'il vienne"],
    ["N'oubliez pas de signer.", "Pensez à signer."],
    ["N'oublions pas les 5 %.", "Gardons en tête les 5 %."],
    ["N'oublie pas de signer.", "Pense à signer."],
    ["N'hésitez pas à nous contacter.", "Contactez-nous."],
    ["The risk cannot be overstated.", "The risk is high."],
    [
      "The cost of $5 million should not be overlooked.",
      "The cost of $5 million matters.",
    ],
    ["The importance of sleep should not be underestimated.", "Sleep matters."],
    [
      "The project, which cost $48 million, is not without challenges.",
      "The project, which cost $48 million, has challenges.",
    ],
    [
      "The need for clean energy has never been greater.",
      "Clean energy is needed now.",
    ],
    ["The stakes have never been higher.", "The stakes are high."],
    ["It is not surprising that sales fell 5%.", "Sales fell 5%."],
    ["It's not a coincidence that sales fell 5%.", "Sales fell 5%."],
    [
      "Ce choix n'est pas anodin : il coûte 5 millions d'euros.",
      "Ce choix coûte 5 millions d'euros.",
    ],
    [
      "Il n'est pas rare de voir 40 personnes attendre.",
      "On voit souvent 40 personnes attendre.",
    ],
    [
      "Cette hausse de 5 % ne manquera pas de peser sur les ménages.",
      "Cette hausse de 5 % pèsera sur les ménages.",
    ],
    [
      "Le groupe n'en est pas moins solide, avec 5 millions d'euros de réserves.",
      "Le groupe reste solide, avec 5 millions d'euros de réserves.",
    ],
    [
      "Pas étonnant que les ventes aient baissé de 5 %.",
      "Les ventes ont baissé de 5 %.",
    ],
    [
      "Il ne faut pas sous-estimer le coût de 5 millions d'euros.",
      "Le coût de 5 millions d'euros compte.",
    ],
    [
      "Le groupe n'a pas plus de 40 salariés.",
      "Le groupe a au plus 40 salariés.",
    ],
    [
      "Son efficacité n'est plus à démontrer : 40 % de pannes en moins.",
      "Son efficacité est démontrée : 40 % de pannes en moins.",
    ],
    ["Ces problèmes ne datent pas d'hier.", "Ces problèmes sont anciens."],
    ["Les défis ne manquent pas.", "Les défis sont nombreux."],
    [
      "L'éducation n'a jamais été aussi importante qu'aujourd'hui.",
      "L'éducation est importante.",
    ],
    ["On ne peut ignorer ce risque de 5 %.", "Ce risque de 5 % est réel."],
    ["On ne peut pas nier ce risque de 5 %.", "Ce risque de 5 % est réel."],
    [
      "Sales rose 5%. Not to mention the fine.",
      "Sales rose 5%, and there is the fine.",
    ],
    [
      "Les ventes montent. Sans oublier les coûts.",
      "Les ventes et les coûts montent.",
    ],
    [
      "Les ventes montent. Sans parler des coûts.",
      "Les ventes et les coûts montent.",
    ],
    [
      "Les ventes montent. Sans compter les frais de 5 %.",
      "Les ventes montent, et les frais de 5 % aussi.",
    ],
    [
      "There is no question that it did not work.",
      "The question is settled: it did not work.",
    ],
    [
      "The question is settled: it did not work.",
      "There is no question that it did not work.",
    ],
  ])("%s denies nothing, so %s can stand", same);

  it("a comma is no word, but it undoes a phrase", () => {
    flipped("No more than 40 came", "No, more than 40 came");
  });

  it.each([
    ["Prices have never been higher than 40.", "Prices have been above 40."],
    [
      "Unemployment has never been higher than 12%.",
      "Unemployment has exceeded 12%.",
    ],
    [
      "The dose has never been greater than 5 mg.",
      "The dose has exceeded 5 mg.",
    ],
    [
      "Losses have never been greater than $5 million.",
      "Losses exceeded $5 million.",
    ],
    [
      "The drug has never been better than a placebo.",
      "The drug has beaten a placebo.",
    ],
    [
      "Les effectifs n'ont jamais été plus de 40.",
      "Les effectifs ont dépassé 40.",
    ],
    ["Le taux n'a jamais été plus de 5 %.", "Le taux a dépassé 5 %."],
  ])("%s is a bound, which %s passes", flipped);

  it.each([
    ["The stakes have never been higher.", "The stakes are high."],
    [
      "The need for clean energy has never been greater.",
      "Clean energy is needed now.",
    ],
    [
      "The stakes have never been higher than they are today.",
      "The stakes are high.",
    ],
    ["Demand has never been greater than it is now.", "Demand is great."],
    ["Il n'a jamais été plus riche.", "Il est très riche."],
  ])("%s is the stock line, so it can become %s", same);

  it.each([
    [
      "The tenant may not without consent sublet the flat.",
      "The tenant may sublet the flat.",
    ],
    [
      "The tenant shall not without prior consent assign the lease.",
      "The tenant shall assign the lease.",
    ],
    [
      "Staff must not without approval share the data.",
      "Staff must share the data.",
    ],
    [
      "You may not without written consent copy the file.",
      "You may copy the file.",
    ],
    ["We will not without a vote sell the plant.", "We will sell the plant."],
  ])("%s forbids, so it cannot become %s", flipped);

  it.each([
    [
      "The project, which cost $48 million, is not without challenges.",
      "The project, which cost $48 million, has challenges.",
    ],
    ["The project is not without risk.", "The project carries risk."],
    [
      "The plan, not without risk, passed.",
      "The plan, which carries risk, passed.",
    ],
  ])("%s states a risk and denies nothing: %s", same);

  it.each([
    ["Le groupe n'en est pas moins solide.", "Le groupe est moins solide."],
    ["Il n'en est pas moins coupable.", "Il est moins coupable."],
    [
      "Elle n'en est pas moins responsable des 5 millions.",
      "Elle est moins responsable des 5 millions.",
    ],
    [
      "Le médicament n'en est pas moins dangereux.",
      "Le médicament est moins dangereux.",
    ],
    ["Le groupe est moins solide.", "Le groupe n'en est pas moins solide."],
    ["Le groupe n'en reste pas moins solide.", "Le groupe reste moins solide."],
    [
      "La dette n'en demeure pas moins élevée.",
      "La dette demeure moins élevée.",
    ],
  ])("%s still stands, which %s reverses", flipped);

  it.each([
    [
      "L'entreprise ne manque pas à ses obligations.",
      "L'entreprise a manqué à ses obligations.",
    ],
    ["Il ne manque pas à sa parole.", "Il a manqué à sa parole."],
    ["Le client ne manque pas un paiement.", "Le client a manqué un paiement."],
    [
      "Le locataire ne manque pas une échéance.",
      "Le locataire a manqué une échéance.",
    ],
    [
      "Il ne manque pas une pièce au dossier.",
      "Il manquait une pièce au dossier.",
    ],
  ])("%s meets its obligation, so it cannot become %s", flipped);

  it.each([
    ["Le député ne manque pas un vote.", "Le député ne vote pas."],
    [
      "Reyes ne manque pas à ses obligations.",
      "Reyes ne respecte pas ses obligations.",
    ],
    [
      "Le client ne manque pas le rendez-vous.",
      "Le client ne vient pas au rendez-vous.",
    ],
    [
      "Inflation has never been higher than 5%.",
      "Inflation has never been 5%.",
    ],
    [
      "The buyer shall not without notice resell the goods.",
      "The buyer shall not resell the goods.",
    ],
    [
      "Les effectifs n'ont jamais été plus de 40.",
      "Les effectifs n'ont jamais été de 40.",
    ],
    [
      "Les adhérents n'ont jamais été plus de 40.",
      "Les adhérents ne sont pas 40.",
    ],
  ])(
    "%s, read as the whole phrase, denies nothing, so it cannot become %s",
    flipped,
  );

  it.each([
    ["Les défis ne manquent pas.", "Les défis sont nombreux."],
    [
      "Cette hausse de 5 % ne manquera pas de peser sur les ménages.",
      "Cette hausse de 5 % pèsera sur les ménages.",
    ],
    ["Ce projet ne manque pas d'ambition.", "Ce projet a de l'ambition."],
    ["Les exemples ne manquent pas à Lyon.", "Les exemples abondent à Lyon."],
  ])("%s denies nothing, so %s can stand: there is plenty", same);

  it.each([["It comes as no surprise that sales fell.", "Sales fell."]])(
    "%s opens the text and denies nothing: %s",
    same,
  );

  it.each([
    ["No surprise fees apply.", "Fees apply."],
    ["No accident insurance is included.", "Insurance is included."],
    ["No coincidence was recorded.", "A match was recorded."],
    ["It's no surprise party.", "It's a surprise party."],
    ["It was no accident.", "It was an accident."],
    ["There was no accident then.", "There was an accident then."],
    [
      "The plan is cheap as no surprise fees apply.",
      "The plan is cheap as fees apply.",
    ],
  ])("%s denies something else, so it cannot become %s", flipped);

  it.each([
    [
      "Like it or not, the plan costs $5 million.",
      "The plan costs $5 million.",
    ],
  ])("%s closes its phrase with a dash: %s", same);

  it.each([
    ["The invoices were late or not paid.", "The invoices were late or paid."],
    [
      "Les salaires sont en retard ou pas payés.",
      "Les salaires sont en retard ou payés.",
    ],
    [
      "Either the firm pays, or not all staff get paid.",
      "Either the firm pays, or all staff get paid.",
    ],
    ["Les contrats sont signés ou non signés.", "Les contrats sont signés."],
  ])("%s denies with or not, so it cannot become %s", flipped);
});

describe("what reads as a denial", () => {
  it.each([
    ["Aucune erreur", "Une erreur"],
    ["Aucunes erreurs", "Des erreurs"],
    ["Il ne lui en parle plus", "Il lui en parle"],
    ["Nulle ne sait pourquoi", "Toutes savent pourquoi"],
    ["Elle ne parle pas", "Elle parle"],
    ["Pour cela personne n'a signé", "Pour cela tous ont signé"],
    ["Il n'a perdu personne", "Il a perdu quelqu'un"],
    ["Elle ne peut accepter ce contrat.", "Elle peut accepter ce contrat."],
    [
      "Le comité ne pouvait accepter ce budget.",
      "Le comité pouvait accepter ce budget.",
    ],
    ["Les ventes ne cessent de croître.", "Les ventes cessent de croître."],
    [
      "Je ne sais si le contrat est signé.",
      "Je sais que le contrat est signé.",
    ],
    ["Il n'ose signer.", "Il ose signer."],
    [
      "Certains clients paient, d'autres pas.",
      "Certains clients paient, d'autres aussi.",
    ],
    ["Les autres pas.", "Les autres aussi."],
  ])("%s denies, %s does not", flipped);

  it.each([
    ["whenever the donor calls", "each time the sponsor calls"],
    ["Adrien et Toni ont signé", "Tous deux ont signé"],
    ["Un repas chaud", "Un dîner chaud"],
    ["the No.5 seller", "the number 5 seller"],
    ["the No5 seller", "the number 5 seller"],
    ["The piano stayed", "The instrument stayed"],
    ["the do's and don'ts", "the rules"],
    ["avant qu'il ne parte plusieurs fois", "avant son départ répété"],
    [
      "Il n'a qu'une plus grande ambition",
      "Il a une seule ambition plus grande",
    ],
    ["Les ventes ne cessent de croître.", "Les ventes continuent de croître."],
    ["Elle ne peut accepter ce contrat.", "Elle refuse ce contrat."],
    ["Le comité ne peut que valider.", "Le comité doit valider."],
  ])("%s holds no flip, %s can stand", same);

  it.each(
    "le les des du au aux ce ces son ses mon mes ton tes nos vos leur leurs notre votre premiers derniers second seconds prochain prochains nouveaux petit petits grand grands bons vrai vrais véritables immenses énorme énormes faux mauvais quelques autre tel tels seul seuls deux trois quatre cinq dix mille 5 à".split(
      " ",
    ),
  )("%s pas is a step", (word) => {
    same(`${word} pas compte`, `${word} étape compte`);
  });

  it.each("une chaque toute quelle ma ta sa leur notre votre autre".split(" "))(
    "%s personne is a noun",
    (word) => {
      same(
        `${word} personne n'a reçu que 5 €`,
        `${word} personne a reçu seulement 5 €`,
      );
    },
  );

  it.each(
    "première seule même jeune tierce vieille bonne mauvaise seconde deuxième troisième simple".split(
      " ",
    ),
  )("la %s personne is a noun", (word) => {
    same(
      `la ${word} personne n'a reçu que 5 €`,
      `la ${word} personne a reçu seulement 5 €`,
    );
  });

  it.each(
    "un une le la cette chaque du au sa son ma ta mon ton notre votre leur tel telle quel quelque".split(
      " ",
    ),
  )("%s point is a noun", (word) => {
    same(
      `Avant qu'il n'aborde ${word} point, il parle`,
      `Avant d'aborder ${word} point, il parle`,
    );
  });

  it.each([
    ["Le comité ne peut que valider.", "Le comité doit valider."],
    ["On ne peut ignorer ce risque de 5 %.", "Ce risque de 5 % est réel."],
  ])("%s limits or compares and denies nothing: %s", same);

  it.each([
    ["Elle ne peut accepter ce contrat.", "Elle peut accepter ce contrat."],
    [
      "Elle ne peut accepter que le contrat soit signé.",
      "Elle peut accepter que le contrat soit signé.",
    ],
    [
      "Elle ne peut être sûre que le contrat soit signé.",
      "Elle peut être sûre que le contrat est signé.",
    ],
    [
      "Je ne sais si le contrat est signé.",
      "Je sais que le contrat est signé.",
    ],
    ["Il n'ose signer.", "Il ose signer."],
    [
      "Le plan coûte plus cher que prévu et il ne peut payer.",
      "Le plan coûte plus cher que prévu et il peut payer.",
    ],
    [
      "On ne peut négliger ce risque de 5 %.",
      "On peut négliger ce risque de 5 %.",
    ],
  ])("%s denies with ne alone, so it cannot become %s", flipped);
});

describe("typography that a model retypes", () => {
  it.each([
    ["It’s a marathon, not a sprint.", "It's a marathon."],
    ["It's a marathon, not a sprint.", "It’s a marathon."],
    ["C’est un marathon, pas un sprint.", "C'est un marathon."],
    ["We don’t sell software. We’re selling trust.", "We're selling trust."],
    [
      "Nous ne vendons pas d’outil. Nous vendons de l’écoute.",
      "Nous vendons de l'écoute.",
    ],
    [
      "Il n’a pas vendu l’usine, il a vendu l’enseigne.",
      "Il a vendu l'enseigne.",
    ],
    ["Pas d’outil. Pas d’astuce. De l’écoute.", "De l'écoute."],
    ["It's a well‑known fact, not a rumour.", "It's a well-known fact."],
    ["We don't sell vans. We sell high‑end cars.", "We sell high-end cars."],
    ["This isn't the firm’s. It's ours.", "This is surely ours."],
  ])("%s can still become %s", same);

  it.each([
    ["Ce n’est pas qu’un outil.", "Ce n'est qu'un outil."],
    ["Il ne s’arrête pas là.", "Il s'arrête là."],
    [
      "Le contrat n’a pas reçu l’accord. C’est un problème.",
      "Le contrat a reçu l'accord. C'est un problème.",
    ],
    [
      "The drug isn’t the company’s. It’s safe.",
      "The drug is the company's. It's safe.",
    ],
    ["It wasn’t the firm’s. It was mine.", "It was the firm's. It was mine."],
    [
      "La loi n'était pas l’œuvre du maire. C'était celle du préfet.",
      "La loi était l'œuvre du maire. C'était celle du préfet.",
    ],
    [
      "It wasn’t the firm’s fault. It was luck.",
      "It was the firm's fault. It was luck.",
    ],
    [
      "Ce n’était pas l’offre. C’était le prix.",
      "C'était l'offre. C'était le prix.",
    ],
    [
      "Il n’a pas été l’auteur. Ce fut un autre.",
      "Il a été l'auteur. Ce fut un autre.",
    ],
    [
      "It wasn't the well‑known firm. It was luck.",
      "It was the well-known firm. It was luck.",
    ],
    [
      "Le groupe n’a pas vendu l’usine, mais il est en faillite.",
      "Le groupe a vendu l'usine, mais il est en faillite.",
    ],
    [
      "Le groupe n'a pas vendu l'usine, mais il est en faillite.",
      "Le groupe a vendu l’usine, mais il est en faillite.",
    ],
    ["Ce n’est pas un secret", "C’est un secret"],
  ])("%s still cannot become %s", flipped);
});

describe("a figure that reads like a year", () => {
  it.each([
    ["Revenue fell by 2000 million.", "Revenue fell by 2000 billion."],
    [
      "Revenue fell by 2000 million dollars.",
      "Revenue fell by 2000 billion euros.",
    ],
    ["Revenue fell by 2000 million.", "Revenue fell by 2000."],
    [
      "The budget grew by 1800 million euros.",
      "The budget grew by 1800 billion euros.",
    ],
    [
      "The budget grew by 1800 million euros.",
      "The budget grew by 1800 million dollars.",
    ],
    [
      "The budget grew by 1800 million euros.",
      "The budget grew by 1800 euros.",
    ],
    [
      "La dette monte vers 2000 milliards.",
      "La dette monte vers 2000 millions.",
    ],
    [
      "Après 2000 milliards de pertes, la banque a fermé.",
      "Après 2000 millions de pertes, la banque a fermé.",
    ],
    [
      "Après 2000 milliards d'euros de pertes, la banque a fermé.",
      "Après 2000 milliards de dollars de pertes, la banque a fermé.",
    ],
    ["up by 1800 k€", "up by 1800 M€"],
    ["In 2020 millions lost their jobs.", "In 2020 billions lost their jobs."],
    [
      "En 2020 millions de personnes ont perdu leur emploi.",
      "En 2020 milliards de personnes ont perdu leur emploi.",
    ],
    [
      "Les pertes se chiffrent en 2000 milliards d'euros.",
      "Les pertes se chiffrent en 2000 millions de dollars.",
    ],
    ["une dette de bien 2000 milliards", "une dette de bien 2000 millions"],
    ["en tout 2000 milliards", "en tout 2000 millions"],
    ["sold in 3 million homes", "sold in 3 billion homes"],
    ["up by 12000 million", "up by 12000 billion"],
    ["up by 20000 million", "up by 20000 billion"],
  ])("%s is not %s", changed);

  it.each("since until after before during dès après avant vers".split(" "))(
    "%s dates a year",
    (word) => {
      same(`${word} 2020 millions lost`, `${word} 2020, millions lost`);
    },
  );

  it.each([
    ["In 2018 Md Ali led the team", "Md Ali led the team in 2018"],
    ["In 2019 Bn Bank lost $3 million", "Bn Bank lost $3 million in 2019"],
    ["En 2018 Md Ali a dirigé l'équipe", "Md Ali a dirigé l'équipe en 2018"],
    [
      "En 2019 Bn Conseil a perdu 3 millions d'euros",
      "Bn Conseil a perdu 3 millions d'euros en 2019",
    ],
  ])("a name can follow a year: %s", same);

  it("reads a date word in the middle of a text, and what follows the year as its own clause", () => {
    same(
      "Then in 2020 millions lost their jobs",
      "Then in 2020, millions lost their jobs",
    );
    same("In 2020 millions lost their jobs", "In 2020 many lost their jobs");
    same(
      "En 2020 millions de personnes ont perdu leur emploi.",
      "En 2020, des millions de personnes ont perdu leur emploi.",
    );
  });

  it.each([
    [
      "Revenue fell by 2000 million USD.",
      "Revenue fell by 2000 million dollars.",
    ],
    [
      "Revenue fell by 2000 million dollars.",
      "Revenue fell by 2000 million USD.",
    ],
    [
      "The budget grew by 1800 million EUR.",
      "The budget rose by 1800 million euros.",
    ],
    ["The budget grew by 1800 M EUR.", "The budget grew by 1800 M€."],
    ["up by 1800 K USD", "up by 1800 thousand dollars"],
    [
      "Le budget augmente vers 1800 Md EUR.",
      "Le budget augmente vers 1800 Md€.",
    ],
    ["Après 2000 M EUR de pertes", "Après 2000 M€ de pertes"],
    ["Depuis 2000 M USD ont été investis.", "Depuis 2000 M$ ont été investis."],
    ["In 2018 Md Ali led the team", "Md Ali led the team in 2018"],
    ["In 2019 Bn Bank lost $3 million", "Bn Bank lost $3 million in 2019"],
  ])("%s is an amount in a currency: %s", same);

  it.each([
    ["Revenue fell by 2000 million USD.", "Revenue fell by 2000 billion USD."],
    ["Revenue fell by 2000 million USD.", "Revenue fell by 2000 million EUR."],
    ["Revenue fell by 2000 million USD.", "Revenue fell by 2000 USD."],
    ["Revenue fell by 1800 mn USD.", "Revenue fell by 1800 USD."],
  ])("%s keeps its size and its currency, unlike %s", changed);
});

describe("one scale for two figures", () => {
  it.each(["or", "to", "ou", "à"])("across %s", (word) => {
    same(`3 ${word} 5 million`, `3 million ${word} 5 million`);
  });

  it.each([
    ["between 3 and 5 million", "between 3 million and 5 million"],
    ["de 40 à 3 millions", "de 40 millions à 3 millions"],
    ["3 – 5 million", "3 to 5 million"],
    ["$3 and $5 million", "$3 million and $5 million"],
    ["3 firms and 5 million people", "5 million people and 3 firms"],
    ["3 and then 5 million", "5 million and then 3"],
    ["3 AND 5 MILLION", "3 MILLION AND 5 MILLION"],
    [
      "Elle a ouvert en 2019 et 5 millions de clients ont suivi.",
      "Elle a ouvert en 2019, et 5 millions de clients ont suivi.",
    ],
    [
      "The plant employs 400 — 3 million more depend on it.",
      "The plant employs 400. 3 million more depend on it.",
    ],
    [
      "Section 3 — 5 million people lost access.",
      "Section 3: 5 million people lost access.",
    ],
    [
      "L'usine en emploie 400 — 3 millions d'autres en dépendent.",
      "L'usine en emploie 400. 3 millions d'autres en dépendent.",
    ],
    [
      "L'usine en emploie 400 – 3 millions d'autres en dépendent.",
      "L'usine en emploie 400. 3 millions d'autres en dépendent.",
    ],
    [
      "It employs 400 and 5 million more depend on it.",
      "It employs 400, and 5 million more depend on it.",
    ],
    ["Revenue rose 12% to $3 million.", "Revenue reached $3 million, up 12%."],
    ["Revenue rose 12% to $3 million.", "Revenue rose 12%, to $3 million."],
    [
      "Profit fell 5% to €40 million in 2024.",
      "In 2024 profit was €40 million, down 5%.",
    ],
    [
      "Unemployment fell 5% and 3 million people found work.",
      "Unemployment fell 5%, and 3 million people found work.",
    ],
    [
      "Le chiffre d'affaires a progressé de 12 % à 3 millions d'euros.",
      "Le chiffre d'affaires atteint 3 millions d'euros, en hausse de 12 %.",
    ],
    [
      "Le chômage a baissé de 5 % et 3 millions de personnes ont retrouvé un emploi.",
      "Le chômage a baissé de 5 %, et 3 millions de personnes ont retrouvé un emploi.",
    ],
  ])("%s reads as %s", same);

  it.each([
    [
      "The plant employs 400 — 5 million more depend on it.",
      "The plant employs 400 million — 5 million more depend on it.",
    ],
    [
      "L'usine emploie 400 — 5 millions en dépendent.",
      "L'usine emploie 400 millions — 5 millions en dépendent.",
    ],
    [
      "It employs 400 and 5 million more depend on it.",
      "It employs 400 million and 5 million more depend on it.",
    ],
    [
      "L'usine emploie 400 et 5 millions en dépendent.",
      "L'usine emploie 400 millions et 5 millions en dépendent.",
    ],
    ["Revenue rose 12% to $3 million.", "Revenue rose 12% to $3 billion."],
  ])("%s is not %s", changed);

  it.each([
    [
      "raised $30 and $10 million in 2019 and 2020",
      "raised $30 in 2019 and $10 million in 2020",
    ],
    [
      "sold 12 and 5 million in 2019 and 2020",
      "sold 12 in 2019 and 5 million in 2020",
    ],
    [
      "vendu 12 et 5 millions en 2019 et 2020",
      "vendu 12 en 2019 et 5 millions en 2020",
    ],
    ["$100 and $40 million", "$40 million and $100"],
    ["between 800 and 1,200 million", "1,200 million against 800"],
    ["between €800 and €1,200 million", "between €800 and then €1,200 million"],
    ["gains of 5 and -3 million", "gains of 5, then -3 million"],
    [
      "It employs 400 and 5 million more depend on it.",
      "It employs 400 million and 5 million more depend on it.",
    ],
  ])("%s loses the scale it shared in %s", changed);
});

describe("what stands next to a figure", () => {
  it.each([
    ["3 T$", "3 trillion dollars"],
    ["$5 g of gold", "$5 grams of gold"],
    ["$3 m", "$3 million"],
    ["$5 mn", "$5 million"],
    ["a 5 m wall cost €40", "€40 for a wall of 5 m"],
    ["a 5 M wall", "a wall of 5 M"],
    ["5 M d'euros", "5 millions d'euros"],
    ["3M USD", "3 million USD"],
    ["In week 12 hundreds marched", "Hundreds marched in week 12"],
    ["Il gagne 20 l'heure", "Il gagne 20 euros l'heure"],
    ["Il gagne 20 l’heure", "Il gagne 20 euros l’heure"],
    ["5 people came a day later", "5 people came a week later"],
  ])("%s reads as %s", same);

  it.each([
    ["un budget de 5 M d'euros", "un budget de 5 euros"],
    ["un budget de 5 M de dollars", "un budget de 5 dollars"],
    ["a budget of 3M USD", "a budget of 3 USD"],
    ["un budget de 3 M EUR", "un budget de 3 EUR"],
    ["3m euros", "3 euros"],
    ["a debt of $5tn", "a debt of $5"],
    ["a 5‑km walk", "a 5‑mile walk"],
    ["a 5‐km walk", "a 5‐mile walk"],
    ["a 5–km walk", "a 5–mile walk"],
    ["a $3–million budget", "a $3–billion budget"],
    ["a 3 kilowatt-hour battery", "a 3 kilowatt battery"],
    ["une batterie de 3 kilowatt-heure", "une batterie de 3 kilowatts"],
    ["39 ° C", "39 ° F"],
    ["at 5 km/h", "at 5 per hour"],
    ["39 degree Celsius", "39 degree Fahrenheit"],
    ["39 degré Celsius", "39 degré Fahrenheit"],
    ["$40 PER HOUR", "$40 PER DAY"],
    ["3 MILLIONS D'EUROS", "3 MILLIONS DE DOLLARS"],
  ])("%s is not %s", changed);
});

describe("a figure and its name", () => {
  it.each([
    [
      "Acme has a 5-GB file and Zenith a 9-GB file",
      "Acme has a 9-GB file and Zenith a 5-GB file",
    ],
    [
      "Acme paid USD 40 and Zenith USD 50",
      "Acme paid USD 50 and Zenith USD 40",
    ],
    ["5 GB for Acme and 9 GB for Zenith", "9 GB for Acme and 5 GB for Zenith"],
    [
      "Apple rose 12% in Paris and Google rose 40%",
      "Apple rose 40% and Google rose 12%",
    ],
  ])("%s cannot become %s", swapped);
});

describe("a figure in its other forms", () => {
  it("reads a percent word glued to it, and the marks that group its digits", () => {
    same("12percent", "12%");
    same("12pct", "12%");
    same("1’200 people", "1200 people");
    numbers("It cost 123,456", "It cost 123.456");
  });
});

describe("the whole text, with and without the edit", () => {
  const long79 =
    "123,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118";
  const long78 =
    "12,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118";
  const long37 = "1,100,101,102,103,104,105,106,107,108";
  const chain = (size: number) =>
    Array.from({ length: size }, (_, at) => String(at + 1)).join(" and ");
  const list = (size: number) =>
    Array.from({ length: size }, (_, at) => String(at + 1)).join(",");
  const clause =
    "and the whole of its staff went home in the weeks that followed the decision of the board ";

  it.each([
    [
      "a scale that goes, past a long figure",
      `Budget of $${long79} m for the year.`,
      "m",
      "",
    ],
    [
      "a currency that goes, ahead of a long figure",
      `Paid $ ${long78} m in all.`,
      "$",
      "about",
    ],
    [
      "a code that stops being one",
      `Paid (USD ${long37}${" ".repeat(39)}m in all.`,
      "(",
      "x",
    ],
    [
      "a join across spaces, on its left",
      `3${" ".repeat(80)}and 5 million people`,
      "and",
      "with",
    ],
    [
      "a join across spaces, on its right",
      `3 and${" ".repeat(72)}5 million people`,
      "and",
      "with",
    ],
    [
      "a chain of joins",
      `${chain(14)} million people`,
      "1 and",
      "1 person and",
    ],
    [
      "a unit next to a quote longer than a figure reads",
      `It cost 3 ${clause}here.`,
      clause,
      "million dollars ",
    ],
    [
      "a figure joined past a long quote",
      `It cost 3 ${clause}500 km.`,
      clause,
      "",
    ],
    [
      "a period far from its figure",
      "Une dette de 3 milliards de kilowattheures par semaine.",
      "semaine",
      "mois",
    ],
    ["a currency that a quote takes off", "It costs US$5 now.", "US$", "US "],
  ])("refuses %s", (_case, text, quote, by) => {
    expect(whyDrop(edit(quote, by))).toBeNull();
    expect(locateEdits(text, [edit(quote, by)])).toEqual([]);
  });

  it.each([
    [
      "the scale written out, past a long figure",
      `Budget of $${long79} m for the year.`,
      "m",
      "million",
    ],
    [
      "the last figure of a list that reads alone",
      `${list(33)} remain open.`,
      "33",
      "and 33",
    ],
    [
      "the last figure of a list that reads alone",
      `${list(37)} remain open.`,
      "37",
      "and 37",
    ],
    [
      "a hedge between a percent and a figure",
      "Sales rose 12%, it is worth noting, to 3 million units.",
      ", it is worth noting,",
      "",
    ],
    [
      "a dash between a percent and a figure",
      "Costs fell 5% — 12 million euros in all.",
      " — ",
      ", ",
    ],
  ])("keeps %s", (_case, text, quote, by) => {
    expect(locateEdits(text, [edit(quote, by)])).toHaveLength(1);
  });

  it.each([
    [
      "a scale two figures shared, for the first of them",
      "It raised $30 and $10 million that year.",
      "$30 and",
      "$30 in spring and",
    ],
    [
      "a scale two figures shared, in a range",
      "It sold between 800 and 1,200 million units.",
      "800 and",
      "800 and then",
    ],
    [
      "a scale that changes after a year said twice",
      "In 2020 millions left. In 2020 billions came.",
      "millions",
      "billions",
    ],
  ])("refuses %s", (_case, text, quote, by) => {
    expect(locateEdits(text, [edit(quote, by)])).toEqual([]);
  });

  it.each([
    [
      "In 2020 millions lost their jobs.",
      "In 2020 millions lost their jobs",
      "Millions lost their jobs in 2020",
    ],
  ])("keeps a year said once, in %s", (text, quote, by) => {
    expect(locateEdits(text, [edit(quote, by)])).toHaveLength(1);
  });

  // Scales after a year are compared whole, so one mention cannot leave
  it.each([
    [
      "In 2020 millions lost their jobs. In 2020 millions lost their homes.",
      "In 2020 millions lost their jobs",
      "Millions lost their jobs in 2020",
    ],
    [
      "In 2020 millions lost their jobs. In 2020 billions more were promised.",
      "In 2020 millions lost their jobs",
      "In 2020 many lost their jobs",
    ],
    [
      "En 2020 millions de personnes ont perdu leur emploi. En 2020 milliards d'euros ont été dépensés.",
      "En 2020 millions de personnes ont perdu leur emploi",
      "Des millions de personnes ont perdu leur emploi en 2020",
    ],
    [
      "Depuis 2015 milliards d'euros partent. Depuis 2015 millions d'emplois disparaissent.",
      "Depuis 2015 milliards d'euros partent",
      "Des milliards d'euros partent depuis 2015",
    ],
  ])(
    "refuses an edit on one of a year said twice, in %s",
    (text, quote, by) => {
      expect(locateEdits(text, [edit(quote, by)])).toEqual([]);
    },
  );
});

// What the checks give up on purpose. They read words and not meaning, so the same shape can hold an honest
// edit and one that changes a fact: each pair of tables shows both, and the honest one costs a suggestion.
describe("honest edits it refuses, because the same shape can change a fact", () => {
  it.each([
    [
      "This isn't the price. It's the timing, and it's late.",
      "This is the timing, and it's late.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a denial and its answer, behind more than the cut",
    flipped,
  );

  it.each([
    [
      "We hired 40 nurses. We did not hire 12 doctors this year. They are scarce.",
      "We hired 40 nurses and 12 doctors. They are scarce.",
    ],
    [
      "Acme closed 5 plants. Acme did not close 3 shops in Ohio, but sales fell.",
      "Acme closed 5 plants and 3 shops, but sales fell.",
    ],
    [
      "The plant is open in Ohio. The plant is not open in Texas, but it is staffed.",
      "The plant is open, but it is staffed.",
    ],
    [
      "The drug was not approved in May or approved in June. It was safe.",
      "The drug was approved. It was safe.",
    ],
    [
      "It's not the high price in France. It's the timing.",
      "It's the price. It's the timing.",
    ],
    [
      "Acme is not the sole owner in Ohio. It is a tenant.",
      "Acme is the owner. It is a tenant.",
    ],
    [
      "Acme isn't the owner of the site. It's a tenant.",
      "Acme is the proprietor of the plant. It's a tenant.",
    ],
    [
      "In the end, it's not about the money in Ohio. It's about the people.",
      "In the end, it's about the money. It's the people.",
    ],
    [
      "The fee was not waived for Acme. It was waived for Beta.",
      "The fee was waived. It was for Beta.",
    ],
    [
      "Le groupe n'a pas vendu ses usines en France, mais il a vendu ses brevets.",
      "Le groupe a vendu ses usines, mais il a cédé ses brevets.",
    ],
    [
      "Le médicament n'est pas remboursé en France, il est remboursé en Espagne.",
      "Le médicament est remboursé, il est pris en charge en Espagne.",
    ],
    [
      "Cette mesure n'était pas une mesure d'urgence. C'était une mesure de fond.",
      "Cette mesure était d'urgence. C'était une mesure de fond.",
    ],
    [
      "Le client a payé ou non – c'est la question.",
      "Le client a payé – c'est la question.",
    ],
  ])(
    "%s cannot become %s, as an answer that leaves the denied word standing",
    dropped,
  );

  it.each([
    ["The firm did not hire many people.", "The firm hired few people."],
    [
      "Le groupe n'a pas embauché beaucoup de salariés.",
      "Le groupe a embauché peu de salariés.",
    ],
    ["The board does not meet often.", "The board meets rarely."],
    ["Elle n'a pas publié souvent.", "Elle a publié rarement."],
    [
      "The 40 workers were not treated fairly.",
      "The 40 workers were treated unfairly.",
    ],
    [
      "Le rapport n'a pas été rédigé correctement.",
      "Le rapport a été rédigé incorrectement.",
    ],
    [
      "Les clients ne paient pas régulièrement.",
      "Les clients paient irrégulièrement.",
    ],
    ["Les clients n'ont pas les moyens.", "Les clients manquent de moyens."],
    ["Data circulates without restriction.", "Data circulates freely."],
    [
      "L'usine ne produit plus de moteurs.",
      "L'usine a stoppé sa production de moteurs.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a word that says no, after the verb",
    flipped,
  );

  it.each([
    ["The vaccine was not proven safe.", "The vaccine was proven unsafe."],
    [
      "The firm did not file audited accounts.",
      "The firm filed unaudited accounts.",
    ],
    ["The plan did not cut employment.", "The plan cut unemployment."],
    [
      "Les 40 salariés n'ont pas été formés.",
      "Les 40 salariés ont été informés.",
    ],
    ["Le contrat n'est pas signé. Légal.", "Le contrat est signé. Illégal."],
    [
      "The report does not say how much Acme paid.",
      "The report says how little Acme paid.",
    ],
    [
      "The board did not approve the plan, and many objected.",
      "The board approved the plan, and few objected.",
    ],
    [
      "Le groupe n'a pas vendu beaucoup d'usines.",
      "Le groupe a vendu des usines peu rentables.",
    ],
    ["The firm does not share its data.", "The firm freely shares its data."],
    ["Staff cannot enter the site.", "Staff can freely enter the site."],
    [
      "The vaccine is not available in 40 countries.",
      "The vaccine is freely available in 40 countries.",
    ],
    ["The bottle has no cork.", "The bottle has a stopper."],
    ["Le comité n'a pas retardé le projet.", "Le comité a stoppé le projet."],
    ["Acme is not the winner.", "Acme is the unlikely winner."],
    ["This is not the contract.", "This is the missing contract."],
  ])(
    "%s cannot become %s, as a word that says no, after what the denial stood on",
    dropped,
  );

  it.each([
    [
      "Pas une dépense. Un investissement de 5 millions d'euros.",
      "Un investissement de 5 millions d'euros.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a split contrast longer than one word on each side",
    flipped,
  );

  it.each([
    ["Not a patient recovered. The trial ended.", "The trial ended."],
    ["Not a cent. The firm closed.", "The firm closed."],
    ["No tax was paid. Du Pont closed.", "Du Pont closed."],
    ["Pas un centime. La société a fermé.", "La société a fermé."],
    [
      "Pas de remboursement. Des plaintes ont suivi.",
      "Des plaintes ont suivi.",
    ],
    ["Pas de salaire en mai. Des primes en juin.", "Des primes en juin."],
  ])("%s cannot become %s, as a short sentence that denies", dropped);

  it.each([
    ["It's a marathon, not a very long sprint.", "It's a marathon."],
    [
      "It's a question of will, not a question of money.",
      "It's a question of will.",
    ],
    [
      "C'est une question de volonté, pas une question de moyens.",
      "C'est une question de volonté.",
    ],
    [
      "It's about the quality of the work, not the size of the team.",
      "It's about the quality of the work.",
    ],
    [
      "C'est un investissement, pas une dépense de plus.",
      "C'est un investissement.",
    ],
    [
      "Il s'agit d'un choix, pas d'un accident de l'histoire.",
      "Il s'agit d'un choix.",
    ],
    ["It's a tool, not a toy or a gadget.", "It's a tool."],
    ["C'est une méthode, pas un gadget ou une mode.", "C'est une méthode."],
    ["It's about trust, not speed or price.", "It's about trust."],
    [
      "C'est une question de volonté, pas de moyens ou de temps.",
      "C'est une question de volonté.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a contrast with its answer first, when more than one thing goes",
    flipped,
  );

  it.each([
    ["It's approved, not a single patient was harmed.", "It's approved."],
    ["They were paid, not a single invoice was settled.", "They were paid."],
    ["It's a loan, not a grant the state will repay.", "It's a loan."],
    ["It was paid, not the full amount owed to the client.", "It was paid."],
    ["C'est signé, pas la totalité des contrats.", "C'est signé."],
    ["C'est fini, pas un centime n'a été versé.", "C'est fini."],
  ])(
    "%s cannot become %s, as a clause that goes with its answer first",
    dropped,
  );

  it.each([
    [
      "Le groupe n'hésite pas à investir 40 millions d'euros.",
      "Le groupe investit 40 millions d'euros.",
    ],
    [
      "L'auteur n'hésite pas à critiquer le plan de 5 milliards d'euros.",
      "L'auteur critique le plan de 5 milliards d'euros.",
    ],
    ["Ils n'hésitent pas à payer 5 € de plus.", "Ils paient 5 € de plus."],
    [
      "Le ministre n'oublie pas de rappeler que les ventes ont baissé de 5 %.",
      "Le ministre rappelle que les ventes ont baissé de 5 %.",
    ],
    ["Alors n'hésite pas à nous écrire.", "Alors écris-nous."],
    [
      "Et n'oublie pas de signer les 40 formulaires.",
      "Et pense à signer les 40 formulaires.",
    ],
    ["Surtout n'hésite pas à poser tes 5 questions.", "Pose tes 5 questions."],
    [
      "Si tu veux en savoir plus n'hésite pas à m'écrire.",
      "Si tu veux en savoir plus, écris-moi.",
    ],
    [
      "La cybersécurité n'a jamais été aussi cruciale que de nos jours.",
      "La cybersécurité est cruciale.",
    ],
    [
      "Il n'a jamais été aussi facile de créer une entreprise que de nos jours.",
      "Créer une entreprise est facile.",
    ],
    [
      "La demande n'a jamais été aussi forte qu'en 2024.",
      "La demande est forte en 2024.",
    ],
    [
      "Le marché n'a jamais été aussi tendu que cette année, avec 5 % de hausse.",
      "Le marché est tendu cette année, avec 5 % de hausse.",
    ],
    [
      "Le sujet n'a jamais été aussi urgent que ces dernières années.",
      "Le sujet est urgent.",
    ],
    [
      "La sobriété n'a jamais été aussi importante que dans le monde actuel.",
      "La sobriété est importante.",
    ],
    [
      "Make no mistake. The plan costs $5 million.",
      "The plan costs $5 million.",
    ],
    [
      "Make no mistake! The plan costs $5 million.",
      "The plan costs $5 million.",
    ],
    [
      "And make no mistake. This deal cost $5 million.",
      "This deal cost $5 million.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a filler in the middle of a clause",
    flipped,
  );

  it.each([
    ["Il n'hésite pas à payer.", "Il rechigne à payer."],
    [
      "Le maire n'oublie pas les retraités, il oublie les jeunes.",
      "Le maire oublie les retraités, il aide les jeunes.",
    ],
    [
      "La réforme ne s'arrête pas là : elle n'oublie pas les retraités.",
      "La réforme oublie les retraités.",
    ],
    ["Il n'oublie pas de payer ses impôts.", "Il omet de payer ses impôts."],
    ["Le taux n'a jamais été plus élevé que 5 %.", "Le taux a dépassé 5 %."],
    [
      "Elle n'a jamais été aussi riche que lui.",
      "Elle est plus riche que lui.",
    ],
    ["The auditors make no mistake.", "The auditors make errors."],
    ["The auditors err.", "The auditors make no mistake."],
  ])("%s cannot become %s, as a filler or a bound worded otherwise", dropped);

  it.each([
    ["It's no surprise sales fell 5%.", "Sales fell 5%."],
    ["It is no surprise Acme cut 40 jobs.", "Acme cut 40 jobs."],
    ["It came as no surprise when Acme cut 40 jobs.", "Acme cut 40 jobs."],
    ["It's no surprise — sales fell 5%.", "Sales fell 5%."],
    ["No surprise — sales fell 5%.", "Sales fell 5%."],
    ["No surprise here: sales fell 5%.", "Sales fell 5%."],
    ["It is no accident the firm cut 40 jobs.", "The firm cut 40 jobs."],
    ["It is no coincidence the firm cut 40 jobs.", "The firm cut 40 jobs."],
    ["Believe it or not — sales rose 5%.", "Sales rose 5%."],
    [
      "Like it or not — the plan costs $5 million.",
      "The plan costs $5 million.",
    ],
    ["Whether you agree or not – the fee is 5%.", "The fee is 5%."],
    [
      "Like it or not - the plan costs $5 million.",
      "The plan costs $5 million.",
    ],
    [
      "Qu'on le veuille ou non — le plan coûte 5 millions d'euros.",
      "Le plan coûte 5 millions d'euros.",
    ],
    [
      "Qu'on le veuille ou pas — le plan coûte 5 millions d'euros.",
      "Le plan coûte 5 millions d'euros.",
    ],
    ["Vrai ou pas – le tarif est de 5 %.", "Le tarif est de 5 %."],
  ])(
    "costs a suggestion: %s to %s, as a set phrase in a form that can also deny",
    flipped,
  );

  it.each([
    [
      "It was no accident the firm cut 40 jobs.",
      "The firm accidentally cut 40 jobs.",
    ],
    ["It's no surprise sales fell 5%.", "Surprisingly, sales fell 5%."],
    [
      "There was no accident — the plant stayed open.",
      "There was a crash — the plant stayed open.",
    ],
    [
      "The fund paid or not — the records disagree.",
      "The fund paid — the records disagree.",
    ],
    [
      "Le salaire est versé ou non — selon le contrat.",
      "Le salaire est versé — selon le contrat.",
    ],
    [
      "Spending has never been more than they budgeted.",
      "Spending has exceeded what they budgeted.",
    ],
  ])("%s cannot become %s, as a set phrase in a form that denies", dropped);

  it.each([
    [
      "L'aide ne peut être versée que si le dossier est complet.",
      "L'aide est versée uniquement si le dossier est complet.",
    ],
    [
      "La réforme ne peut se faire qu'avec l'accord des 40 syndicats.",
      "La réforme exige l'accord des 40 syndicats.",
    ],
    [
      "Cette baisse de 5 % ne peut s'expliquer que par la crise.",
      "Cette baisse de 5 % s'explique par la crise.",
    ],
    [
      "Cette hausse ne peut être que bénéfique pour les 40 salariés.",
      "Cette hausse profite aux 40 salariés.",
    ],
    [
      "Le remboursement ne peut intervenir qu'après 5 ans.",
      "Le remboursement intervient après 5 ans.",
    ],
    [
      "Le sujet est plus complexe qu'on ne pourrait le penser.",
      "Le sujet est complexe.",
    ],
    [
      "La crise est plus grave qu'on ne peut l'imaginer.",
      "La crise est très grave.",
    ],
    ["On ne peut négliger ce risque de 5 %.", "Ce risque de 5 % compte."],
    ["On ne peut sous-estimer ce risque de 5 %.", "Ce risque de 5 % compte."],
    [
      "On ne peut s'empêcher de noter que les ventes ont baissé de 5 %.",
      "Les ventes ont baissé de 5 %.",
    ],
  ])(
    "costs a suggestion: %s to %s, as ne peut, even when it limits or compares",
    flipped,
  );

  it.each([
    [
      "Le tribunal ne peut accepter qu'une société paie 40 millions d'euros.",
      "Le tribunal peut accepter qu'une société paie 40 millions d'euros.",
    ],
    [
      "Le juge ne peut affirmer que dans ce dossier la société a payé.",
      "Le juge peut affirmer que dans ce dossier la société a payé.",
    ],
    [
      "Le groupe ne peut investir plus qu'en 2023.",
      "Le groupe peut investir plus qu'en 2023.",
    ],
    [
      "C'est le plus gros client qu'on ne peut perdre.",
      "C'est le plus gros client qu'on peut perdre.",
    ],
    [
      "Il ne peut être exclu qu'une erreur ait été commise.",
      "Il peut être exclu qu'une erreur ait été commise.",
    ],
    [
      "Le contrat ne peut être signé que par le client.",
      "Le contrat peut être signé par le client.",
    ],
    ["On ne peut négliger ce risque de 5 %.", "Ce risque de 5 % est négligé."],
    ["On ne peut sous-estimer ce coût.", "On a sous-estimé ce coût."],
  ])("%s cannot become %s, as ne peut, when it denies", dropped);

  it.each([
    [
      "dont 6,4 millions pour les écoles et 2,1 millions pour la voirie",
      "dont 6,4 et 2,1 millions pour les écoles et la voirie",
    ],
    [
      "sales of 12 and 5 million in 2019 and 2020",
      "sales of 12 million and 5 million in 2019 and 2020",
    ],
    [
      "$30 and $10 million respectively",
      "$30 million and $10 million respectively",
    ],
    ["$100 million and $40 million", "$100 and $40 million"],
    ["entre 40 et 15 milliards", "entre 40 milliards et 15 milliards"],
    ["90 et 25 M€", "90 M€ et 25 M€"],
    ["between 800 and 1,200 million", "between 800 million and 1,200 million"],
    [
      "between €800 and €1,200 million",
      "between €800 million and €1,200 million",
    ],
    [
      "between 400 and 1,200 thousand",
      "between 400 thousand and 1,200 thousand",
    ],
    ["entre 800 et 1.200 millions", "entre 800 millions et 1.200 millions"],
    ["gains of 5 and -3 million", "gains of 5 million and -3 million"],
  ])(
    "costs a suggestion: %s to %s, as figures of different sizes, in a list",
    changed,
  );

  it.each([
    [
      "It employs 40 and 5 million more depend on it.",
      "It employs 40 million and 5 million more depend on it.",
    ],
    [
      "Acme raised $30 million and $5 million went to staff.",
      "Acme raised $30 and $5 million went to staff.",
    ],
    [
      "raised $30 and $10 million in 2019 and 2020",
      "raised $30 in 2019 and $10 million in 2020",
    ],
    [
      "vendu 12 et 5 millions en 2019 et 2020",
      "vendu 12 en 2019 et 5 millions en 2020",
    ],
    [
      "Il emploie 800 et 1.200 millions en dépendent.",
      "Il emploie 800 millions et 1.200 millions en dépendent.",
    ],
    [
      "It employs 1,200 and 5 million more depend on it.",
      "It employs 1,200 million and 5 million more depend on it.",
    ],
    [
      "Il gagne 30 et -5 millions sont dus.",
      "Il gagne 30 millions et -5 millions sont dus.",
    ],
    [
      "Net cash flow was -120 and -8 million in 2019 and 2020.",
      "Net cash flow was -120 in 2019 and -8 million in 2020.",
    ],
    [
      "It earned 4 and -3 million were written off.",
      "It earned 4 million and -3 million were written off.",
    ],
    [
      "In 2020 millions marched and in 2020 billions watched.",
      "In 2020 billions marched and millions watched in 2020.",
    ],
    [
      "En 2020 millions ont voté et en 2020 milliards ont payé.",
      "En 2020 millions ont voté et en 2020 ont payé.",
    ],
    ["Après 2000 Md XOF de pertes", "Après 2000 Md€ de pertes"],
  ])("%s cannot become %s, as a scale that moves in a list", dropped);

  it.each([
    [
      "For Acme, it's not about speed, it's about trust.",
      "For Acme, it's about trust.",
    ],
    ["Today, it's not the price, it's the timing.", "Today, it's the timing."],
    [
      "In the end, it's not about the money. It's about the people.",
      "In the end, it's about the people.",
    ],
    ["So it's not about speed. It's about trust.", "So it's about trust."],
    [
      "Sales rose 5%. It's not the price. It's the timing.",
      "Sales rose 5%. It's the timing.",
    ],
    [
      "In 2019, it wasn't the price. It was the timing.",
      "In 2019, it was the timing.",
    ],
    [
      "Aujourd'hui, ce n'est pas une question de prix, c'est une question de délai.",
      "Aujourd'hui, c'est une question de délai.",
    ],
    [
      "Mais ce n'est pas une question d'argent, c'est une question de volonté.",
      "Mais c'est une question de volonté.",
    ],
    [
      "Au final, ce ne sont pas des chiffres, ce sont des gens.",
      "Au final, ce sont des gens.",
    ],
    [
      "Ce n'est pas une question de prix, c'est une question de délai, et c'est urgent.",
      "C'est une question de délai, et c'est urgent.",
    ],
    [
      "En 2019, ce n'était pas une question de prix, c'était une question de délai.",
      "En 2019, c'était une question de délai.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a contrast behind what opens it",
    flipped,
  );

  it.each([
    ["It's not about speed, it's about trust.", "It's about trust."],
    [
      "Ce n'est pas une question de prix, c'est une question de délai.",
      "C'est une question de délai.",
    ],
  ])("%s can still become %s, when the quote starts at the denial", same);

  it.each([
    [
      "The patient has no cancer, but her sister has cancer.",
      "The patient has cancer.",
    ],
    [
      "Acme did not pay the fine, but Beta paid the fine.",
      "Acme paid the fine.",
    ],
    ["Minors cannot vote, but adults can vote.", "Minors can vote."],
    [
      "We cut 40 jobs. We did not cut wages. That's the reason morale held.",
      "We cut 40 jobs. That's the reason morale held.",
    ],
    [
      "Le client n'a pas payé la facture, mais la banque a payé la facture.",
      "Le client a payé la facture.",
    ],
    [
      "Si le prêt n'est pas remboursé, il est remboursé par la caution.",
      "Il est remboursé par la caution.",
    ],
    [
      "Reyes a signé. Smith n'a pas signé, mais il a payé 40 000 €.",
      "Reyes a signé, mais il a payé 40 000 €.",
    ],
  ])("%s cannot become %s, as a cut from a denial to what answers it", dropped);

  it.each([["Pas un outil. Pas un gadget. Une méthode.", "Une méthode."]])(
    "costs a suggestion: %s to %s, as a bare contrast behind another sentence",
    flipped,
  );

  it.each([
    ["Not one paid. Not a cent. The fine.", "The fine."],
    ["Not a soul came. Not a cent. The scandal.", "The scandal."],
    ["Pas un centime n'a été versé. Pas un mot. Une honte.", "Une honte."],
    ["Pas de salaire en mai. Pas de prime. Un procès.", "Un procès."],
  ])(
    "%s cannot become %s, as a sentence that states a fact ahead of a bare contrast",
    dropped,
  );

  it.each([
    ["Le député ne manque pas un vote.", "Le député assiste à tous les votes."],
    [
      "Reyes ne manque pas à ses obligations.",
      "Reyes respecte ses obligations.",
    ],
  ])(
    "costs a suggestion: %s to %s, as a set phrase narrowed to the form that denies",
    flipped,
  );

  it.each([
    ["Le député ne manque pas un vote.", "Le député rate un vote."],
    [
      "Reyes ne manque pas à ses obligations.",
      "Reyes faillit à ses obligations.",
    ],
  ])(
    "%s cannot become %s, as a set phrase narrowed to the form that denies",
    dropped,
  );

  it.each([
    [
      "In 2020 Million Dollar Baby aired again.",
      "Million Dollar Baby aired again in 2020.",
    ],
  ])("costs a suggestion: %s to %s, as a title read as an amount", changed);

  it.each([["Revenue fell by 2000 million USD.", "Revenue fell by 2000 USD."]])(
    "%s cannot become %s, as an amount before a currency",
    changed,
  );
});

describe("the cap on refused edits", () => {
  it("only counts what the text refuses, not what the guard drops", () => {
    const collector = new EditCollector(
      "It is crucial to act. Sales rose 12%.",
    );
    for (let at = 0; at < MAX_EDITS; at++) {
      expect(collector.add(edit("rose 12%", "rose 15%"))).toBeNull();
    }
    expect(collector.add(edit("crucial", "important"))?.id).toBe("edit-0");
    expect(collector.dropped).toEqual({ numbers_changed: MAX_EDITS });
  });
});

// Processor time rather than the clock, so that other work on a busy machine does not count against
// these checks
const cpuMs = (work: () => void) => {
  const started = process.cpuUsage();
  work();
  const spent = process.cpuUsage(started);
  return (spent.user + spent.system) / 1000;
};

describe("what a full request costs", () => {
  it("reads a long run of spaces after a join in far less than the route's budget", () => {
    const quotes = Array.from(
      { length: 40 },
      (_, at) =>
        `word${"abcdefghijklmnopqrstuvwxyz"[at % 26]}${"abc"[Math.floor(at / 26)]}`,
    );
    const tail = ` ${quotes.join(" ")} 3 million.`;
    const collector = new EditCollector(
      `5 and${" ".repeat(5000 - tail.length - 8)}x 6${tail}`,
    );
    const spent = cpuMs(() => {
      for (let at = 0; at < MAX_EDITS - 1; at++) {
        expect(collector.add(edit("million", "thousand"))).toBeNull();
      }
      for (const quote of quotes) {
        expect(collector.add(edit(quote, `${quote}x`))).not.toBeNull();
      }
    });
    expect(spent).toBeLessThan(500);
  });
});

describe("what the longest runs cost", () => {
  it.each([
    ["spaces after a past denial", `was not${" ".repeat(1792)}x`],
    [
      "letters that end badly after rien que d'",
      `rien que d'${"字".repeat(1788)}-`,
    ],
    ["spaces after a cleft", `It's not x that${" ".repeat(1785)}y`],
    ["spaces ahead of a denial", `x${" ".repeat(1790)}does not`],
    ["spaces after an opener", `It's${" ".repeat(1790)}x, not y`],
    [
      "openings of a cleft, then a long clause",
      `not bb ${"it isn't ".repeat(66)}${" who".repeat(299)}`,
    ],
    [
      "wide spaces after not so much",
      `not so much${"\u2003".repeat(1778)} not only x`,
    ],
    [
      "wide spaces after pas tant",
      `pas tant${"\u2003".repeat(1771)} pas seulement x`,
    ],
  ])(
    "reads 40 edits of %s in far less than the route's budget",
    (_case, long) => {
      const spent = cpuMs(() => {
        for (let at = 0; at < MAX_EDITS; at++) {
          whyDrop(edit("bb cc ".repeat(100), long));
          whyDrop(edit(long.slice(0, 600), "bb cc"));
        }
      });
      expect(spent).toBeLessThan(500);
    },
  );
});
