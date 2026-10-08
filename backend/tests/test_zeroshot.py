"""Zero-shot criteria. Skipped unless the `ml` extra (torch, transformers) is installed."""

import math

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("transformers")

import torch.nn.functional as F  # noqa: E402

from aiwd.zeroshot.criteria import SCORE_SIGN, text_criteria  # noqa: E402
from aiwd.zeroshot.lm_pair import ModelPair, load_pair, score_texts  # noqa: E402


# --- Reference: the official implementations, for one unpadded text -------------------
def official_binoculars(obs_logits, perf_logits, ids):
    """Port of Binoculars metrics.perplexity / metrics.entropy (batch of one, no padding)."""
    obs, perf, ids = obs_logits[None], perf_logits[None], ids[None]
    ppl = F.cross_entropy(perf[..., :-1, :].transpose(1, 2), ids[..., 1:], reduction="none")
    ppl = ppl.mean(1)
    vocab, n = obs.shape[-1], perf.shape[-2]
    p_proba = torch.softmax(obs, dim=-1).view(-1, vocab)
    ce = F.cross_entropy(perf.view(-1, vocab), p_proba, reduction="none").view(-1, n)
    x_ppl = ce.mean(1)
    return (ppl / x_ppl).item()


def official_fast_detectgpt(logits_ref, logits_score, labels):
    """Copy of fast-detect-gpt get_sampling_discrepancy_analytic (shifted inputs)."""
    labels = labels.unsqueeze(-1) if labels.ndim == logits_score.ndim - 1 else labels
    lprobs_score = torch.log_softmax(logits_score, dim=-1)
    probs_ref = torch.softmax(logits_ref, dim=-1)
    log_likelihood = lprobs_score.gather(dim=-1, index=labels).squeeze(-1)
    mean_ref = (probs_ref * lprobs_score).sum(dim=-1)
    var_ref = (probs_ref * torch.square(lprobs_score)).sum(dim=-1) - torch.square(mean_ref)
    discrepancy = (log_likelihood.sum(dim=-1) - mean_ref.sum(dim=-1)) / var_ref.sum(dim=-1).sqrt()
    return discrepancy.mean().item()


@pytest.mark.parametrize("seed", range(5))
def test_criteria_match_official_code(seed):
    g = torch.Generator().manual_seed(seed)
    n, vocab = 30, 50
    obs = torch.randn(n, vocab, generator=g) * 3
    perf = torch.randn(n, vocab, generator=g) * 3
    ids = torch.randint(0, vocab, (n,), generator=g)
    c = text_criteria(obs, perf, ids)
    obs64, perf64 = obs.double(), perf.double()
    expected_bino = official_binoculars(obs64, perf64, ids)
    assert c["binoculars"] == pytest.approx(expected_bino, rel=1e-5)
    expected = official_fast_detectgpt(obs64[None, :-1], perf64[None, :-1], ids[None, 1:])
    assert c["fast_detectgpt"] == pytest.approx(expected, rel=1e-4, abs=1e-6)
    log_probs = torch.log_softmax(perf[:-1], dim=-1)
    assert c["loglik"] == pytest.approx(log_probs.gather(-1, ids[1:, None]).mean().item(), rel=1e-5)


def test_logrank_of_top_tokens_is_zero():
    perf = torch.full((6, 10), -5.0)
    ids = torch.tensor([0, 1, 2, 3, 4, 5])
    for t in range(5):
        perf[t, ids[t + 1]] = 5.0
    c = text_criteria(torch.zeros(6, 10), perf, ids)
    assert c["logrank"] == 0.0


def test_vocab_size_mismatch_is_truncated_like_fast_detectgpt():
    g = torch.Generator().manual_seed(0)
    obs, perf = torch.randn(10, 40, generator=g), torch.randn(10, 44, generator=g)
    ids = torch.randint(0, 40, (10,), generator=g)
    a = text_criteria(obs, perf, ids)
    b = text_criteria(obs, perf[:, :40], ids)
    assert a == b


def test_single_token_gives_nan():
    c = text_criteria(torch.zeros(1, 5), torch.zeros(1, 5), torch.tensor([1]))
    assert math.isnan(c["binoculars"]) and c["n_tokens"] == 1


def test_score_signs():
    assert SCORE_SIGN == {"binoculars": -1.0, "fast_detectgpt": 1.0, "loglik": 1.0, "logrank": -1.0}


# --- Plumbing with tiny random models saved to disk (no network needed) ----------------
WORDS = "the of model text human writing data study result method people time year way a".split()


