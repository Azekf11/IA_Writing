import random

import pandas as pd
import pytest

WORDS = "the of model text human writing data study result method people time year way".split()


def _text(rng: random.Random, n_words: int) -> str:
    return " ".join(rng.choice(WORDS) for _ in range(n_words)) + "."


def make_raid_frame(sources_per_domain: int = 40, seed: int = 0) -> pd.DataFrame:
    """A small CSV with the same columns and id conventions as RAID's train_none.csv."""
    rng = random.Random(seed)
    rows = []
    for domain in ("news", "books", "reddit"):
        for i in range(sources_per_domain):
            hid = f"{domain}-h{i:03d}"
            n = rng.choice([80, 200, 400, 800])
            rows.append(
                dict(id=hid, adv_source_id=hid, source_id=hid, model="human", decoding=None,
                     repetition_penalty=None, attack="none", domain=domain, title=f"t{i}",
                     prompt=None, generation=_text(rng, n))
            )  # fmt: skip
            for model in ("gpt4", "mistral"):
                for decoding in ("greedy", "sampling"):
                    gid = f"{domain}-{model}-{decoding}-{i:03d}"
                    rows.append(
                        dict(id=gid, adv_source_id=gid, source_id=hid, model=model,
                             decoding=decoding, repetition_penalty="no", attack="none",
                             domain=domain, title=f"t{i}", prompt="p",
                             generation=_text(rng, n + rng.randint(-20, 20)))
                    )  # fmt: skip
    return pd.DataFrame(rows)


@pytest.fixture
def raid_csv(tmp_path):
    path = tmp_path / "train_none.csv"
    make_raid_frame().to_csv(path, index=False)
    return path
