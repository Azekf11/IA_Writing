# Evaluation: loglik-qwen2.5-1.5b

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 3553 AI).

Test split: the detector could not score 0 human and 1 AI texts; they count as not flagged (and rank lowest in the AUROC).

AI texts: a deterministic 25% sample of the test split (proportions of domains and generators kept); all human texts are scored.

AUROC: **0.770** (95% CI 0.756-0.785)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 28.5 | 0.0 | 0.7 |
| 5% | 50.6 | 6.9 | 9.3 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 446 | 0.750 | 23.5 | 0.0 | 5.1 | 48.4 | 1.8 | 8.1 |
| books † | 56 | 490 | 0.855 | 19.6 | 0.0 | 5.2 | 50.2 | 0.0 | 5.2 |
| news † | 50 | 437 | 0.781 | 22.0 | 0.0 | 5.8 | 51.7 | 0.0 | 5.8 |
| poetry † | 45 | 371 | 0.864 | 11.3 | 0.0 | 6.4 | 18.9 | 0.0 | 6.4 |
| recipes † | 55 | 441 | 0.760 | 69.2 | 0.0 | 5.3 | 74.1 | 45.5 | 57.4 |
| reddit † | 49 | 440 | 0.840 | 18.6 | 0.0 | 5.9 | 42.0 | 2.0 | 9.3 |
| reviews † | 60 | 521 | 0.875 | 24.2 | 0.0 | 4.9 | 52.2 | 0.0 | 4.9 |
| wiki † | 50 | 407 | 0.746 | 39.3 | 0.0 | 5.8 | 62.9 | 4.0 | 12.1 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 215 | 0.956 | 37.7 | 0.0 | 0.7 | 82.3 | 6.9 | 9.3 |
| cohere | 422 | 198 | 0.767 | 15.2 | 0.0 | 0.7 | 24.7 | 6.9 | 9.3 |
| cohere-chat | 422 | 209 | 0.838 | 22.5 | 0.0 | 0.7 | 45.5 | 6.9 | 9.3 |
| gpt2 | 422 | 397 | 0.673 | 28.7 | 0.0 | 0.7 | 40.1 | 6.9 | 9.3 |
| gpt3 | 422 | 175 | 0.911 | 22.3 | 0.0 | 0.7 | 64.0 | 6.9 | 9.3 |
| gpt4 | 422 | 211 | 0.826 | 26.1 | 0.0 | 0.7 | 51.2 | 6.9 | 9.3 |
| llama-chat | 422 | 435 | 0.947 | 41.4 | 0.0 | 0.7 | 81.4 | 6.9 | 9.3 |
| mistral | 422 | 454 | 0.674 | 27.5 | 0.0 | 0.7 | 34.4 | 6.9 | 9.3 |
| mistral-chat | 422 | 428 | 0.914 | 39.7 | 0.0 | 0.7 | 68.7 | 6.9 | 9.3 |
| mpt | 422 | 418 | 0.470 | 25.1 | 0.0 | 0.7 | 26.8 | 6.9 | 9.3 |
| mpt-chat | 422 | 413 | 0.724 | 16.0 | 0.0 | 0.7 | 44.1 | 6.9 | 9.3 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 1159 | 0.955 | 58.4 | 0.0 | 0.7 | 81.3 | 6.9 | 9.3 |
| greedy\|rep_penalty=yes | 422 | 628 | 0.757 | 18.5 | 0.0 | 0.7 | 48.2 | 6.9 | 9.3 |
| sampling\|rep_penalty=no | 422 | 1146 | 0.796 | 16.8 | 0.0 | 0.7 | 40.5 | 6.9 | 9.3 |
| sampling\|rep_penalty=yes | 422 | 620 | 0.392 | 4.2 | 0.0 | 0.7 | 14.4 | 6.9 | 9.3 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 933 | 0.749 | 9.3 | 0.0 | 6.6 | 33.4 | 4.5 | 13.6 |
| 150-299 † | 278 | 1410 | 0.799 | 32.6 | 0.0 | 1.1 | 58.2 | 7.2 | 10.3 |
| 300-599 † | 67 | 1210 | 0.765 | 38.5 | 0.0 | 4.4 | 55.0 | 9.0 | 16.9 |
| >=600 † | 33 | 0 | - | - | 0.0 | 8.7 | - | 3.0 | 13.6 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
