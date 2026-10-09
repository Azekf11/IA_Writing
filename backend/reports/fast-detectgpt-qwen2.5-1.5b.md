# Evaluation: fast-detectgpt-qwen2.5-1.5b

Thresholds calibrated on 373 human texts of the `calibration` split (split-conformal rule), applied to `test` (422 human, 3553 AI).

Test split: the detector could not score 0 human and 1 AI texts; they count as not flagged (and rank lowest in the AUROC).

AI texts: a deterministic 25% sample of the test split (proportions of domains and generators kept); all human texts are scored.

AUROC: **0.782** (95% CI 0.766-0.798)

| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |
|---|---|---|---|
| 1% | 50.8 | 1.2 | 2.5 |
| 5% | 61.3 | 4.5 | 6.5 |

## Domain

| Domain | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| abstracts † | 57 | 446 | 0.831 | 61.9 | 0.0 | 5.1 | 72.6 | 1.8 | 8.1 |
| books † | 56 | 490 | 0.789 | 44.9 | 0.0 | 5.2 | 57.1 | 0.0 | 5.2 |
| news † | 50 | 437 | 0.780 | 58.6 | 2.0 | 9.1 | 68.0 | 8.0 | 17.4 |
| poetry † | 45 | 371 | 0.779 | 42.3 | 2.2 | 10.1 | 51.8 | 4.4 | 13.3 |
| recipes † | 55 | 441 | 0.653 | 34.0 | 3.6 | 11.0 | 45.8 | 10.9 | 20.4 |
| reddit † | 49 | 440 | 0.806 | 47.7 | 2.0 | 9.3 | 61.1 | 4.1 | 12.3 |
| reviews † | 60 | 521 | 0.817 | 59.1 | 0.0 | 4.9 | 67.2 | 5.0 | 12.4 |
| wiki † | 50 | 407 | 0.810 | 56.3 | 0.0 | 5.8 | 64.6 | 2.0 | 9.1 |

## Generator (vs all test humans)

| Generator | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| chatgpt | 422 | 215 | 0.911 | 47.0 | 1.2 | 2.5 | 63.7 | 4.5 | 6.5 |
| cohere | 422 | 198 | 0.965 | 72.7 | 1.2 | 2.5 | 85.9 | 4.5 | 6.5 |
| cohere-chat | 422 | 209 | 0.917 | 55.0 | 1.2 | 2.5 | 69.9 | 4.5 | 6.5 |
| gpt2 | 422 | 397 | 0.781 | 63.7 | 1.2 | 2.5 | 67.5 | 4.5 | 6.5 |
| gpt3 | 422 | 175 | 0.979 | 81.1 | 1.2 | 2.5 | 89.7 | 4.5 | 6.5 |
| gpt4 | 422 | 211 | 0.759 | 30.8 | 1.2 | 2.5 | 47.9 | 4.5 | 6.5 |
| llama-chat | 422 | 435 | 0.835 | 46.2 | 1.2 | 2.5 | 58.9 | 4.5 | 6.5 |
| mistral | 422 | 454 | 0.733 | 51.1 | 1.2 | 2.5 | 62.1 | 4.5 | 6.5 |
| mistral-chat | 422 | 428 | 0.837 | 51.6 | 1.2 | 2.5 | 61.4 | 4.5 | 6.5 |
| mpt | 422 | 418 | 0.516 | 37.3 | 1.2 | 2.5 | 41.9 | 4.5 | 6.5 |
| mpt-chat | 422 | 413 | 0.703 | 42.6 | 1.2 | 2.5 | 53.8 | 4.5 | 6.5 |

## Decoding (vs all test humans)

| Decoding | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| greedy\|rep_penalty=no | 422 | 1159 | 0.979 | 81.2 | 1.2 | 2.5 | 90.4 | 4.5 | 6.5 |
| greedy\|rep_penalty=yes | 422 | 628 | 0.736 | 40.9 | 1.2 | 2.5 | 52.2 | 4.5 | 6.5 |
| sampling\|rep_penalty=no | 422 | 1146 | 0.892 | 51.4 | 1.2 | 2.5 | 66.4 | 4.5 | 6.5 |
| sampling\|rep_penalty=yes | 422 | 620 | 0.260 | 3.1 | 1.2 | 2.5 | 6.5 | 4.5 | 6.5 |

## Length (words)

| Length | n human | n AI | AUROC | TPR@1% | FPR@1% | FPR up95@1% | TPR@5% | FPR@5% | FPR up95@5% |
|---|---|---|---|---|---|---|---|---|---|
| <150 † | 44 | 933 | 0.752 | 46.0 | 0.0 | 6.6 | 57.4 | 4.5 | 13.6 |
| 150-299 † | 278 | 1410 | 0.783 | 48.7 | 1.4 | 3.3 | 60.2 | 5.0 | 7.8 |
| 300-599 † | 67 | 1210 | 0.786 | 57.0 | 1.5 | 6.9 | 65.5 | 4.5 | 11.2 |
| >=600 † | 33 | 0 | - | - | 0.0 | 8.7 | - | 0.0 | 8.7 |

Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.
† fewer than 299 human texts: even with zero false positives this slice cannot show an FPR below 1%.
