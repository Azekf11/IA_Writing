"""Load an observer/performer pair of causal language models and score texts with them."""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import torch

from aiwd.zeroshot.criteria import text_criteria

# observer (base model), performer (instruct model). They must share one tokenizer.
PAIRS: dict[str, tuple[str, str]] = {
    # Official Binoculars pair: ~28 GB in bfloat16, needs an A100 40 GB or two 24 GB GPUs.
    "falcon-7b": ("tiiuae/falcon-7b", "tiiuae/falcon-7b-instruct"),
    # Budget pair to validate against the official one: ~6 GB in float16 (T4, Mac 16 GB).
    "qwen2.5-1.5b": ("Qwen/Qwen2.5-1.5B", "Qwen/Qwen2.5-1.5B-Instruct"),
}
MAX_TOKENS = 512


@dataclass
class ModelPair:
    observer: torch.nn.Module
    performer: torch.nn.Module
    tokenizer: object
    name: str


def pick_devices() -> tuple[str, str]:
    if torch.cuda.is_available():
        return "cuda:0", "cuda:1" if torch.cuda.device_count() > 1 else "cuda:0"
    if torch.backends.mps.is_available():
        return "mps", "mps"
    return "cpu", "cpu"


def pick_dtype(device: str) -> torch.dtype:
    if device.startswith("cuda"):
        # Native bfloat16 needs Ampere (compute capability 8.0) or newer. On a T4,
        # torch.cuda.is_bf16_supported() can be True through slow emulation.
        major, _ = torch.cuda.get_device_capability(device)
        return torch.bfloat16 if major >= 8 else torch.float16
    if device == "mps":
        return torch.float16
    return torch.float32


def load_pair(
    observer: str, performer: str, dtype: torch.dtype | None = None, name: str | None = None
) -> ModelPair:
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(observer)
    if tokenizer.get_vocab() != AutoTokenizer.from_pretrained(performer).get_vocab():
        raise ValueError(f"{observer} and {performer} do not share the same tokenizer")
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    dev_obs, dev_perf = pick_devices()
    dtype = dtype or pick_dtype(dev_obs)
    models = []
    for path, device in ((observer, dev_obs), (performer, dev_perf)):
        kwargs: dict = {"dtype": dtype}
        if device != "cpu":
            kwargs["device_map"] = {"": device}
        model = AutoModelForCausalLM.from_pretrained(path, **kwargs)
        models.append(model.eval())
    return ModelPair(models[0], models[1], tokenizer, name or f"{observer}|{performer}")


@torch.inference_mode()
def score_texts(
    pair: ModelPair,
    texts: Sequence[str],
    batch_size: int = 8,
    max_tokens: int = MAX_TOKENS,
    progress: Callable[[int, int, float], None] | None = None,
) -> list[dict[str, float]]:
    """Criteria for every text, in input order.

    Texts are batched by token length, longest first, so an out-of-memory error shows up
    in the first batch rather than at the end of a long run. In float16/bfloat16 a text's
    scores vary slightly (around 1e-3) with its batch neighbours, as in the official code;
    use float32 if you need bit-for-bit reproducibility.
    """
    tok = pair.tokenizer
    lengths = [
        len(ids) for ids in tok(list(texts), truncation=True, max_length=max_tokens)["input_ids"]
    ]
    results: list[dict[str, float] | None] = [None] * len(texts)
    for i, n in enumerate(lengths):
        if n == 0:
            results[i] = text_criteria(
                torch.zeros(0, 1), torch.zeros(0, 1), torch.zeros(0, dtype=torch.long)
            )
    order = sorted((i for i, n in enumerate(lengths) if n > 0), key=lambda i: -lengths[i])
    start = time.perf_counter()
    for b in range(0, len(order), batch_size):
        idx = order[b : b + batch_size]
        enc = tok(
            [texts[i] for i in idx],
            return_tensors="pt",
            padding="longest",
            truncation=True,
            max_length=max_tokens,
            return_token_type_ids=False,
        )
        obs_logits = pair.observer(**enc.to(pair.observer.device)).logits
        perf_logits = pair.performer(**enc.to(pair.performer.device)).logits
        if not (torch.isfinite(obs_logits).all() and torch.isfinite(perf_logits).all()):
            raise FloatingPointError(
                "non-finite logits: this model overflows in float16. Rerun with --dtype "
                "bfloat16 (same memory, slower on a T4) or --dtype float32 --batch-size 1"
            )
        perf_logits = perf_logits.to(obs_logits.device)
        input_ids = enc["input_ids"].to(obs_logits.device)
        for row, i in enumerate(idx):
            n = int(enc["attention_mask"][row].sum())
            results[i] = text_criteria(
                obs_logits[row, :n], perf_logits[row, :n], input_ids[row, :n]
            )
        if progress is not None:
            progress(min(b + batch_size, len(order)), len(order), time.perf_counter() - start)
    return results  # type: ignore[return-value]
