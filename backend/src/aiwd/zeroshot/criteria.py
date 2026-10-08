"""Zero-shot criteria from an observer (base) and a performer (instruct) language model
that share one tokenizer. Computed per text on its real tokens (no padding involved).

Binoculars (Hans et al., ICML 2024) and Fast-DetectGPT (Bao et al., ICLR 2024) follow the
official code: github.com/ahans30/Binoculars (BSD-3-Clause, `metrics.py`) and
github.com/baoguangsheng/fast-detect-gpt (MIT, `get_sampling_discrepancy_analytic`).
Two deliberate differences with the official Fast-DetectGPT: its variance is computed in two
passes (same value, no float32 cancellation), and texts are truncated at 512 tokens like
Binoculars (the official script truncates at the tokenizer limit, e.g. 2048 for Falcon).
"""

from __future__ import annotations

import math

import torch


def text_criteria(
    observer_logits: torch.Tensor, performer_logits: torch.Tensor, input_ids: torch.Tensor
) -> dict[str, float]:
    """Criteria for ONE text. Logits are [length, vocab], input_ids is [length].

    - binoculars: log-perplexity of the text under the performer, divided by the
      cross-entropy between observer and performer distributions. LOWER = more AI-like.
    - fast_detectgpt: analytic conditional probability curvature, reference = observer,
      scoring = performer. HIGHER = more AI-like.
    - loglik: mean log-probability of the text under the performer. HIGHER = more AI-like.
    - logrank: mean log-rank of each token under the performer. LOWER = more AI-like.
    """
    n = input_ids.shape[0]
    if n < 2:
        nan = math.nan
        return {
            "n_tokens": n,
            "log_ppl": nan,
            "log_xppl": nan,
            "binoculars": nan,
            "fast_detectgpt": nan,
            "loglik": nan,
            "logrank": nan,
        }
    vocab = min(observer_logits.shape[-1], performer_logits.shape[-1])
    obs = observer_logits[:, :vocab].float()
    perf_logp = torch.log_softmax(performer_logits[:, :vocab].float(), dim=-1)
    obs_p = torch.softmax(obs, dim=-1)

    labels = input_ids[1:].unsqueeze(-1)
    shifted_logp = perf_logp[:-1]
    ll = shifted_logp.gather(-1, labels).squeeze(-1)
    log_ppl = -ll.mean()
    log_xppl = -(obs_p * perf_logp).sum(-1).mean()

    ref_p = obs_p[:-1]
    mean_ref = (ref_p * shifted_logp).sum(-1)
    # Same variance as the official E[x^2] - E[x]^2, computed in two passes to avoid
    # catastrophic cancellation in float32 when the variance is small.
    var_ref = (ref_p * (shifted_logp - mean_ref.unsqueeze(-1)).square()).sum(-1)
    fast = (ll - mean_ref).sum() / var_ref.sum().sqrt()

    rank = (shifted_logp > ll.unsqueeze(-1)).sum(-1) + 1
    return {
        "n_tokens": n,
        "log_ppl": log_ppl.item(),
        "log_xppl": log_xppl.item(),
        "binoculars": (log_ppl / log_xppl).item(),
        "fast_detectgpt": fast.item(),
        "loglik": (-log_ppl).item(),
        "logrank": torch.log(rank.float()).mean().item(),
    }


# Direction of each criterion as a score file ("higher = more likely AI").
SCORE_SIGN = {"binoculars": -1.0, "fast_detectgpt": 1.0, "loglik": 1.0, "logrank": -1.0}
