# Evaluation: random

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 14383 AI).

AUROC: **0.500** (95% CI 0.471-0.528)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 0.5 | 0.0 | 0.7 |
| 5% | 3.3 | 2.4 | 4.0 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 1938 | 0.494 | 0.6 | 0.0 | 5.1 | 4.0 | 3.5 | 10.6 |
| books † | 56 | 1903 | 0.549 | 0.8 | 0.0 | 5.2 | 3.8 | 0.0 | 5.2 |
| news † | 50 | 1719 | 0.456 | 0.4 | 0.0 | 5.8 | 3.1 | 2.0 | 9.1 |
| poetry † | 45 | 1549 | 0.455 | 0.3 | 0.0 | 6.4 | 3.3 | 0.0 | 6.4 |
| recipes † | 55 | 1870 | 0.513 | 0.6 | 0.0 | 5.3 | 3.8 | 3.6 | 11.0 |
| reddit † | 49 | 1664 | 0.564 | 0.5 | 0.0 | 5.9 | 2.7 | 2.0 | 9.3 |
| reviews † | 60 | 2040 | 0.476 | 0.3 | 0.0 | 4.9 | 2.8 | 3.3 | 10.1 |
| wiki † | 50 | 1700 | 0.486 | 0.3 | 0.0 | 5.8 | 2.6 | 4.0 | 12.1 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 848 | 0.493 | 0.1 | 0.0 | 0.7 | 2.4 | 2.4 | 4.0 |
| cohere | 422 | 846 | 0.491 | 0.6 | 0.0 | 0.7 | 3.3 | 2.4 | 4.0 |
| cohere-chat | 422 | 846 | 0.513 | 0.6 | 0.0 | 0.7 | 3.8 | 2.4 | 4.0 |
| gpt2 | 422 | 1690 | 0.503 | 0.4 | 0.0 | 0.7 | 3.7 | 2.4 | 4.0 |
| gpt3 | 422 | 846 | 0.491 | 0.6 | 0.0 | 0.7 | 2.6 | 2.4 | 4.0 |
| gpt4 | 422 | 847 | 0.513 | 0.7 | 0.0 | 0.7 | 3.8 | 2.4 | 4.0 |
| llama-chat | 422 | 1692 | 0.506 | 0.7 | 0.0 | 0.7 | 3.1 | 2.4 | 4.0 |
| mistral | 422 | 1692 | 0.497 | 0.5 | 0.0 | 0.7 | 3.7 | 2.4 | 4.0 |
| mistral-chat | 422 | 1692 | 0.511 | 0.4 | 0.0 | 0.7 | 3.8 | 2.4 | 4.0 |
| mpt | 422 | 1692 | 0.491 | 0.4 | 0.0 | 0.7 | 2.7 | 2.4 | 4.0 |
| mpt-chat | 422 | 1692 | 0.494 | 0.5 | 0.0 | 0.7 | 3.2 | 2.4 | 4.0 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 4644 | 0.503 | 0.5 | 0.0 | 0.7 | 3.5 | 2.4 | 4.0 |
| greedy\|rep_penalty=yes | 422 | 2532 | 0.499 | 0.6 | 0.0 | 0.7 | 3.4 | 2.4 | 4.0 |
| sampling\|rep_penalty=no | 422 | 4663 | 0.498 | 0.5 | 0.0 | 0.7 | 3.3 | 2.4 | 4.0 |
| sampling\|rep_penalty=yes | 422 | 2544 | 0.499 | 0.4 | 0.0 | 0.7 | 2.8 | 2.4 | 4.0 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 3960 | 0.523 | 0.3 | 0.0 | 6.6 | 3.3 | 2.3 | 10.3 |
| 150-299 † | 278 | 5678 | 0.493 | 0.5 | 0.0 | 1.1 | 3.4 | 2.5 | 4.7 |
| 300-599 † | 67 | 4745 | 0.533 | 0.6 | 0.0 | 4.4 | 3.2 | 1.5 | 6.9 |
| >=600 † | 33 | 0 | - | - | 0.0 | 8.7 | - | 3.0 | 13.6 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
