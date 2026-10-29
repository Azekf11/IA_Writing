# Evaluation: length

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 14383 AI).

AUROC: **0.465** (95% CI 0.440-0.490)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 0.0 | 0.5 | 1.5 |
| 5% | 0.0 | 5.7 | 7.9 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 1938 | 0.415 | 0.0 | 0.0 | 5.1 | 0.0 | 0.0 | 5.1 |
| books † | 56 | 1903 | 0.422 | 0.0 | 3.6 | 10.8 | 0.0 | 14.3 | 24.3 |
| news † | 50 | 1719 | 0.345 | 0.0 | 0.0 | 5.8 | 0.0 | 8.0 | 17.4 |
| poetry † | 45 | 1549 | 0.302 | 0.0 | 0.0 | 6.4 | 0.0 | 2.2 | 10.1 |
| recipes † | 55 | 1870 | 0.344 | 0.0 | 0.0 | 5.3 | 0.0 | 1.8 | 8.3 |
| reddit † | 49 | 1664 | 0.562 | 0.0 | 0.0 | 5.9 | 0.0 | 0.0 | 5.9 |
| reviews † | 60 | 2040 | 0.384 | 0.0 | 0.0 | 4.9 | 0.0 | 16.7 | 26.6 |
| wiki † | 50 | 1700 | 0.786 | 0.0 | 0.0 | 5.8 | 0.0 | 0.0 | 5.8 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 848 | 0.544 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| cohere | 422 | 846 | 0.430 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| cohere-chat | 422 | 846 | 0.310 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| gpt2 | 422 | 1690 | 0.602 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| gpt3 | 422 | 846 | 0.146 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| gpt4 | 422 | 847 | 0.599 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| llama-chat | 422 | 1692 | 0.618 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| mistral | 422 | 1692 | 0.542 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| mistral-chat | 422 | 1692 | 0.369 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| mpt | 422 | 1692 | 0.576 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| mpt-chat | 422 | 1692 | 0.227 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 4644 | 0.496 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| greedy\|rep_penalty=yes | 422 | 2532 | 0.375 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| sampling\|rep_penalty=no | 422 | 4663 | 0.487 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |
| sampling\|rep_penalty=yes | 422 | 2544 | 0.455 | 0.0 | 0.5 | 1.5 | 0.0 | 5.7 | 7.9 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 3960 | 0.371 | 0.0 | 0.0 | 6.6 | 0.0 | 0.0 | 6.6 |
| 150-299 † | 278 | 5678 | 0.554 | 0.0 | 0.0 | 1.1 | 0.0 | 0.0 | 1.1 |
| 300-599 † | 67 | 4745 | 0.324 | 0.0 | 0.0 | 4.4 | 0.0 | 0.0 | 4.4 |
| >=600 † | 33 | 0 | - | - | 6.1 | 17.9 | - | 72.7 | 85.0 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
