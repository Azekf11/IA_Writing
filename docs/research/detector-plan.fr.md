# AI Writing Detection Tool : plan de réalisation complet

> Objectif : construire un outil qui **détecte** les textes écrits (en tout ou partie) par une IA, **explique** sa décision à l'aide d'une taxonomie d'heuristiques linguistiques, et **propose une réécriture** des passages typés « IA ». Le plan s'appuie sur ce qui a déjà été publié (articles, benchmarks, outils commerciaux) et sur les solutions trouvées aux problèmes que tout le monde rencontre.
>
> Sources : chaque chiffre est suivi de sa source (section 21). Ils ont été vérifiés via les dépôts GitHub officiels, la documentation officielle et les résumés des articles. Avant de citer un chiffre dans un rapport ou en soutenance, relis la page concernée du PDF original.

---

## Sommaire

0. [TL;DR](#0-tldr)
1. [Ce que « fonctionne et est précis » veut dire](#1-ce-que--fonctionne-et-est-précis--veut-dire)
2. [Ce qui existe déjà (état de l'art)](#2-ce-qui-existe-déjà-état-de-lart)
3. [Les problèmes que tout le monde rencontre et leurs solutions](#3-les-problèmes-que-tout-le-monde-rencontre-et-leurs-solutions)
4. [Architecture cible](#4-architecture-cible)
5. [Module 0 : normalisation et segmentation](#5-module-0--normalisation-et-segmentation)
6. [Module A : signaux statistiques zero-shot](#6-module-a--signaux-statistiques-zero-shot)
7. [Module B : classifieur supervisé](#7-module-b--classifieur-supervisé)
8. [Module C : taxonomie des heuristiques linguistiques](#8-module-c--taxonomie-des-heuristiques-linguistiques)
9. [Module D : Claude (annotation, explication)](#9-module-d--claude-annotation-explication)
10. [Module E : fusion, calibration, seuils, abstention](#10-module-e--fusion-calibration-seuils-abstention)
11. [Module F : détection phrase par phrase et textes mixtes](#11-module-f--détection-phrase-par-phrase-et-textes-mixtes)
12. [Module G : réécriture et boucle red team](#12-module-g--réécriture-et-boucle-red-team)
13. [Données](#13-données)
14. [Protocole d'évaluation](#14-protocole-dévaluation)
15. [Stack, structure du repo, API](#15-stack-structure-du-repo-api)
16. [Frontend](#16-frontend)
17. [Roadmap semaine par semaine](#17-roadmap-semaine-par-semaine)
18. [Budget et matériel](#18-budget-et-matériel)
19. [Risques, éthique, légal](#19-risques-éthique-légal)
20. [Valoriser le projet (CV, entretiens, finance quant)](#20-valoriser-le-projet-cv-entretiens-finance-quant)
21. [Bibliographie vérifiée](#21-bibliographie-vérifiée)
22. [Annexe : checklist de la semaine 1](#22-annexe--checklist-de-la-semaine-1)

---

## 0. TL;DR

1. **Aucun détecteur n'est parfait, et c'est prouvé.** La meilleure AUROC possible est bornée par la distance entre la distribution des textes humains et celle des textes IA (Sadasivan et al.). En contrepartie, plus le texte est long, plus la détection devient possible (Chakraborty et al., ICML 2024). Un outil « précis » se juge donc sur son **taux de faux positifs (FPR) maîtrisé** et sur sa capacité à **s'abstenir** quand il ne sait pas. Un pourcentage d'accuracy ne suffit pas.
2. **L'API Claude ne renvoie pas de log-probabilités.** Les paramètres `logprobs` / `top_logprobs` sont ignorés dans la couche de compatibilité OpenAI, et le champ de réponse est toujours vide. Les méthodes qui reposent sur la perplexité (Binoculars, Fast-DetectGPT…) ont donc besoin d'un **modèle open-weights local**. Claude sert à ce qu'il fait bien : repérer des motifs sémantiques de la taxonomie, expliquer, réécrire.
3. **Demander à un LLM « ce texte est-il écrit par une IA ? » n'est pas fiable.** Dans la littérature, GPT-4 classe ~95 % des textes humains comme générés (survey de Wu et al., 2025). Dans notre architecture, Claude produit des **features** et des **explications**. Il ne rend jamais le verdict seul.
4. **Architecture hybride en couches** (principe « défense en profondeur ») :
   - normalisation anti-attaques ;
   - signaux statistiques zero-shot (Binoculars, Fast-DetectGPT) ;
   - classifieur supervisé (DeBERTa-v3) entraîné avec du *hard negative mining* ;
   - moteur de taxonomie (règles, spaCy, stylométrie) ;
   - annotation par Claude ;
   - méta-classifieur **calibré** avec un seuil fixé à un FPR cible et une zone « incertain » ;
   - scores phrase par phrase ;
   - module de réécriture, dont les sorties réalimentent l'entraînement (boucle adversariale).
5. **On construit l'évaluation avant les modèles.** Les métriques de référence sont le TPR à FPR fixé (1 % et 5 %), l'AUROC et la calibration (ECE). On les découpe par longueur, domaine, générateur, attaque, locuteurs non natifs et langue. Tests externes : RAID, MAGE, DetectRL.
6. Durée réaliste : **~16 semaines à 10-12 h/semaine** pour une v1 anglaise solide avec démo web, puis une extension au français.

---

## 1. Ce que « fonctionne et est précis » veut dire

### 1.1 Vérités à accepter dès le départ

| Constat | Preuve | Conséquence pour le projet |
|---|---|---|
| Limite théorique | Si la distance de variation totale (TV) entre textes humains et IA est ≤ 0,2, même le meilleur détecteur a une AUROC < 0,7 (Sadasivan et al., arXiv 2303.11156) | Ne jamais promettre 100 %. Afficher une incertitude. |
| La longueur aide | Avec *n* échantillons, la distance TV tend vers 1 exponentiellement vite (Chakraborty et al., ICML 2024) | Longueur minimale, abstention sur les textes courts, agrégation sur plusieurs paragraphes |
| Les faux positifs coûtent cher | Vanderbilt a désactivé le détecteur de Turnitin : avec 1 % de FPR et 75 000 copies soumises en 2022, ~750 copies auraient pu être signalées à tort | Le seuil se choisit sur le **FPR**, pas sur l'accuracy |
| Même les gros acteurs ont échoué | Le classifieur d'OpenAI (janv. 2023) ne détectait que 26 % des textes IA pour 9 % de FPR. Il a été retiré le 20 juillet 2023 pour son « low rate of accuracy » | Mesurer honnêtement, publier les limites |
| Taux de base | Avec TPR = 90 %, FPR = 1 % et 5 % de textes IA dans la population, seulement ~83 % des alertes sont vraies (0,045 / 0,0545) | L'interface ne doit jamais présenter un score comme une preuve |

### 1.2 Objectifs mesurables (v1 anglais)

Ces cibles sont des choix de projet. Ajuste-les une fois la baseline mesurée en semaine 4.

| # | Objectif | Mesure |
|---|---|---|
| O1 | FPR ≤ 1 % sur le test humain « in-distribution », textes ≥ 250 mots | ≥ 300 textes humains dans le test (voir la règle de trois, §14.4) |
| O2 | TPR ≥ 90 % à 1 % de FPR, même périmètre | Courbe ROC, bootstrap IC 95 % |
| O3 | Battre la meilleure baseline zero-shot (Binoculars) sur les splits hors distribution (générateur et domaine non vus) | TPR@1 %FPR et TPR@5 %FPR |
| O4 | FPR sur les essais de non-natifs ≤ 2 × le FPR global | Split dédié (§13.3) |
| O5 | Abstention (« texte trop court / hors périmètre ») sous 150 mots, sur le code et sur les listes pures | Règles plus un détecteur de genre |
| O6 | Explications : chaque alerte cite au moins un passage et une règle de la taxonomie | Tests d'intégration |
| O7 | Latence < 15 s pour 1 000 mots (GPU) avec retour de progression | Mesure dans l'API |

---

## 2. Ce qui existe déjà (état de l'art)

### 2.1 Familles de méthodes

| Famille | Méthode (réf.) | Principe | Résultat publié | Coût | Limites connues |
|---|---|---|---|---|---|
| Statistique simple | Log-likelihood, rank, log-rank, entropie ; GLTR (Gehrmann et al., ACL 2019 demo) | Le texte IA contient surtout des tokens très probables et bien classés pour un LM | GLTR fait passer la détection humaine de 54 % à 72 % | 1 passe | Dépend de l'écart entre le modèle de scoring et le générateur |
| Perplexité + burstiness | GPTZero (version 2023) | Perplexité basse et faible variation entre phrases → IA | GPTZero dit être passé en 2023 à une architecture deep learning multi-composants (rapport technique arXiv 2602.13042) | 1 passe | Biais contre les non-natifs (Liang et al.) |
| Courbure de probabilité | DetectGPT (Mitchell et al., ICML 2023) | Un texte IA se trouve sur un maximum local de log p : ses perturbations (T5) font baisser log p | AUROC 0,81 → 0,95 sur des fake news GPT-NeoX-20B | ~100 perturbations + 100 passes | Très lent ; tombe de 70,3 % à 4,6 % de détection (à 1 % FPR) après paraphrase DIPPER |
| Courbure conditionnelle | Fast-DetectGPT (Bao et al., ICLR 2024) | Version analytique : on compare log p du texte à l'espérance sous un modèle de référence, sans perturbation | AUROC 0,9887 (white-box, 5 modèles) ; 0,9338 (ChatGPT/GPT-4, black-box) ; 340× plus rapide que DetectGPT | 1-2 passes | F1 moyen 55,33 sur DetectRL (conditions réalistes), contre 93,02 pour un RoBERTa fine-tuné |
| Ratio perplexité / cross-perplexité | **Binoculars** (Hans et al., ICML 2024) | Divise la perplexité du texte par une cross-perplexité entre deux modèles proches (observer / performer). Corrige le « problème du capybara » : un prompt inhabituel produit du texte IA à forte perplexité | > 90 % des textes ChatGPT détectés à **0,01 % de FPR** | 2 passes de modèles 7B | Surtout efficace en anglais (README) ; 79,0 % TPR@5 %FPR sur le test non adversarial du shared task RAID |
| Features + classifieur | Ghostbuster (Verma et al., NAACL 2024) | Probabilités de modèles faibles (unigram, trigram, ada, davinci) → recherche de features → régression logistique | 99,0 F1, +5,9 F1 vs l'état de l'art | Dépend des logprobs d'API OpenAI legacy | Faible sur les textes courts, hors domaine, non-natifs, textes édités |
| N-grammes divergents | DNA-GPT (Yang et al., ICLR 2024) | On tronque le texte, on fait régénérer la suite par le LLM, on compare les n-grammes | Bat le classifieur OpenAI sur 4 datasets EN + 1 DE | ~30 régénérations/texte | Coûteux ; AUROC 64,92 sur DetectRL |
| Classifieur fine-tuné | RoBERTa/DeBERTa ; OpenAI GPT-2 detector ; MAGE (Longformer) | Encodeur entraîné sur des paires humain/IA | MAGE : AUROC 0,99 en distribution, **0,75 sur textes paraphrasés** | 1 passe | Généralise mal hors domaine et hors générateur (M4, MAGE) |
| Entraînement adversarial | RADAR (Hu et al., NeurIPS 2023) | Un paraphraseur et un détecteur s'entraînent l'un contre l'autre | +31,64 % d'AUROC vs meilleure baseline contre un paraphraseur non vu | Entraînement lourd | Modèle 7B |
| Hard negative mining | Pangram (rapport technique, arXiv 2402.14873) | On score un grand pool de textes humains ; les faux positifs vont dans le train, chacun avec un texte IA « miroir » de même sujet | FPR « orders of magnitude lower » (auto-déclaré). Évaluation indépendante (Jabarian & Imas, BFI/NBER 2025) : seul détecteur testé sous le plafond FPR ≤ 0,5 % sans perdre en détection | Grand volume de données | Propriétaire ; les rapports de l'éditeur ne sont pas indépendants |
| Watermarking | Kirchenbauer et al. (ICML 2023) ; SynthID Text (Nature 2024, intégré à HF Transformers v4.46.0) | Le fournisseur biaise l'échantillonnage vers une « green list » ; on détecte par un z-test | Très fiable **si** le fournisseur coopère | Côté fournisseur | Inutile pour les modèles sans watermark ; affaibli par paraphrase et traduction |
| Estimation à l'échelle d'un corpus | Liang et al. (ICML 2024) ; Kobak et al. (Sci. Adv. 2025) | Estimer la **proportion** de texte IA dans un corpus, sans juger chaque document | 6,5-16,9 % des reviews de conférences IA modifiées par LLM ; ≥ 13,5 % des abstracts PubMed 2024 | Faible | Ne s'applique pas à un document unique |

### 2.2 Comment les meilleurs s'en sortent

- **Pangram** (à égalité en tête du shared task RAID avec Leidos, 99,3 % TPR@5 %FPR sur le test non adversarial) : données massives, *hard negative mining* avec « mirror prompts », apprentissage actif.
- **GPTZero** : architecture multi-composants hiérarchique, classifieur phrase par phrase, red teaming automatisé, robustesse annoncée aux homoglyphes et à la paraphrase.
- **Turnitin** : longueur minimale portée de 150 à 300 mots ; scores de 1 à 19 % masqués (astérisque) car trop de faux positifs dans cette zone ; FPR document < 1 % (quand ≥ 20 % d'IA) mais ~4 % au niveau phrase ; détection des « AI bypassers » (humanizers) depuis août 2025.
- **Les experts humains** : un vote majoritaire de 5 annotateurs qui utilisent souvent ChatGPT ne se trompe que sur 1 article sur 300 (Russell, Karpinska & Iyyer, ACL 2025). Des indices linguistiques bien choisis sont donc très informatifs, et c'est ce qui justifie la taxonomie du Module C.

**Ce qu'on retient pour notre design :** combiner des signaux **indépendants** (statistiques, appris, linguistiques), calibrer, fixer le seuil sur le FPR, s'abstenir, travailler au niveau phrase, et entraîner contre les attaques.

---

## 3. Les problèmes que tout le monde rencontre et leurs solutions

| # | Problème | Preuve | Solution dans ce plan |
|---|---|---|---|
| P1 | **Biais contre les non-natifs** | 7 détecteurs : **61,22 %** de FPR moyen sur 91 essais TOEFL. 18/91 signalés par les 7 détecteurs, 89/91 par au moins un. Le FPR tombe à 11,77 % quand on enrichit le vocabulaire (Liang et al., *Patterns* 2023) | Split d'évaluation non-natifs (O4) ; hard negatives issus d'essais d'apprenants ; le vocabulaire simple ne doit jamais servir de feature « IA » ; audit du FPR par sous-groupe |
| P2 | **Paraphrase / humanizers** | DIPPER (11B) : DetectGPT tombe de 70,3 % à 4,6 % (1 % FPR). MAGE : AUROC 0,75 sur paraphrases | Augmentation par paraphrase dans le train ; boucle red team avec notre propre réécrivain (§12) ; features taxonomiques qui survivent partiellement à la paraphrase |
| P3 | **Textes courts** | Classifieur OpenAI peu fiable sous 1 000 caractères ; Turnitin exige 300 mots | Abstention sous 150 mots ; confiance réduite entre 150 et 300 ; bucket de longueur dans toutes les évaluations |
| P4 | **Nouveaux modèles / nouveaux domaines** | M4, MAGE : sur des domaines non vus, les détecteurs classent le texte IA comme humain. DetectRL : les détecteurs « struggle with texts generated by Claude » | Splits *leave-one-generator-out* et *leave-one-domain-out* ; générateurs variés (dont Claude) ; jeu « canary » régénéré avec les derniers modèles ; réentraînement périodique |
| P5 | **Stratégie de décodage** | RAID : la pénalité de répétition fait perdre jusqu'à 38 points | Générer les données avec T = 0 / T = 1, top-p et repetition penalty 1,2 sur des modèles open-weights |
| P6 | **Attaques caractères** (homoglyphes, zero-width, espaces) | SilverSpeak : le MCC moyen de 7 détecteurs passe de 0,64 à −0,01 avec des homoglyphes. RAID : 11 attaques (suppression d'articles, homoglyphes, number swap, paraphrase, synonymes, fautes, espaces, casse, zero-width, paragraphes insérés, orthographe alternative) | Normalisation en 4 étapes (§5), testée ; la présence de caractères invisibles devient un **signal d'altération** affiché |
| P7 | **Textes mixtes / polis par IA** | APT-Eval : GLTR a 6,83 % de FPR sur texte humain pur mais signale 40,87 % des textes « extremely minor » polis par GPT-4o. Turnitin : 54 % des phrases faussement signalées sont adjacentes à une phrase IA | Scores phrase par phrase + lissage ; label « IA-assisté / poli » distinct ; pas de verdict binaire |
| P8 | **LLM utilisé comme juge** | ChatGPT classe ~50 % du texte LLM comme humain ; GPT-4 classe ~95 % du texte humain comme LLM (Bhattacharjee & Liu ; survey Wu et al. 2025) | Claude n'est jamais le décideur final : il fournit des features et des explications, et la fusion est apprise sur données |
| P9 | **Dérive des indices lexicaux** | « delve » est tombé à 1 message sur 1 000 chez GPT-4o en 2025 pendant que « not just X, but Y » montait à 6 % (Washington Post, 2025) ; la page Wikipedia classe désormais son vocabulaire par ère de modèles | Taxonomie versionnée avec un champ `era` ; poids appris (pas codés à la main) ; réévaluation trimestrielle |
| P10 | **Contamination des données « humaines »** | Du texte post-2022 récupéré sur le web peut être généré | Textes humains antérieurs au **30 novembre 2022** (sortie de ChatGPT), sauf corpus vérifiés |
| P11 | **Apprentissage de raccourcis** (longueur, format, sujet) | Les paires humain/IA diffèrent souvent par la longueur et la mise en forme | Appariement par longueur, normalisation du format pour le classifieur, split groupé par prompt, audits d'ablation |
| P12 | **Genres formulaïques** (recettes, poésie, code, textes juridiques) | RAID calibre ses seuils par domaine sur des données humaines | Seuils par domaine ; hors périmètre pour le code |
| P13 | **Traduction automatique** | Weber-Wulff et al. (2023) : la traduction dégrade la détection ; SynthID : confiance « greatly reduced » après traduction | Zone grise documentée ; détection de langue ; jamais d'accusation sur un texte traduit |
| P14 | **Interprétation du score** | Confusion entre « 80 % de probabilité IA » et « 80 % du texte écrit par IA » | Deux indicateurs distincts dans l'UI (§16) : confiance du verdict et part de phrases signalées |
| P15 | **Usage punitif** | Turnitin : le score ne doit pas être « the sole basis for adverse actions » ; Waterloo a abandonné l'outil en 2025 | Avertissements explicites dans l'UI et la model card (§19) |

---

## 4. Architecture cible

```
                        ┌─────────────────────────────────────────────┐
  Texte brut ─────────► │ Module 0 : normalisation & segmentation      │
                        │  NFKC · suppression Cf · confusables · langue │
                        │  phrases · fenêtres · table d'offsets        │
                        └───────┬───────────────┬──────────────┬───────┘
                                │ texte normalisé│ texte brut   │
             ┌──────────────────┼───────────────┼──────────────┼──────────────────┐
             ▼                  ▼               ▼              ▼                  │
   ┌─────────────────┐ ┌───────────────┐ ┌──────────────────────┐ ┌─────────────────────┐
   │ A. Zero-shot     │ │ B. Classifieur│ │ C. Taxonomie (règles,│ │ D. Claude : annota-  │
   │ Binoculars,      │ │ DeBERTa-v3    │ │ spaCy, stylométrie)  │ │ tion taxonomique +   │
   │ Fast-DetectGPT   │ │ fine-tuné     │ │ → comptes/1000 mots  │ │ explications (JSON)  │
   │ (LM open local)  │ │ (fenêtres)    │ │   + spans            │ │ → comptes + spans    │
   └────────┬────────┘ └───────┬───────┘ └──────────┬───────────┘ └──────────┬──────────┘
            └──────────────────┴───────────┬────────┴────────────────────────┘
                                           ▼
                        ┌─────────────────────────────────────────────┐
                        │ E. Fusion (régression logistique empilée)   │
                        │   calibration isotonique · seuil @FPR cible  │
                        │   3 zones : humain / incertain / IA          │
                        ├─────────────────────────────────────────────┤
                        │ F. Scores par phrase + lissage (mixtes)      │
                        └──────────────────┬──────────────────────────┘
                                           ▼
                 Rapport JSON : verdict, confiance, heatmap, indices taxonomiques
                                           │
                                           ▼ (optionnel, à la demande)
                        ┌─────────────────────────────────────────────┐
                        │ G. Réécriture guidée (Claude) → vérif. sens  │
                        │    → re-scoring → exemples pour le red team  │
                        └─────────────────────────────────────────────┘
```

**Principes de design :**

1. **Signaux indépendants.** Les erreurs des méthodes statistiques (A), apprises (B) et linguistiques (C/D) sont peu corrélées ; les combiner réduit la variance.
2. **Deux vues du texte.** Les modèles (A, B) lisent le texte **normalisé**. Les règles de formatage (C : guillemets courbes, gras, emojis, markdown) lisent le texte **brut**. Sinon la normalisation effacerait des indices.
3. **La fusion est apprise.** Aucun poids n'est fixé à la main : la dérive (P9) rendrait des poids manuels obsolètes.
4. **Traçabilité.** Chaque alerte est reliée à des spans (offsets dans le texte original) et à un identifiant de règle de la taxonomie.

---

## 5. Module 0 : normalisation et segmentation

### 5.1 Étapes

1. **NFKC** : ramène les pleines chasses (`ａ` → `a`), les ligatures (`ﬁ` → `fi`) et les espaces spéciaux (NBSP → espace).
2. **Suppression des caractères de catégorie Unicode `Cf`** (format) : ZWSP U+200B, ZWJ U+200D, WJ U+2060, BOM U+FEFF, soft hyphen U+00AD. NFKC ne les supprime **pas** (vérifié).
3. **Confusables** : NFKC ne touche **pas** au `а` cyrillique (U+0430) ni au `Α` grec (U+0391) (vérifié). On applique donc le *skeleton* UTS #39 (table officielle `confusables.txt` d'Unicode, ou une bibliothèque comme `confusable_homoglyphs`) et on détecte les mots qui mélangent plusieurs écritures.
4. **Espaces** : on fusionne les espaces multiples, on normalise les fins de ligne et on conserve les limites de paragraphes.
5. **Table d'offsets** normalisé → original, pour surligner les bons caractères dans l'UI.
6. **Détection de langue** (fastText `lid.176` ou `lingua`) : routage EN/FR, abstention sinon.
7. **Segmentation en phrases** (spaCy `en_core_web_sm` / `fr_core_news_sm`, ou pySBD) et en **fenêtres** de 512 tokens pour les modèles.
8. **Détecteur de genre / hors périmètre** : code, tableaux, listes pures, vers → abstention ou seuils dédiés (P12).

```python
import unicodedata

def normalize(text: str) -> tuple[str, dict]:
    """Retourne (texte_nettoyé, drapeaux). Garder l'original pour l'affichage."""
    nfkc = unicodedata.normalize("NFKC", text)
    n_format = sum(unicodedata.category(c) == "Cf" for c in nfkc)
    clean = "".join(c for c in nfkc if unicodedata.category(c) != "Cf")
    clean = " ".join(clean.split())          # à remplacer par une version qui garde les paragraphes
    return clean, {"format_chars": n_format}  # + confusables / scripts mixtes à l'étape 3
```

> Le nombre de caractères invisibles et d'homoglyphes est remonté comme **signal d'altération** (« ce texte contient 14 caractères invisibles »). Aucun humain n'en tape volontairement dans une dissertation.

---

## 6. Module A : signaux statistiques zero-shot

### 6.1 Pourquoi un modèle local

L'API Claude ne renvoie pas de probabilités de tokens (§0). Tous les scores de ce module sont calculés avec un **modèle proxy open-weights**. Ça fonctionne aussi sur du texte Claude : le README de Lastde rapporte une AUROC moyenne de 99,96 pour Fast-DetectGPT sur des textes Claude-3-Haiku, avec GPT-J-6B comme proxy.

### 6.2 Binoculars (signal principal)

- Code officiel : `github.com/ahans30/Binoculars` (`detector.py`, `metrics.py`).
- Modèles officiels : observer `tiiuae/falcon-7b`, performer `tiiuae/falcon-7b-instruct`, bfloat16, `max_token_observed=512`.
- Score = `ppl / x_ppl` : la perplexité du texte, divisée par la cross-perplexité entre les distributions des deux modèles. **Score bas → IA.**
- Seuils du repo :
  - `BINOCULARS_FPR_THRESHOLD = 0.8536432310785527` (« low-fpr », choisi à 0,01 % de FPR) ;
  - `BINOCULARS_ACCURACY_THRESHOLD = 0.9015310749276843` (optimisé F1).
- ⚠️ Ces seuils ne valent **que** pour cette paire de modèles, en bf16, sur leurs données. Si tu changes de modèles, de précision (quantification) ou de domaine, **recalibre le seuil sur tes propres textes humains** (§10.3).
- ⚠️ Des analyses tierces signalent que les rôles observer/performer sont inversés entre l'article et le code. Suis le **code officiel** et documente ton choix.
- Mémoire : 7 milliards de paramètres × 2 octets ≈ 14 Go par modèle en bf16, soit ~28 Go pour la paire, plus les activations.

**Configuration « budget » à tester** (hypothèse à valider par tes propres mesures, aucun résultat publié vérifié) : une paire base/instruct plus petite qui **partage le même tokenizer**, par exemple `Qwen/Qwen2.5-1.5B` + `Qwen/Qwen2.5-1.5B-Instruct`. Elle a l'avantage d'être multilingue. Compare-la à la paire Falcon sur le même jeu de validation avant de l'adopter.

### 6.3 Fast-DetectGPT (second signal)

- Code officiel : `github.com/baoguangsheng/fast-detect-gpt`.
- Critère analytique : (Σₜ log p(xₜ) − Σₜ μₜ) / √(Σₜ σ²ₜ), où μₜ et σ²ₜ sont l'espérance et la variance de log p sous le modèle de référence. **Score haut → IA.**
- Défauts du code (`scripts/local_infer.py`) : sampling `falcon-7b`, scoring `falcon-7b-instruct`. Le README (actualité du 31/01/2026) indique que la paire Llama3-8B / Llama3-8B-Instruct fait nettement mieux, en particulier sur les textes produits par des modèles de raisonnement.
- Avec la même paire que Binoculars, les deux scores sortent des **mêmes passes forward** : les logits sont réutilisés, il n'y a pas de coût supplémentaire.

### 6.4 Features complémentaires (gratuites une fois les logits calculés)

- Log-likelihood moyenne, log-rank moyen, LRR (−ll / logrank ; Su et al., DetectLLM), entropie moyenne.
- **Burstiness** : écart-type et coefficient de variation de la perplexité **par phrase**. C'est l'intuition de GPTZero, et Muñoz-Ortiz et al. observent que les longueurs de phrases humaines sont plus dispersées.
- Buckets de rang façon GLTR : % de tokens top-10, top-100, top-1000, reste.

### 6.5 Pièges

- Textes > 512 tokens : découpe en fenêtres et agrège (moyenne pondérée par nombre de tokens, et minimum).
- GPU sans bfloat16 (ex. T4) : passe en float16, vérifie l'absence de NaN, recalibre.
- Quantification 8/4 bits : possible, mais les scores bougent, donc recalibrage obligatoire.

---

## 7. Module B : classifieur supervisé

### 7.1 Modèle

- Anglais : `microsoft/deberta-v3-base` (puis `-large` si le GPU le permet).
- Multilingue / français : `microsoft/mdeberta-v3-base` ou `xlm-roberta-base`. Pour du français seul, un modèle de la famille CamemBERT (Antoun et al. ont fine-tuné CamemBERTa pour détecter ChatGPT en français).
- Tête de classification binaire (humain / IA), puis 3 classes si les données le permettent (humain / IA / IA-poli).

### 7.2 Entraînement

| Élément | Choix | Pourquoi |
|---|---|---|
| Entrée | Texte normalisé ; guillemets, markdown et emojis neutralisés | Éviter les raccourcis de format (P11). Le formatage est traité par le Module C. |
| Longueur | Fenêtres de 512 tokens, stride 256 ; agrégation par moyenne des logits | Textes longs |
| Hyperparamètres de départ | lr 2e-5, 2-3 epochs, warmup 10 %, batch 16 (accumulation si besoin), early stopping sur **TPR@1 %FPR** en validation | La métrique cible, pas la loss |
| Équilibrage | Appariement par longueur (buckets < 150 / 150-300 / 300-600 / > 600 mots) et par domaine | P11 |
| Augmentation | Attaques RAID appliquées au train (fautes, synonymes, suppression d'articles, paraphrases Claude et open-weights) | P2, P6 |
| **Hard negative mining** (façon Pangram) | 1) on score un grand pool humain ; 2) on garde les faux positifs ; 3) pour chacun, on génère un texte IA « miroir » (même sujet, même longueur, même genre) ; 4) on ajoute les deux au train ; 5) on itère 2-3 fois | La recette publiée la plus efficace contre les faux positifs |
| Non-natifs | Essais d'apprenants ajoutés comme négatifs (humains) | P1 |

### 7.3 Pièges

- **Fuite de données** : le texte humain et le texte IA d'une même question doivent tomber dans le **même split**. On fait un split groupé par `prompt_id` / `source_id`.
- **Near-duplicates** : déduplication MinHash LSH (`datasketch`, Jaccard ~0,8 sur 5-shingles) **avant** le split.
- Un classifieur excellent en distribution (0,99 AUROC) peut s'effondrer hors distribution. Il ne vaut que ce que valent tes splits OOD (§14).

---

## 8. Module C : taxonomie des heuristiques linguistiques

C'est le cœur de la ligne de CV : *« applies a structured taxonomy of linguistic heuristics for automated text classification »*.

### 8.1 Principes (repris des avertissements de la page Wikipedia elle-même)

- Ce sont des **observations, pas des règles**. Aucun indice isolé ne prouve rien : un humain peut écrire « crucial ». C'est la **densité** et la **co-occurrence** d'indices qui comptent (« where there is one, there are likely others »).
- Les indices de ponctuation et de format sont **spécifiques au contexte** : Wikipedia précise qu'ils « may not apply in a non-Wikipedia context ». Word et macOS/iOS produisent aussi des guillemets courbes.
- Wikipedia liste des **indicateurs inefficaces** à ne pas utiliser (§8.4).
- Le vocabulaire **dérive selon les générations de modèles** (§8.5).
- La taxonomie produit des **features** et des **explications**. Le verdict revient à la fusion apprise.

### 8.2 Taxonomie v1

Sources :
- [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) (WikiProject AI Cleanup), version de décembre 2025 plus la révision de septembre 2026 ;
- le projet open source `blader/humanizer` (24 motifs en v2, 26 en v3.1) ;
- Kobak et al. (vocabulaire excédentaire) ;
- Liang et al. ICML 2024 ;
- Reinhart et al. (PNAS 2025, traits de Biber) ;
- Herbold et al. (Sci. Rep. 2023) ;
- Muñoz-Ortiz et al. (2024).

Colonne **Méthode** : `LEX` = lexique/regex, `SYN` = règle syntaxique spaCy, `STAT` = statistique calculée, `LLM` = annotation Claude. Colonne **Force** : `fort` = presque univoque, `moyen`, `faible` = utile seulement en combinaison.

| ID | Famille / motif | Exemples | Méthode | Force |
|---|---|---|---|---|
| **CNT — Contenu** | | | | |
| CNT-01 | Importance / héritage gonflés | « stands as a testament », « plays a pivotal role », « indelible mark », « deeply rooted » | LEX + LLM | moyen |
| CNT-02 | Notoriété / couverture médiatique mise en avant | « independent coverage », « active social media presence » | LEX + LLM | moyen |
| CNT-03 | Analyses superficielles en -ing | « …, highlighting/underscoring/showcasing/ensuring… » en fin de phrase avec sujet inanimé | SYN (participiale finale) + LLM | moyen |
| CNT-04 | Langage promotionnel | « nestled », « in the heart of », « boasts a », « groundbreaking », « vibrant » | LEX | moyen |
| CNT-05 | Attributions vagues (weasel words) | « Experts argue », « Observers have cited », « Industry reports » | LEX + LLM | moyen |
| CNT-06 | Section « défis et perspectives » formulaïque | « Despite its… faces several challenges », « Despite these challenges », « Future Outlook » | LEX + LLM | moyen |
| CNT-07 | Disclaimers didactiques | « it's important to note », « it's crucial to remember », « may vary » | LEX | moyen |
| CNT-08 | Conclusions génériques | « In conclusion », « In summary », « The future looks bright » | LEX + LLM | faible |
| CNT-09 | Association vague (ajout 2026) | liens flous du type « is closely associated with » sans contenu | LLM | faible |
| **LNG — Langue et grammaire** | | | | |
| LNG-01 | Vocabulaire IA (par ère, §8.5) | delve, tapestry, testament, intricate, meticulous, showcasing, underscore, pivotal, crucial, landscape, fostering, garner, realm, seamless, robust… | LEX (densité / 1 000 mots) | faible seul, fort en densité |
| LNG-02 | Évitement de la copule | « serves as », « stands as », « boasts », « features » à la place de « is/has » | SYN | faible |
| LNG-03 | Parallélismes négatifs | « Not only… but also », « It's not just X, it's Y », « Y rather than X » | LEX (regex) | moyen |
| LNG-04 | Énumération de négatifs | « no X, no Y, just Z », « What matters is X, not Y » | LEX | moyen |
| LNG-05 | Règle de trois | triplets d'adjectifs ou de groupes courts | SYN (coordination à 3 éléments) | faible |
| LNG-06 | Variation synonymique forcée | « protagonist… key player… eponymous character » | LLM | faible (classé « historique » en 2026) |
| LNG-07 | Faux intervalles | « from X to Y » sans échelle cohérente | LLM | faible |
| LNG-08 | Hedging excessif | « could potentially possibly », qualificatifs empilés | LEX | faible |
| LNG-09 | Remplissage | « In order to », « Due to the fact that » | LEX | faible |
| **STY — Style et format** (lus sur le texte **brut**) | | | | |
| STY-01 | Tirets cadratins (em dash) | densité de « — » | STAT | faible (dépend du fournisseur) |
| STY-02 | Gras excessif | `**…**` fréquents | LEX | moyen |
| STY-03 | Listes à en-tête en ligne | puce + **Titre :** + phrase | LEX | moyen |
| STY-04 | Title Case dans les titres | « Strategic Negotiations And Partnerships » | LEX | moyen |
| STY-05 | Emojis devant titres/puces | 🚀 💡 ✅ | LEX | moyen |
| STY-06 | Guillemets/apostrophes courbes | “ ” ’ | LEX | faible (Word/macOS aussi) |
| STY-07 | Markdown dans un contexte non markdown | `##`, `**`, blocs ``` | LEX | moyen |
| **COM — Communication destinée à l'utilisateur** | | | | |
| COM-01 | Résidus de chatbot | « I hope this helps », « Certainly! », « Let me know if », « Would you like… » | LEX | **fort** |
| COM-02 | Disclaimers de date de coupure | « as of my last knowledge update », « While specific details are limited » | LEX | **fort** |
| COM-03 | Refus de prompt | « As an AI language model », « I'm sorry, but » | LEX | **fort** (devenu rare) |
| COM-04 | Ton servile | « Great question! », « You're absolutely right! » | LEX | fort |
| COM-05 | Placeholders et gabarits | « [Your Name] », `2025-XX-XX`, `url=URL` | LEX (regex) | **fort** |
| **MRK — Balisage et citations** | | | | |
| MRK-01 | Balisage spécifique aux fournisseurs | `citeturn0search0`, `:contentReference[oaicite:0]`, `oai_citation`, `[cite: 1]` (Gemini), `【85†L261-269】` (DeepSeek) | LEX (regex) | **fort** |
| MRK-02 | Paramètres UTM | `utm_source=chatgpt.com`, `utm_source=openai`, `utm_source=copilot.com` | LEX | ⚠️ prouve que l'IA a **trouvé** la source, pas qu'elle a **écrit** le texte |
| MRK-03 | Références invalides | DOI/ISBN à checksum invalide, DOI menant à un article sans rapport | STAT (vérification checksum + résolution DOI) | fort si avéré |
| **STAT — Stylométrie** (Kumarage et al. ; StyloAI ; Herbold ; Muñoz-Ortiz ; Reinhart) | | | | |
| STAT-01 | Variabilité de longueur des phrases | écart-type, coefficient de variation (humains plus dispersés) | STAT | moyen |
| STAT-02 | Diversité lexicale | MTLD (moins sensible à la longueur que le TTR brut), MATTR | STAT | faible |
| STAT-03 | Nominalisations | taux de suffixes -tion/-ment/-ness… (plus élevé chez ChatGPT ; 1,5-2× chez les modèles instruct) | SYN | moyen |
| STAT-04 | Participiales présentes | taux 2-5× plus élevé chez les modèles instruct (Reinhart) | SYN | moyen |
| STAT-05 | Passifs sans agent | ~2× moins fréquents chez GPT-4o que chez les humains | SYN | faible |
| STAT-06 | Marqueurs de discours, modaux, épistémiques | moins de modaux/épistémiques chez ChatGPT que chez les étudiants | LEX | faible |
| STAT-07 | Ponctuation | fréquences par signe (; : — ! ?) | STAT | faible |
| STAT-08 | Lisibilité | Flesch Reading Ease (`textstat`) | STAT | faible |
| STAT-09 | Uniformité des paragraphes | écart-type des longueurs de paragraphes | STAT | faible |

### 8.3 Format de la taxonomie (YAML versionné)

```yaml
# taxonomy/taxonomy_v1.yaml
version: "1.0.0"
language: en
source_snapshot: "Wikipedia:Signs_of_AI_writing, rev. Dec 2025 + Sep 2026 changes"
patterns:
  - id: COM-01
    family: communication
    name: Chatbot residue
    description: Phrases adressées à l'utilisateur d'un chatbot, restées dans le texte final.
    method: [lexicon]
    strength: strong
    era: [gpt-3.5, gpt-4, gpt-4o, gpt-5, claude]
    lexicon: ["i hope this helps", "let me know if", "certainly!", "would you like me to"]
    examples_positive: ["I hope this helps! Let me know if you need anything else."]
    examples_negative: ["Let me know if the meeting moves; I'll bring the slides."]
    rewrite_hint: Supprimer entièrement.
  - id: LNG-01
    family: language
    name: AI vocabulary density
    method: [lexicon, statistic]
    strength: weak
    era_lexicons:   # listes issues de la révision 2026 de la page (source secondaire) : à revérifier sur la page
      gpt-4:  [additionally, boasts, bolstered, crucial, delve, emphasizing, enduring, garner, intricate, interplay, key, landscape, meticulous, pivotal, underscore, tapestry, testament, valuable, vibrant]
      gpt-4o: [align with, bolstered, crucial, emphasizing, enhance, enduring, fostering, highlighting, pivotal, showcasing, underscore, vibrant]
      gpt-5:  [emphasizing, enhance, highlighting, showcasing]
    feature: count_per_1000_words
```

**Tests unitaires gratuits :** chaque motif a des exemples positifs et négatifs. Les paires avant/après de Wikipedia et du projet humanizer servent directement de jeux de tests `pytest` (le « avant » doit déclencher la règle, le « après » ne doit pas).

### 8.4 Anti-signaux : ce qu'il ne faut PAS utiliser

La page Wikipedia les classe explicitement parmi les indicateurs inefficaces :

- grammaire parfaite ;
- prose « fade » ou « robotique » ;
- mots « recherchés » ou académiques ;
- style épistolaire seul ;
- connecteurs logiques seuls ;
- wikitext bizarre.

Ajout du plan : **vocabulaire simple ou répétitif**. C'est la cause du biais contre les non-natifs (faible perplexité, Liang et al.).

### 8.5 Gestion de la dérive

- Le vocabulaire varie par ère de modèles (la révision 2026 de la page Wikipedia le découpe en eras GPT-4 / GPT-4o / GPT-5, plus quelques termes propres à Grok).
- Kobak et al. donnent des ratios d'excès dans PubMed 2024 : « delves » r = 28,0, « underscores » 13,8, « showcasing » 10,7. Leur dépôt publie ~900 mots excédentaires, dont 407 étiquetés « style » et 462 « contenu », une bonne base de lexique.
- Liang et al. (reviews ICLR 2024) : « meticulous » 34,7×, « intricate » 11,2×, « commendable » 9,8×.
- **Mise en pratique :**
  - chaque lexique a une ère ;
  - les features sont calculées par ère et par famille ;
  - les poids sont appris par la fusion ;
  - chaque trimestre, on régénère un jeu « canary » avec les modèles récents et on mesure quelles règles perdent leur pouvoir discriminant (AUROC par feature) ;
  - on publie une nouvelle version de la taxonomie (`1.1.0`, `2.0.0`…).

### 8.6 Français (phase 2)

- **Source de recherche :** l'étude 34 langues de Juzek (arXiv 2605.25358, données publiques). Le français fait partie des 10 langues avec une hausse post-2022 ; les verbes du type « souligner/insister » sont sur-utilisés dans 24 langues sur 34.
- **Ratios calculés à partir des données publiées** (GPT-4.1-mini, calcul approximatif, à refaire toi-même) :
  - « cependant » ~29× ;
  - « crucial », « importance », « innovant », « renforcer », « vigilance » ~24-27× ;
  - « significatif » 18× ; « défi » 16× ; « refléter » 13× ;
  - « souligner », « notamment » ~5×.
- **Tics signalés par des blogs** (non validés scientifiquement, à tester sur tes données avant de les intégrer) : « Dans un monde en constante évolution », « Il est important de noter que », « à l'ère de », « au cœur de », « En conclusion ».
- **Règle :** un motif français n'entre dans la taxonomie qu'après avoir montré un pouvoir discriminant mesuré sur ton jeu FR (AUROC de la feature > 0,55 sur la validation, par exemple).

---

## 9. Module D : Claude (annotation, explication)

### 9.1 Rôle exact

Claude reçoit le texte et la taxonomie. Il renvoie la **liste des occurrences** de motifs sémantiques difficiles à capter par regex : CNT-01 à CNT-09, LNG-06, LNG-07, avec pour chacune la citation exacte, la gravité et une justification courte. Il **ne donne pas** de probabilité « IA ». Ses sorties deviennent :

1. des **features** (comptes par famille / 1 000 mots, nombre d'occurrences « high ») pour la fusion ;
2. des **explications** affichées dans l'UI.

### 9.2 Choix techniques (API Anthropic)

| Point | Choix | Détail |
|---|---|---|
| Modèle | `claude-opus-5` par défaut, paramétrable | `claude-sonnet-5` ($2 / $10 par million de tokens entrée/sortie) ou `claude-haiku-4-5` ($1 / $5) coûtent moins cher pour annoter des milliers de textes. C'est ton arbitrage coût/qualité, à mesurer sur 100 textes annotés à la main. |
| Sortie | **Structured outputs** : `output_config.format` avec un JSON Schema | JSON toujours valide ; `pattern_id` contraint par un `enum` des IDs de la taxonomie |
| Offsets | Demander la **citation exacte**, puis calculer les offsets côté Python (recherche exacte, sinon fuzzy avec `rapidfuzz`) | Les LLM comptent mal les caractères |
| Coût | **Prompt caching** sur le system prompt (taxonomie, ~3-5k tokens) | Une lecture en cache coûte ~0,1× le prix d'entrée ; minimum cacheable de 512 tokens sur Opus 5 |
| Volume | **Message Batches API** pour annoter les datasets : −50 %, jusqu'à 100 000 requêtes/batch, résultats en général en moins d'1 h (max 24 h) | Les résultats arrivent dans le désordre : indexer par `custom_id` |
| Reproductibilité | Pas de `temperature` sur Opus 5 (400 si fourni) : on **met en cache les résultats** par `sha256(texte + version_taxonomie + modèle)` | Features identiques entre deux runs |
| Effort | `output_config.effort = "low"` pour l'annotation (tâche d'extraction) ; à comparer avec `medium` sur le jeu annoté | Les tokens de réflexion sont facturés comme de la sortie |
| Refus | Vérifier `stop_reason == "refusal"` avant de lire `content` ; en temps réel, activer les fallbacks serveur (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Ils ne sont **pas** disponibles dans l'API Batches. | Rare pour ce type de tâche, mais le code ne doit pas planter |
| Train/serve | Même modèle, même prompt, même version de taxonomie à l'entraînement et en production | Sinon les features divergent |

### 9.3 Exemple (Python, SDK officiel `anthropic`)

```python
import json
import anthropic

client = anthropic.Anthropic()  # lit ANTHROPIC_API_KEY

PATTERN_IDS = ["CNT-01", "CNT-02", "CNT-03", "CNT-05", "CNT-06", "CNT-09", "LNG-06", "LNG-07"]

SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pattern_id": {"type": "string", "enum": PATTERN_IDS},
                    "quote": {"type": "string"},
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "rationale": {"type": "string"},
                },
                "required": ["pattern_id", "quote", "severity", "rationale"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}

def annotate(text: str, taxonomy_prompt: str) -> list[dict]:
    response = client.beta.messages.create(
        model="claude-opus-5",
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=[{"type": "text", "text": taxonomy_prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": f"<text>\n{text}\n</text>"}],
    )
    if response.stop_reason == "refusal":
        return []
    raw = next(b.text for b in response.content if b.type == "text")
    return json.loads(raw)["findings"]
```

**Contenu du `taxonomy_prompt` :**

- la définition de chaque motif, avec 1 exemple positif et 1 exemple négatif (tirés du YAML) ;
- la consigne « cite le passage mot pour mot » ;
- la consigne « si aucun motif n'est présent, renvoie une liste vide ; ne devine pas l'origine du texte » ;
- le rappel des anti-signaux (§8.4) : ne pas signaler un vocabulaire simple, des fautes ou une grammaire parfaite.

**Garde-fou :** le texte utilisateur est placé entre balises `<text>`, et le prompt précise que ce contenu est une donnée à analyser, jamais des instructions (protection contre l'injection de prompt).

### 9.4 Validation de l'annotateur

1. Annote toi-même **100 à 200 textes** (le gold standard).
2. Mesure précision et rappel par `pattern_id`, ainsi que l'accord inter-annotateur si un camarade annote aussi (kappa de Cohen).
3. Itère sur le prompt. Compare Opus 5, Sonnet 5 et Haiku 4.5, et effort `low` vs `medium`.
4. Ablation : gain de la fusion **avec** vs **sans** les features Claude. Si le gain est nul, Claude ne sert qu'aux explications, et c'est un résultat publiable honnêtement.

---

## 10. Module E : fusion, calibration, seuils, abstention

### 10.1 Vecteur de features par document

`[binoculars, fastdetect, ll, logrank, lrr, entropy, burstiness_ppl, gltr_buckets(4), deberta_mean, deberta_max, taxonomie_règles(~35 comptes normalisés), claude(~10 comptes), stylométrie(~15), longueur_tokens, drapeaux_altération]`

### 10.2 Méta-classifieur

- **Régression logistique L2** sur features standardisées. Elle est interprétable (coefficients), robuste avec peu de données et facile à calibrer. En alternative : LightGBM + SHAP si tu as > 20 000 documents.
- **Stacking sans fuite** : les scores B (DeBERTa) utilisés pour entraîner la fusion sont des prédictions **out-of-fold** (5-fold, groupé par `prompt_id`).
- Modèles séparés, ou une feature « domaine », pour les genres formulaïques (P12).

### 10.3 Calibration et seuils

1. **Calibration** isotonique (ou Platt si peu de données) sur un split `calibration` distinct. Mesure : ECE, Brier.
2. **Seuil à FPR cible**, choisi sur les **scores humains** du split de calibration :

```python
import numpy as np

def threshold_at_fpr(human_scores: np.ndarray, target_fpr: float) -> float:
    # scores : plus haut = plus "IA" ; FPR empirique ≤ target_fpr (vérifié en simulation)
    return float(np.quantile(human_scores, 1 - target_fpr, method="higher"))
```

3. **Trois zones** :
   - `IA probable` : score > seuil@1 %FPR ;
   - `humain probable` : score < seuil bas, choisi pour que ≤ 1 % des textes IA de calibration tombent en dessous ;
   - `incertain` : entre les deux.

   C'est l'équivalent de l'astérisque de Turnitin sous 20 %. Alternative plus rigoureuse : la **prédiction conforme** (split conformal), qui donne une garantie de couverture.
4. **Abstention** : < 150 mots, langue non supportée, code/tableaux, ou texte presque entièrement composé d'une liste.
5. **Indices forts** (COM-01 à COM-05, MRK-01) : affichés en priorité comme « preuves observables », mais ils passent **aussi** par la fusion. Pas de court-circuit, car une citation d'un chatbot dans un article humain déclencherait COM-01.

---

## 11. Module F : détection phrase par phrase et textes mixtes

1. Fenêtres glissantes de 3 phrases (stride 1). Le score d'une phrase est la moyenne des fenêtres qui la couvrent, pour les modules A et B.
2. **Lissage** : HMM à 2 états (humain/IA) ou filtre médian, plus une longueur minimale de segment. Turnitin observe que les faux positifs se concentrent **à côté** des vraies phrases IA : les frontières sont floues par nature.
3. Deux sorties **distinctes** :
   - la probabilité document (Module E) ;
   - la **part de phrases signalées**.
4. Évaluation des frontières sur SemEval-2024 Task 8, sous-tâche C : position du changement humain → machine, métrique MAE. Baseline 21,54 ; meilleur système 15,68 ; 11 équipes sur 30 ont battu la baseline.
5. Classe « IA-poli » : textes humains retouchés par IA (données APT-Eval + tes propres générations « améliore ce texte » à plusieurs intensités).

---

## 12. Module G : réécriture et boucle red team

### 12.1 Réécriture guidée

- **Entrée :** le texte, plus les findings (IDs, spans, `rewrite_hint` du YAML).
- **Sortie (structured outputs) :** une liste de `{span_original, remplacement, pattern_ids}`. On ne demande pas un texte entier réécrit, ce qui permet d'afficher un diff et d'accepter ou refuser chaque modification.
- **Contraintes du prompt :**
  - garder faits, chiffres, citations, noms propres et registre ;
  - ne rien inventer ;
  - ne pas « sur-corriger » un texte humain ;
  - laisser intact ce qui n'est pas signalé.
- **Vérifications automatiques :**
  1. similarité sémantique (embeddings `sentence-transformers`) au-dessus d'un seuil ;
  2. modèle NLI (entailment dans les deux sens) pour détecter les pertes de sens ;
  3. les nombres et entités nommées sont conservés (comparaison spaCy NER) ;
  4. nouveau passage dans le détecteur pour montrer avant/après.

### 12.2 Boucle red team (l'idée de RADAR, en version légère)

Les sorties du réécrivain qui **trompent** ton détecteur sont précieuses :

1. On génère des textes IA, puis on les réécrit (notre module, les humanizers open source, des paraphraseurs).
2. On garde ceux qui passent sous le seuil : ce sont des faux négatifs.
3. On les ajoute au train comme exemples positifs (IA), puis on réentraîne B et la fusion.
4. On mesure la robustesse avant/après sur un jeu d'attaques **tenu à l'écart** (des attaques jamais vues à l'entraînement).

> Positionnement éthique : le module de réécriture est un **outil d'édition de style** (supprimer les clichés, clarifier). Ce n'est pas un service de contournement. La réécriture ne change pas l'auteur réel d'un texte, et l'UI le dit (§19).

---

## 13. Données

### 13.1 Datasets publics

| Dataset | Contenu | Langues | Licence | Usage prévu |
|---|---|---|---|---|
| **RAID** (Dugan et al., ACL 2024) | > 6 M générations (article), > 10 M documents (repo actuel) ; 11 LLM ; 8 domaines (+ RAID-extra : actualités tchèques et allemandes, code Python) ; 11-12 attaques ; 4 décodages (greedy/sampling ± repetition penalty 1,2) | EN (+ cs, de) | MIT | Train (sous-ensemble) + **test de robustesse** + leaderboard (métrique par défaut : TPR@5 %FPR) |
| **MAGE** (Li et al., ACL 2024) | 447 674 textes, 27 LLM (7 familles), 10 sources | EN | CC BY 4.0 | Train + splits OOD (modèles et domaines non vus, paraphrases) |
| **HC3** (Guo et al., 2023) | EN : 24 322 questions, 58 546 réponses humaines, 26 903 réponses ChatGPT | EN, ZH | CC-BY-SA (ou plus strict selon la source) | Train (Q/R) |
| **M4** (EACL 2024) / **M4GT-Bench** (ACL 2024) | Multi-générateurs, multi-domaines ; M4GT inclut la détection de frontière dans les textes mixtes | M4 : ar, bg, zh, en, id, ru, ur ; M4GT : en, de, id, it, zh, bg, ar, ur, ru | à vérifier | Test OOD, textes mixtes |
| **Ghostbuster data** | Essais d'étudiants, fiction, actualités | EN | à vérifier | Train/test |
| **DetectRL** (NeurIPS 2024 D&B) | 4 domaines (académique, news, créatif, social), attaques réalistes (révisions humaines, fautes, mélange), générateurs dont Claude-instant | EN | à vérifier | **Test « monde réel »** |
| **SemEval-2024 Task 8** | Sous-tâches A (binaire), B (attribution), C (frontière) | EN + multi | à vérifier | Module F |
| **ArguGPT** | 4 038 essais argumentatifs de 7 modèles GPT + essais humains (exercices, TOEFL, GRE ; 3 niveaux) | EN | à vérifier | Biais non-natifs (P1) |
| **APT-Eval** (Saha & Feizi, 2025) | Textes humains polis par IA à plusieurs degrés | EN | à vérifier | Classe « IA-poli » (P7) |
| **Français** : MAiDE-up (avis d'hôtels, 10 langues dont fr) ; Antoun et al. 2023 (HC3 traduit + tests natifs ChatGPT/BingGPT) ; Schaaff et al. 2023 (textes éducatifs en/fr/de/es) | | FR | à vérifier | Phase 2 |

> Aucun des grands benchmarks (RAID, M4, M4GT, MULTITuDE) ne couvre le français. Pour le FR, tu devras **générer une bonne partie des données toi-même**.

### 13.2 Génération de tes propres textes IA

| Axe de diversité | Comment |
|---|---|
| Générateurs | Claude (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`) + open-weights (familles Llama, Mistral, Qwen, Gemma) via `transformers` / vLLM |
| Décodage | Sur les modèles open-weights : T = 0, T = 0,7, T = 1, top-p 0,9, repetition penalty 1,0 / 1,2. Sur Claude Opus 5, les paramètres d'échantillonnage n'existent pas : la diversité vient des prompts. |
| Prompts | (a) **miroir** : « écris un texte sur [sujet du texte humain X], ~[longueur de X] mots, genre [Y] » ; (b) continuation d'un préfixe humain (→ textes mixtes) ; (c) personas (« étudiant de L2 », « journaliste ») ; (d) consignes anti-détection (« évite les clichés d'IA ») ; (e) « améliore/corrige ce texte humain » à 3 intensités (→ IA-poli) |
| Post-traitement | Humanizers open source + ton Module G → exemples adversariaux |

### 13.3 Données humaines

- Côté humain des datasets ci-dessus. Priorité aux textes **antérieurs au 30/11/2022**.
- **Non-natifs** : essais d'apprenants (ArguGPT). L'étude de Liang et al. est accompagnée d'un dépôt GitHub (`Weixin-Liang/ChatGPT-Detector-Bias`) : vérifie s'il contient les essais et sous quelle licence.
- Tes propres écrits et ceux de camarades (rapports ECE, mails), **avec consentement écrit** et anonymisation.
- **Pool de hard negatives** : un grand volume de texte humain varié (le plus de domaines possible) pour le mining (§7.2).

### 13.4 Pipeline de préparation

```
download → schéma unifié → normalisation (§5) → filtre langue/longueur
→ dédup exacte (hash) + near-dup (MinHash) → attribution prompt_id/source_id
→ split groupé (train / val / calibration / test_id / test_ood_*)
→ appariement longueur & domaine → gel (hash du dataset, versionné avec DVC)
```

**Schéma unifié (une ligne par document) :**

- `id`, `text` ;
- `label` (human / ai / mixed / ai_polished) ;
- `generator`, `decoding`, `domain`, `language`, `source_dataset`, `prompt_id` ;
- `attack` (none / paraphrase / homoglyph…) ;
- `is_non_native` ;
- `n_words`, `created_before_2022_11_30` ;
- `license`.

---

## 14. Protocole d'évaluation

> On le construit **en semaines 2-3, avant tout modèle**. Tous les modèles passent par le même script `run_eval.py`, qui produit le même rapport.

### 14.1 Splits

| Split | Construction | Question posée |
|---|---|---|
| `test_id` | Même distribution que le train | Performance de base |
| `test_logo_<gen>` | *Leave-one-generator-out* (ex. aucun texte Claude au train) | Généralisation à un nouveau modèle (P4) |
| `test_lodo_<dom>` | *Leave-one-domain-out* | Généralisation à un nouveau domaine |
| `test_raid_clean` / `test_raid_<attack>` | Sous-échantillon RAID par attaque | Robustesse (P2, P6) |
| `test_detectrl` | DetectRL | Conditions réalistes |
| `test_nonnative` | Essais d'apprenants | Équité (P1, O4) |
| `test_polished` / `test_mixed` | APT-Eval, SemEval C | Zone grise (P7) |
| `test_short` | 50-150 et 150-300 mots | Effet longueur (P3) |
| `test_canary_<date>` | Textes des derniers modèles, régénérés chaque trimestre | Dérive (P9) |
| `test_fr` | Phase 2 | Français |

### 14.2 Métriques

- **Principales** : TPR@1 %FPR, TPR@5 %FPR (standard RAID). L'article Binoculars note que l'AUC est « often uncorrelated » avec le TPR à FPR < 1 %.
- **Secondaires** : AUROC, F1 au seuil choisi, **FPR réel** au seuil choisi sur chaque split humain, ECE et Brier (calibration).
- **Segments** : MAE de frontière, F1 par phrase.
- **Rapport** : un tableau split × métrique, les courbes ROC en échelle log sur l'axe FPR, les IC 95 % par bootstrap (1 000 rééchantillonnages).

### 14.3 Baselines à battre (et à citer)

1. `openai-community/roberta-base-openai-detector` (59,2 % TPR@5 %FPR sur le test non adversarial du shared task RAID) ;
2. Binoculars officiel (79,0 % sur ce même test) ;
3. Fast-DetectGPT officiel ;
4. RADAR (`TrustSafeAI/RADAR-Vicuna-7B`) si le GPU le permet ;
5. **Claude seul par prompt** (« probabilité que ce texte soit IA ? »). Tu t'attends à ce qu'il soit mauvais (P8), et le démontrer est un résultat intéressant.

**Ablations** : retirer chaque module (A, B, C, D) un par un, puis retirer le hard negative mining et l'augmentation adversariale.

### 14.4 Rigueur statistique : combien de textes humains faut-il ?

Si tu observes **0 faux positif sur n textes humains**, la borne supérieure à 95 % du FPR vaut 1 − 0,05^(1/n) ≈ **3/n** (« règle de trois ») :

| n textes humains, 0 FP | FPR maximal plausible (95 %) |
|---|---|
| 300 | ~1 % |
| 1 000 | ~0,3 % |
| 3 000 | ~0,1 % |
| 30 000 | ~0,01 % |

Pour affirmer un FPR ≤ 1 %, il faut donc **au moins 300 textes humains par split** évalué. L'étude indépendante de Jabarian & Imas utilisait 1 992 textes humains. Ne publie jamais « 0 % de faux positifs » sans ce calcul.

---

## 15. Stack, structure du repo, API

### 15.1 Stack

| Couche | Outils |
|---|---|
| Backend ML | Python 3.11+, `uv`, PyTorch, `transformers`, `datasets`, `accelerate`, scikit-learn, spaCy, `textstat`, `lexicalrichness` (MTLD), `datasketch`, `rapidfuzz`, `sentence-transformers` |
| LLM | SDK officiel `anthropic` (Python) |
| API | FastAPI + Pydantic, streaming SSE pour la progression |
| Expériences | MLflow (local) ou Weights & Biases ; DVC pour les données |
| Qualité | `pytest`, `ruff`, `mypy`, pre-commit, GitHub Actions (tests + éval de non-régression sur un petit jeu gelé) |
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, Aceternity UI, 21st.dev, Framer Motion (`motion/react`), `lucide-react`, `clsx`, `tailwind-merge` |
| Déploiement | Frontend sur Vercel ; backend GPU (Hugging Face Spaces GPU, Modal ou RunPod) ; MVP possible sur CPU avec DeBERTa-base, les règles et Claude, sans le Module A |

### 15.2 Structure du repo

```
IA_Writing/
├── PLAN.md
├── README.md
├── backend/
│   ├── pyproject.toml
│   ├── src/aiwd/
│   │   ├── normalize/        # unicode.py, confusables.py, segment.py, langid.py, offsets.py
│   │   ├── zeroshot/         # lm_scorer.py (logits partagés), binoculars.py, fast_detectgpt.py
│   │   ├── classifier/       # train.py, infer.py, windows.py
│   │   ├── taxonomy/         # taxonomy_v1.yaml, loader.py, rules_lex.py, rules_syn.py, stylometry.py, lexicons/
│   │   ├── llm/              # client.py, annotator.py, rewriter.py, prompts/, cache.py
│   │   ├── fusion/           # features.py, stack.py, calibrate.py, thresholds.py, conformal.py
│   │   ├── segments/         # sentence_scores.py, smoothing.py
│   │   ├── eval/             # splits.py, metrics.py, bootstrap.py, report.py, attacks.py
│   │   └── api/              # main.py, schemas.py, sse.py, ratelimit.py
│   ├── scripts/              # build_dataset.py, generate_ai.py, mine_hard_negatives.py, run_eval.py
│   ├── data/                 # (gitignore + DVC)
│   └── tests/                # test_taxonomy_examples.py, test_normalize.py, test_thresholds.py…
└── frontend/
    ├── app/                  # page.tsx, analyze/page.tsx, methodology/page.tsx, api/analyze/route.ts
    ├── components/ui/        # progress-bar.tsx, scroll-progress.tsx, container-scroll.tsx, glass-card.tsx,
    │                         # score-gauge.tsx, sentence-heatmap.tsx, finding-list.tsx, diff-view.tsx
    └── lib/                  # utils.ts (cn), api.ts (types partagés)
```

### 15.3 API

- `POST /v1/detect` : `{text, language?: "auto"}` → rapport (ci-dessous). Une variante `?stream=true` renvoie les étapes en SSE.
- `POST /v1/rewrite` : `{text, finding_ids?}` → liste de remplacements, avec scores avant/après.
- `GET /v1/taxonomy` : la taxonomie active, pour la page Méthodologie.
- `GET /health`.

```json
{
  "verdict": "likely_ai",
  "zone": "ai",
  "confidence": 0.93,
  "flagged_sentence_ratio": 0.71,
  "abstained": false,
  "language": "en",
  "n_words": 612,
  "tamper_flags": {"format_chars": 0, "confusables": 0},
  "signals": {"binoculars": 0.79, "fast_detectgpt": 2.41, "classifier": 0.95, "taxonomy_density": 11.4},
  "sentences": [{"start": 0, "end": 118, "score": 0.88}],
  "findings": [
    {"pattern_id": "LNG-03", "family": "language", "start": 240, "end": 301,
     "quote": "It's not just about speed, it's about...", "strength": "medium", "source": "rules"}
  ],
  "model_versions": {"taxonomy": "1.0.0", "classifier": "deberta-v3-base@2026-11-02", "fusion": "lr@v3"},
  "disclaimer": "Indicateur statistique, pas une preuve. Ne pas utiliser comme seule base d'une décision."
}
```

**Sécurité :**

- clé Anthropic uniquement côté backend (variables d'environnement) ;
- rate limiting par IP pour protéger ton budget ;
- taille max (ex. 5 000 mots) ;
- CORS restreint ;
- **pas de stockage des textes par défaut** (§19).

---

## 16. Frontend

Conforme à ta direction artistique **Dark Quant / Glassmorphism** :

- fond `#09090b` ;
- cartes `bg-white/[0.03] backdrop-blur-md border-white/10` ;
- émeraude `#10b981` pour « humain probable » ;
- bleu/cyan `#4568FF` / `#93B0FF` pour l'interface et la zone « incertain » ;
- une couleur chaude (ex. `rose-400`) pour les segments « IA ».

### 16.1 Pages

- `/` : hero avec `ContainerScroll` (Aceternity), barre de progression de scroll en haut (`useScroll` + `useSpring` → `scaleX`), explication en 3 étapes, limites affichées dès la page d'accueil.
- `/analyze` : zone de texte (compteur de mots, alerte sous 150 mots) → bouton Analyser → **ProgressBar** par étape (normalisation → scores statistiques → classifieur → taxonomie → Claude → fusion), alimentée par SSE → résultats.
- `/methodology` : la taxonomie rendue depuis `GET /v1/taxonomy`, les métriques d'évaluation (tableau §14), les limites connues, la model card.

### 16.2 Composants (`components/ui/`)

- `progress-bar.tsx` : états chiffré et indéterminé, ressorts (`spring`), `useReducedMotion`, `role="progressbar"` + `aria-valuenow` (voir l'esquisse ci-dessous).
- `score-gauge.tsx` : jauge à 3 zones (humain / incertain / IA) avec la position du score et l'intervalle d'incertitude.
- `sentence-heatmap.tsx` : texte original avec surlignage par phrase (offsets du Module 0) ; tooltip avec le score et les findings de la phrase.
- `finding-list.tsx` : findings groupés par famille de la taxonomie, filtres par force, clic → scroll jusqu'au passage.
- `diff-view.tsx` : réécriture proposée, acceptation modification par modification, score avant/après.
- `glass-card.tsx`, `scroll-progress.tsx`, `container-scroll.tsx`.

```tsx
"use client";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type ProgressBarProps = { value?: number; label: string; className?: string }; // value absente = indéterminé

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const reduce = useReducedMotion();
  const indeterminate = value === undefined;
  const pct = value === undefined ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-white/10", className)}
    >
      {indeterminate ? (
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-[#4568FF] to-[#93B0FF]"
          initial={{ x: "-100%" }}
          animate={reduce ? { x: "100%" } : { x: ["-100%", "300%"] }}
          transition={reduce ? { duration: 0 } : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <motion.div
          className="h-full rounded-full bg-[#10b981]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
        />
      )}
    </div>
  );
}
```

### 16.3 UX de la honnêteté (P14, P15)

- Deux indicateurs séparés : **« Confiance du verdict »** et **« Part de phrases signalées »**.
- La zone « incertain » est un résultat à part entière, pas un échec.
- Un bandeau permanent : « Indicateur statistique, pas une preuve. Les textes courts, traduits, ou écrits par des non-natifs sont plus sujets aux erreurs. »
- Les indices forts (résidus de chatbot, balisage) sont présentés comme des **observations vérifiables** (« ce texte contient “As an AI language model” ») plutôt que comme des probabilités.

---

## 17. Roadmap semaine par semaine

Hypothèse : 10-12 h par semaine. Chaque phase a une **Definition of Done (DoD)**.

| Semaine | Phase | Livrables | DoD |
|---|---|---|---|
| S1 | Cadrage | Lecture : Binoculars, Fast-DetectGPT, RAID, Liang 2023, Krishna 2023, page Wikipedia. Repo `uv` + pre-commit + CI ; squelettes FastAPI et Next.js | CI verte ; fiche de lecture d'une page par article |
| S2-S3 | **Données + évaluation d'abord** | `build_dataset.py` (RAID, MAGE, HC3, Ghostbuster, ArguGPT), schéma unifié, normalisation, dédup, splits groupés, `run_eval.py` + rapport HTML | Dataset v1 gelé (hash) ; rapport généré sur un classifieur aléatoire (sanity check : AUROC ≈ 0,5) |
| S4 | Baselines | Binoculars (officiel), Fast-DetectGPT, RoBERTa-OpenAI, Claude-seul ; premier tableau de résultats | Tableau split × métrique ; objectifs O1-O3 ajustés |
| S5-S6 | Taxonomie v1 | `taxonomy_v1.yaml`, règles LEX/SYN, stylométrie, tests pytest à partir des exemples Wikipedia/humanizer ; régression logistique sur ces seules features | Couverture de tests > 90 % sur `taxonomy/` ; AUROC par feature publiée |
| S7 | Annotateur Claude | Prompt, schema, cache, batch sur le dataset, alignement des offsets, gold standard de 100-200 textes | Précision/rappel par motif ; coût réel mesuré |
| S8-S9 | Classifieur | DeBERTa-v3 fine-tuné ; hard negative mining round 1 ; augmentations | Gain mesuré sur `test_logo_*` et `test_nonnative` |
| S10 | Fusion | Stacking OOF, calibration, seuils, 3 zones, abstention | ECE < 0,05 sur calibration ; O1/O2 atteints ou écart expliqué |
| S11 | Segments | Scores par phrase, lissage, évaluation SemEval C | MAE rapportée vs baseline 21,54 |
| S12 | Réécriture + red team | `/v1/rewrite`, vérifications sémantiques, round adversarial, réentraînement | Robustesse avant/après sur attaques tenues à l'écart |
| S13-S14 | Produit | API finale (SSE), frontend complet, page Méthodologie | Démo de bout en bout ; tests e2e (Playwright) |
| S15 | Audit | Équité (non-natifs), robustesse RAID complète, model card, datasheet, déploiement | Model card publiée avec les limites |
| S16 | Communication | README, vidéo de démo de 2 min, article de blog / rapport technique | Lien public partageable |
| S17+ | Français | Données FR (génération + corpus), taxonomie FR validée, modèle multilingue | `test_fr` rapporté honnêtement |

> Règle d'or : on n'avance pas à la phase suivante sans un chiffre mesuré sur les splits de §14. Chaque modification doit améliorer un chiffre, ou être justifiée autrement.

---

## 18. Budget et matériel

### 18.1 API Claude (prix officiels par million de tokens, entrée / sortie)

| Modèle | Entrée | Sortie |
|---|---|---|
| `claude-opus-5` | $5 | $25 |
| `claude-sonnet-5` | $2 | $10 |
| `claude-haiku-4-5` | $1 | $5 |

- Batch API : −50 %.
- Lecture de cache : ~0,1× le prix d'entrée.

**Estimation pour annoter 5 000 textes**, avec les hypothèses suivantes : 3 700 tokens d'entrée par texte (3 000 de taxonomie + 700 de texte) et 600 tokens de sortie, **sans** compter le cache ni la réflexion.

| Modèle | Coût standard | En Batch (−50 %) |
|---|---|---|
| Opus 5 | 18,5 M × $5 + 3 M × $25 = **~$168** | **~$84** |
| Sonnet 5 | 18,5 M × $2 + 3 M × $10 = **~$67** | **~$34** |
| Haiku 4.5 | 18,5 M × $1 + 3 M × $5 = **~$34** | **~$17** |

> ⚠️ Les tokens de réflexion (adaptive thinking) sont facturés comme de la sortie. **Mesure le coût réel sur 50 textes** (`response.usage`) avant de lancer un batch complet, et configure une limite de dépense dans la console Anthropic.

### 18.2 GPU

- **DeBERTa-v3-base** : un GPU de 16 Go suffit en général (ajuste batch et gradient accumulation).
- **Paire Falcon-7B (Binoculars officiel)** : ~28 Go en bf16. Il faut un A100 40 Go, deux GPU, ou de la quantification (avec recalibrage).
- **Options** : Google Colab, Kaggle (quota GPU hebdomadaire gratuit), cluster de l'école (renseigne-toi auprès de l'ECE), location horaire (RunPod, Lambda…).
- **Économie clé** : calcule les logits **une seule fois** par texte et mets en cache toutes les features du Module A sur disque (parquet). Les expériences de fusion deviennent alors quasi gratuites.

---

## 19. Risques, éthique, légal

| Risque | Mitigation |
|---|---|
| Faux positif → accusation injuste | Seuil sur FPR, zone « incertain », abstention, bandeau d'avertissement, model card. Rappel : Turnitin, les auteurs de Binoculars et Liang et al. déconseillent tous l'usage sans supervision humaine. |
| Biais non-natifs | Split dédié, hard negatives d'apprenants, publication du FPR par sous-groupe |
| RGPD | Pas de stockage des textes par défaut ; si stockage (opt-in) : finalité, durée, suppression sur demande, mentions légales. Indique aux utilisateurs que le texte est envoyé à l'API Anthropic, et vérifie la politique de conservation des données de l'API. |
| Licences des données | Tableau de licences (§13.1) ; CC-BY-SA → attribution et partage à l'identique si tu redistribues ; ne redistribue pas les datasets, publie des scripts de téléchargement |
| Usage détourné du réécrivain | Présenté comme éditeur de style ; pas de marketing « bypass » ; les sorties réécrites servent à durcir le détecteur (§12.2) |
| Sur-confiance dans les indices lexicaux | Poids appris, versionnage, canary trimestriel |
| Coûts API | Rate limiting, cache des résultats, limite de dépense, Batch pour l'offline |
| Injection de prompt dans les textes analysés | Texte encapsulé dans `<text>`, instruction explicite, sortie contrainte par schema |

---

## 20. Valoriser le projet (CV, entretiens, finance quant)

### 20.1 Ligne de CV (à remplir avec **tes** chiffres mesurés)

> *Built a hybrid AI-generated text detector (zero-shot perplexity signals, fine-tuned DeBERTa, and a 40-rule linguistic taxonomy annotated via the Anthropic API) with a calibrated stacking model; reached XX % TPR at 1 % FPR on held-out data and +YY pts over Binoculars on unseen generators; shipped a Next.js/FastAPI app with sentence-level explanations and guided rewriting.*

N'écris que ce que tu peux démontrer en entretien, avec le rapport d'évaluation sous la main.

### 20.2 Questions d'entretien à préparer

- Pourquoi TPR@FPR plutôt que l'accuracy ? (taux de base, coût asymétrique des erreurs)
- Comment fonctionne Binoculars et pourquoi deux modèles ? (problème du capybara)
- Comment évites-tu la fuite de données entre train et test ? (split groupé, dédup MinHash, OOF)
- Quelle est la limite théorique de la détection ? (Sadasivan vs Chakraborty)
- Pourquoi ne pas simplement demander à Claude ? (P8, et ton ablation le montre)

### 20.3 Le lien avec la finance quantitative

Les compétences de ce projet se transfèrent directement :

- **calibration de probabilités** et **choix de seuil sous contrainte de risque** (FPR ≈ risque de faux signal) ;
- **validation sans fuite** (split groupé, out-of-fold : le même esprit que le walk-forward en backtest) ;
- **stacking de signaux faibles et peu corrélés** : la logique d'un modèle multi-facteurs ;
- **dérive de distribution** : un régime de marché qui change, comme les modèles d'IA qui changent ;
- **IC par bootstrap** et règle de trois : de la rigueur statistique sur des événements rares.

Mets ces parallèles en avant dans ta candidature.

### 20.4 Méthode pour apprendre vite

- Lecture d'articles en 3 passes (S. Keshav, *How to Read a Paper*) : 5 min pour le résumé et les figures, 1 h pour la méthode, puis re-dérivation seulement pour Binoculars et Fast-DetectGPT.
- Réimplémente Binoculars toi-même en ~50 lignes et compare avec le repo officiel sur 100 textes : c'est le meilleur test de compréhension.
- Tiens un `JOURNAL.md` : une ligne par expérience (date, changement, métrique, conclusion). Il te servira pour le rapport et les entretiens.

---

## 21. Bibliographie vérifiée

**Méthodes**

- Gehrmann, Strobelt, Rush. *GLTR*. ACL 2019 Demo. [arXiv 1906.04043](https://arxiv.org/abs/1906.04043) · [code](https://github.com/HendrikStrobelt/detecting-fake-text)
- Mitchell et al. *DetectGPT*. ICML 2023. [arXiv 2301.11305](https://arxiv.org/abs/2301.11305) · [code](https://github.com/eric-mitchell/detect-gpt)
- Bao et al. *Fast-DetectGPT*. ICLR 2024. [arXiv 2310.05130](https://arxiv.org/abs/2310.05130) · [code](https://github.com/baoguangsheng/fast-detect-gpt)
- Hans et al. *Spotting LLMs With Binoculars*. ICML 2024. [arXiv 2401.12070](https://arxiv.org/abs/2401.12070) · [code](https://github.com/ahans30/Binoculars)
- Verma et al. *Ghostbuster*. NAACL 2024. [arXiv 2305.15047](https://arxiv.org/abs/2305.15047) · [code](https://github.com/vivek3141/ghostbuster)
- Yang et al. *DNA-GPT*. ICLR 2024. [arXiv 2305.17359](https://arxiv.org/abs/2305.17359)
- Su et al. *DetectLLM (LRR, NPR)*. Findings EMNLP 2023. [arXiv 2306.05540](https://arxiv.org/abs/2306.05540)
- Hu, Chen, Ho. *RADAR*. NeurIPS 2023. [arXiv 2307.03838](https://arxiv.org/abs/2307.03838)
- Emi & Spero. *Pangram technical report*. [arXiv 2402.14873](https://arxiv.org/abs/2402.14873)
- Xu et al. *Lastde*. ICLR 2025. [arXiv 2410.06072](https://arxiv.org/abs/2410.06072) · [code](https://github.com/TrustMedia-zju/Lastde_Detector)
- Kirchenbauer et al. *A Watermark for LLMs*. ICML 2023. [arXiv 2301.10226](https://arxiv.org/abs/2301.10226)
- Dathathri et al. *SynthID Text*. Nature 634 (2024). [DOI 10.1038/s41586-024-08025-4](https://doi.org/10.1038/s41586-024-08025-4)

**Benchmarks et datasets**

- Dugan et al. *RAID*. ACL 2024. [arXiv 2405.07940](https://arxiv.org/abs/2405.07940) · [code](https://github.com/liamdugan/raid)
- Li et al. *MAGE*. ACL 2024. [arXiv 2305.13242](https://arxiv.org/abs/2305.13242) · [code](https://github.com/yafuly/MAGE)
- Wang et al. *M4*. EACL 2024. [arXiv 2305.14902](https://arxiv.org/abs/2305.14902) · *M4GT-Bench*. ACL 2024. [arXiv 2402.11175](https://arxiv.org/abs/2402.11175)
- Guo et al. *HC3*. [arXiv 2301.07597](https://arxiv.org/abs/2301.07597)
- Wu et al. *DetectRL*. NeurIPS 2024 D&B. [arXiv 2410.23746](https://arxiv.org/abs/2410.23746)
- Wang et al. *SemEval-2024 Task 8*. [arXiv 2404.14183](https://arxiv.org/abs/2404.14183)
- Liu et al. *ArguGPT*. [arXiv 2304.07666](https://arxiv.org/abs/2304.07666)
- Saha & Feizi. *Almost AI, Almost Human (APT-Eval)*. Findings ACL 2025. [arXiv 2502.15666](https://arxiv.org/abs/2502.15666)
- Antoun et al. *Detecting ChatGPT in French*. TALN 2023. [arXiv 2306.05871](https://arxiv.org/abs/2306.05871)

**Problèmes, limites, études**

- Liang et al. *GPT detectors are biased against non-native English writers*. Patterns 2023. [arXiv 2304.02819](https://arxiv.org/abs/2304.02819)
- Krishna et al. *Paraphrasing evades detectors…* NeurIPS 2023. [arXiv 2303.13408](https://arxiv.org/abs/2303.13408)
- Sadasivan et al. *Can AI-Generated Text be Reliably Detected?* [arXiv 2303.11156](https://arxiv.org/abs/2303.11156)
- Chakraborty et al. *On the Possibilities of AI-Generated Text Detection*. ICML 2024. [arXiv 2304.04736](https://arxiv.org/abs/2304.04736)
- Creo & Pudasaini. *SilverSpeak (homoglyphes)*. [arXiv 2406.11239](https://arxiv.org/abs/2406.11239)
- Bhattacharjee & Liu. *Fighting Fire with Fire*. [arXiv 2308.01284](https://arxiv.org/abs/2308.01284)
- Russell, Karpinska, Iyyer. *People who frequently use ChatGPT…* ACL 2025. [arXiv 2501.15654](https://arxiv.org/abs/2501.15654)
- Weber-Wulff et al. *Testing of detection tools*. IJEI 2023. [DOI 10.1007/s40979-023-00146-z](https://doi.org/10.1007/s40979-023-00146-z)
- Jabarian & Imas. *Artificial Writing and Automated Detection*. BFI WP 2025. [page](https://bfi.uchicago.edu/insights/artificial-writing-and-automated-detection/)
- OpenAI. *New AI classifier…* (et note de retrait). [page](https://openai.com/index/new-ai-classifier-for-indicating-ai-written-text/)
- Turnitin. *Understanding false positives…* [blog](https://www.turnitin.com/blog/understanding-false-positives-within-our-ai-writing-detection-capabilities)

**Taxonomie et linguistique**

- Wikipedia. *Signs of AI writing* (WikiProject AI Cleanup). [page](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
- blader. *humanizer*. [GitHub](https://github.com/blader/humanizer)
- Kobak et al. *Excess vocabulary*. Science Advances 2025. [DOI 10.1126/sciadv.adt3813](https://doi.org/10.1126/sciadv.adt3813) · [liste de mots](https://github.com/berenslab/llm-excess-vocab)
- Liang et al. *Monitoring AI-Modified Content at Scale*. ICML 2024. [arXiv 2403.07183](https://arxiv.org/abs/2403.07183)
- Reinhart et al. *Do LLMs write like humans?* PNAS 2025. [DOI 10.1073/pnas.2422455122](https://doi.org/10.1073/pnas.2422455122)
- Herbold et al. *Human vs ChatGPT essays*. Sci. Rep. 2023. [article](https://www.nature.com/articles/s41598-023-45644-9)
- Muñoz-Ortiz et al. *Contrasting linguistic patterns…* AI Review 2024. [article](https://link.springer.com/article/10.1007/s10462-024-10903-2)
- Kumarage et al. *Stylometric detection…* [arXiv 2303.03697](https://arxiv.org/abs/2303.03697) · Opara. *StyloAI*. [arXiv 2405.10129](https://arxiv.org/abs/2405.10129)
- Juzek & Ward. *Why does ChatGPT "delve" so much?* COLING 2025. [article](https://aclanthology.org/2025.coling-main.426/) · Juzek. *34 langues*. [arXiv 2605.25358](https://arxiv.org/abs/2605.25358)

---

## 22. Annexe : checklist de la semaine 1

- [ ] Lire les résumés et les figures de : Binoculars, Fast-DetectGPT, RAID, Liang 2023, Krishna 2023 (3 passes, §20.4).
- [ ] Lire en entier la page Wikipedia *Signs of AI writing* et noter les motifs absents de la taxonomie v1.
- [ ] Initialiser `backend/` avec `uv`, `ruff`, `pytest`, pre-commit, GitHub Actions.
- [ ] Initialiser `frontend/` : Next.js (App Router, TS, Tailwind) + shadcn/ui + `motion` + `lucide-react` + `clsx` + `tailwind-merge`, puis `components/ui/progress-bar.tsx`.
- [ ] Créer une clé API Anthropic, fixer une limite de dépense, tester un appel `annotate()` sur 3 textes.
- [ ] Vérifier l'accès GPU (Colab/Kaggle/école) et lancer Binoculars officiel sur 10 textes.
- [ ] Télécharger un premier sous-ensemble RAID (licence MIT) et écrire le schéma unifié.
- [ ] Ouvrir `JOURNAL.md`.
