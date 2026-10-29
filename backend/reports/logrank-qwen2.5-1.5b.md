# Evaluation: logrank-qwen2.5-1.5b

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 3553 AI).

Test split: the detector could not score 0 human and 1 AI texts; they count as not flagged (and rank lowest in the AUROC).

AI texts: a deterministic 25% sample of the test split (proportions of domains and generators kept); all human texts are scored.

AUROC: **0.784** (95% CI 0.769-0.799)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 28.4 | 0.2 | 1.1 |
| 5% | 50.2 | 6.9 | 9.3 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 446 | 0.769 | 24.0 | 0.0 | 5.1 | 48.4 | 1.8 | 8.1 |
| books † | 56 | 490 | 0.875 | 18.8 | 0.0 | 5.2 | 48.0 | 0.0 | 5.2 |
| news † | 50 | 437 | 0.792 | 22.7 | 0.0 | 5.8 | 51.3 | 0.0 | 5.8 |
| poetry † | 45 | 371 | 0.878 | 11.6 | 0.0 | 6.4 | 18.6 | 0.0 | 6.4 |
| recipes † | 55 | 441 | 0.762 | 69.8 | 1.8 | 8.3 | 74.4 | 45.5 | 57.4 |
| reddit † | 49 | 440 | 0.847 | 19.5 | 0.0 | 5.9 | 43.2 | 2.0 | 9.3 |
| reviews † | 60 | 521 | 0.889 | 24.2 | 0.0 | 4.9 | 51.8 | 0.0 | 4.9 |
| wiki † | 50 | 407 | 0.758 | 36.1 | 0.0 | 5.8 | 62.2 | 4.0 | 12.1 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 215 | 0.952 | 36.7 | 0.2 | 1.1 | 79.1 | 6.9 | 9.3 |
| cohere | 422 | 198 | 0.765 | 14.6 | 0.2 | 1.1 | 24.7 | 6.9 | 9.3 |
| cohere-chat | 422 | 209 | 0.836 | 23.0 | 0.2 | 1.1 | 44.0 | 6.9 | 9.3 |
| gpt2 | 422 | 397 | 0.700 | 29.2 | 0.2 | 1.1 | 42.8 | 6.9 | 9.3 |
| gpt3 | 422 | 175 | 0.915 | 23.4 | 0.2 | 1.1 | 66.9 | 6.9 | 9.3 |
| gpt4 | 422 | 211 | 0.822 | 25.6 | 0.2 | 1.1 | 51.2 | 6.9 | 9.3 |
| llama-chat | 422 | 435 | 0.947 | 40.7 | 0.2 | 1.1 | 80.2 | 6.9 | 9.3 |
| mistral | 422 | 454 | 0.698 | 28.4 | 0.2 | 1.1 | 35.0 | 6.9 | 9.3 |
| mistral-chat | 422 | 428 | 0.920 | 38.8 | 0.2 | 1.1 | 68.2 | 6.9 | 9.3 |
| mpt | 422 | 418 | 0.514 | 25.1 | 0.2 | 1.1 | 26.6 | 6.9 | 9.3 |
| mpt-chat | 422 | 413 | 0.738 | 15.5 | 0.2 | 1.1 | 40.7 | 6.9 | 9.3 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 1159 | 0.955 | 58.0 | 0.2 | 1.1 | 81.0 | 6.9 | 9.3 |
| greedy\|rep_penalty=yes | 422 | 628 | 0.793 | 19.1 | 0.2 | 1.1 | 50.3 | 6.9 | 9.3 |
| sampling\|rep_penalty=no | 422 | 1146 | 0.803 | 16.4 | 0.2 | 1.1 | 39.0 | 6.9 | 9.3 |
| sampling\|rep_penalty=yes | 422 | 620 | 0.419 | 4.5 | 0.2 | 1.1 | 13.4 | 6.9 | 9.3 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 933 | 0.769 | 10.0 | 0.0 | 6.6 | 33.2 | 4.5 | 13.6 |
| 150-299 † | 278 | 1410 | 0.809 | 32.5 | 0.0 | 1.1 | 57.7 | 7.2 | 10.3 |
| 300-599 † | 67 | 1210 | 0.775 | 37.8 | 1.5 | 6.9 | 54.7 | 9.0 | 16.9 |
| >=600 † | 33 | 0 | - | - | 0.0 | 8.7 | - | 3.0 | 13.6 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