@pytest.fixture(scope="module")
def tiny_dirs(tmp_path_factory):
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast

    root = tmp_path_factory.mktemp("tiny")
    vocab = {"[UNK]": 0, "[EOS]": 1, **{w: i + 2 for i, w in enumerate(WORDS)}}
    backend = Tokenizer(models.WordLevel(vocab=vocab, unk_token="[UNK]"))
    backend.pre_tokenizer = pre_tokenizers.Whitespace()
    tok = PreTrainedTokenizerFast(tokenizer_object=backend, unk_token="[UNK]", eos_token="[EOS]")
    dirs = {}
    for name, seed in (("observer", 0), ("performer", 1)):
        torch.manual_seed(seed)
        config = LlamaConfig(
            vocab_size=len(vocab), hidden_size=32, intermediate_size=64, num_hidden_layers=2,
            num_attention_heads=4, num_key_value_heads=4, max_position_embeddings=128,
            eos_token_id=1,
        )  # fmt: skip
        LlamaForCausalLM(config).save_pretrained(root / name)
        tok.save_pretrained(root / name)
        dirs[name] = str(root / name)
    other = Tokenizer(models.WordLevel(vocab={"[UNK]": 0, "x": 1}, unk_token="[UNK]"))
    PreTrainedTokenizerFast(tokenizer_object=other, unk_token="[UNK]").save_pretrained(
        root / "other"
    )
    LlamaForCausalLM(LlamaConfig(vocab_size=2, hidden_size=8, intermediate_size=8,
                                 num_hidden_layers=1, num_attention_heads=1)).save_pretrained(
        root / "other"
    )  # fmt: skip
    dirs["other"] = str(root / "other")
    return dirs


@pytest.fixture(scope="module")
def tiny_pair(tiny_dirs):
    return load_pair(tiny_dirs["observer"], tiny_dirs["performer"], dtype=torch.float32)


def test_load_pair_sets_padding(tiny_pair):
    assert tiny_pair.tokenizer.pad_token == "[EOS]"
    assert tiny_pair.tokenizer.padding_side == "right"
    assert tiny_pair.observer.dtype == torch.float32


def test_load_pair_rejects_different_tokenizers(tiny_dirs):
    with pytest.raises(ValueError, match="same tokenizer"):
        load_pair(tiny_dirs["observer"], tiny_dirs["other"], dtype=torch.float32)


TEXTS = [
    "the model text human writing data",
    "a study",
    "people time year way the of model text human writing data study result method " * 3,
    "the method",
    "data data data data data data data data",
]


def test_batching_does_not_change_scores(tiny_pair):
    one = score_texts(tiny_pair, TEXTS, batch_size=1)
    many = score_texts(tiny_pair, TEXTS, batch_size=4)
    assert [r["n_tokens"] for r in one] == [len(t.split()) for t in TEXTS]
    for a, b in zip(one, many, strict=True):
        for key in ("binoculars", "fast_detectgpt", "loglik", "logrank"):
            assert a[key] == pytest.approx(b[key], rel=1e-5, abs=1e-6)


def test_scores_follow_input_order_and_truncation(tiny_pair):
    reversed_scores = score_texts(tiny_pair, TEXTS[::-1], batch_size=2)
    forward = score_texts(tiny_pair, TEXTS, batch_size=2)
    assert [r["binoculars"] for r in reversed_scores[::-1]] == pytest.approx(
        [r["binoculars"] for r in forward], rel=1e-4
    )
    capped = score_texts(tiny_pair, TEXTS, batch_size=2, max_tokens=5)
    assert max(r["n_tokens"] for r in capped) == 5


def test_progress_callback(tiny_pair):
    calls = []
    score_texts(tiny_pair, TEXTS, batch_size=2, progress=lambda d, t, e: calls.append((d, t)))
    assert calls[-1] == (5, 5) and len(calls) == 3


def test_non_finite_logits_raise(tiny_pair):
    broken = ModelPair(tiny_pair.observer, tiny_pair.performer, tiny_pair.tokenizer, "broken")
    with torch.no_grad():
        broken.performer.lm_head.weight[0, 0] = float("nan")
    try:
        with pytest.raises(FloatingPointError, match="float32"):
            score_texts(broken, TEXTS[:2])
    finally:
        with torch.no_grad():
            broken.performer.lm_head.weight[0, 0] = 0.0


def test_fast_detectgpt_is_stable_when_the_reference_is_nearly_uniform():
    g = torch.Generator().manual_seed(0)
    obs = torch.randn(40, 30, generator=g) * 0.01
    perf = torch.randn(40, 30, generator=g) * 0.01
    ids = torch.randint(0, 30, (40,), generator=g)
    exact = official_fast_detectgpt(
        obs.double()[None, :-1], perf.double()[None, :-1], ids[None, 1:]
    )
    assert text_criteria(obs, perf, ids)["fast_detectgpt"] == pytest.approx(exact, rel=1e-4)
