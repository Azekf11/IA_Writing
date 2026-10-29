# Evaluation: binoculars-qwen2.5-1.5b

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 3553 AI).

Test split: the detector could not score 0 human and 1 AI texts; they count as not flagged (and rank lowest in the AUROC).

AI texts: a deterministic 25% sample of the test split (proportions of domains and generators kept); all human texts are scored.

AUROC: **0.781** (95% CI 0.766-0.796)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 42.4 | 0.2 | 1.1 |
| 5% | 62.6 | 3.3 | 5.1 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 446 | 0.836 | 57.8 | 0.0 | 5.1 | 74.4 | 1.8 | 8.1 |
| books † | 56 | 490 | 0.787 | 32.9 | 0.0 | 5.2 | 58.6 | 0.0 | 5.2 |
| news † | 50 | 437 | 0.782 | 48.3 | 0.0 | 5.8 | 65.7 | 4.0 | 12.1 |
| poetry † | 45 | 371 | 0.767 | 30.2 | 0.0 | 6.4 | 53.9 | 0.0 | 6.4 |
| recipes † | 55 | 441 | 0.662 | 34.5 | 1.8 | 8.3 | 52.8 | 9.1 | 18.2 |
| reddit † | 49 | 440 | 0.806 | 41.8 | 0.0 | 5.9 | 62.7 | 4.1 | 12.3 |
| reviews † | 60 | 521 | 0.804 | 48.0 | 0.0 | 4.9 | 67.6 | 5.0 | 12.4 |
| wiki † | 50 | 407 | 0.814 | 44.0 | 0.0 | 5.8 | 63.1 | 2.0 | 9.1 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 215 | 0.912 | 38.6 | 0.2 | 1.1 | 65.1 | 3.3 | 5.1 |
| cohere | 422 | 198 | 0.961 | 51.5 | 0.2 | 1.1 | 83.8 | 3.3 | 5.1 |
| cohere-chat | 422 | 209 | 0.917 | 46.9 | 0.2 | 1.1 | 77.0 | 3.3 | 5.1 |
| gpt2 | 422 | 397 | 0.782 | 46.9 | 0.2 | 1.1 | 66.0 | 3.3 | 5.1 |
| gpt3 | 422 | 175 | 0.985 | 88.0 | 0.2 | 1.1 | 93.7 | 3.3 | 5.1 |
| gpt4 | 422 | 211 | 0.757 | 22.7 | 0.2 | 1.1 | 47.9 | 3.3 | 5.1 |
| llama-chat | 422 | 435 | 0.830 | 34.7 | 0.2 | 1.1 | 60.9 | 3.3 | 5.1 |
| mistral | 422 | 454 | 0.729 | 40.3 | 0.2 | 1.1 | 60.1 | 3.3 | 5.1 |
| mistral-chat | 422 | 428 | 0.836 | 47.7 | 0.2 | 1.1 | 67.5 | 3.3 | 5.1 |
| mpt | 422 | 418 | 0.512 | 28.2 | 0.2 | 1.1 | 39.2 | 3.3 | 5.1 |
| mpt-chat | 422 | 413 | 0.705 | 43.6 | 0.2 | 1.1 | 57.9 | 3.3 | 5.1 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 1159 | 0.981 | 77.5 | 0.2 | 1.1 | 93.4 | 3.3 | 5.1 |
| greedy\|rep_penalty=yes | 422 | 628 | 0.738 | 34.6 | 0.2 | 1.1 | 56.2 | 3.3 | 5.1 |
| sampling\|rep_penalty=no | 422 | 1146 | 0.888 | 32.5 | 0.2 | 1.1 | 64.5 | 3.3 | 5.1 |
| sampling\|rep_penalty=yes | 422 | 620 | 0.254 | 3.1 | 0.2 | 1.1 | 8.1 | 3.3 | 5.1 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 933 | 0.750 | 49.2 | 0.0 | 6.6 | 64.5 | 6.8 | 16.7 |
| 150-299 † | 278 | 1410 | 0.785 | 41.3 | 0.4 | 1.7 | 62.4 | 3.2 | 5.6 |
| 300-599 † | 67 | 1210 | 0.784 | 38.5 | 0.0 | 4.4 | 61.3 | 3.0 | 9.1 |
| >=600 † | 33 | 0 | - | - | 0.0 | 8.7 | - | 0.0 | 8.7 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
