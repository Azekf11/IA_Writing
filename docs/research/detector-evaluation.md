# Detector research note

Before it was an editor, this project set out to detect machine-written text. This note records what
was tried, what was measured and why the product changed direction. The code and the full reports are
no longer in the working tree. They remain in the Git history at commit `07c8ebd`, under `backend/`:

```bash
git show 07c8ebd:backend/reports/binoculars-qwen2.5-1.5b.md
```

The research plan, in French, is in the same commit:

```bash
git show 07c8ebd:docs/research/detector-plan.fr.md
```

## Hypothesis

A small open language model could tell human from machine text well enough to support a product,
using zero-shot statistics: how predictable a text is to a model, without training a classifier.

## Method

- **Data.** A sample built from [RAID](https://github.com/liamdugan/raid) (`train_none.csv`). Each human
  text is grouped with the machine texts generated from it, and a group never crosses splits. The test
  split holds 422 human texts and 14,383 machine texts; a calibration split holds 373 human texts.
- **Protocol.** The decision threshold is fixed on the human texts of the calibration split with a
  split-conformal rule, then applied unchanged to the test split. Confidence intervals come from a
  bootstrap by group.
- **Detectors.** Four criteria computed with Qwen2.5-1.5B (base and instruct models): log-likelihood,
  log-rank, Fast-DetectGPT (Bao et al.) and Binoculars (Hans et al.). Two sanity baselines: a random
  score and text length. RAID is by Dugan et al.
- **Sample size.** The four model-based detectors were scored on a deterministic 25 % sample of the
  machine texts (3,553); the two baselines on all of them.

## Results

The false-positive rate is set on the calibration split, so the rate measured on the test split can
differ from the target. It is shown in brackets.

| Detector       | AUROC (95 % CI)     | Detected at 1 % target (test FPR) | Detected at 5 % target (test FPR) |
| -------------- | ------------------- | --------------------------------- | --------------------------------- |
| Random score   | 0.500 (0.471-0.528) | 0.5 % (0.0 %)                     | 3.3 % (2.4 %)                     |
| Text length    | 0.465 (0.440-0.490) | 0.0 % (0.5 %)                     | 0.0 % (5.7 %)                     |
| Log-likelihood | 0.770 (0.756-0.785) | 28.5 % (0.0 %)                    | 50.6 % (6.9 %)                    |
| Log-rank       | 0.784 (0.769-0.799) | 28.4 % (0.2 %)                    | 50.2 % (6.9 %)                    |
| Fast-DetectGPT | 0.782 (0.766-0.798) | 50.8 % (1.2 %)                    | 61.3 % (4.5 %)                    |
| Binoculars     | 0.781 (0.766-0.796) | 42.4 % (0.2 %)                    | 62.6 % (3.3 %)                    |

Quality varied a lot within a single detector. Binoculars reached an AUROC of 0.985 on GPT-3 outputs,
0.757 on GPT-4 and 0.512 on MPT; 0.662 on recipes and 0.836 on abstracts.

## Limits of these results

- They are not reproducible from this repository as it stands. The code is at `07c8ebd`, but the
  dataset is downloaded separately, its content hash was not recorded in a tracked file, and the model
  revisions were not pinned.
- The random and length reports were produced by an earlier version of the report code than the four
  model-based ones.
- Only one small model pair was evaluated, on one benchmark. These numbers say nothing about larger
  detectors or commercial services.
- Several slices (per domain, per length) hold fewer than 300 human texts, so their error rates are
  loosely bounded.

## Why the project moved on

At a false-alarm rate near 1 %, the best of these detectors missed about half of the machine texts,
and its behaviour depended heavily on the generator and the domain. A product built on that would
either accuse human writers or miss most cases, and it could not promise anything measurable.

The product therefore works on the other side of the problem: it points out wording habits and lets
the author decide. It does not try to beat any detector and was not tuned against one. Whether its
edits change a detector's verdict has not been measured.
