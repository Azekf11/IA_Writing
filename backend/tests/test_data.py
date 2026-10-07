from collections import Counter

import pandas as pd
import pytest

from aiwd.data import Document, assign_split
from aiwd.data import raid as raid_module
from aiwd.data.raid import load_raid, raid_to_documents, sample_balanced
from aiwd.eval.baselines import length_scores, random_scores


def fake_raid() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "id": ["h1", "a1", "a2", "h2", "a3"],
            "source_id": [float("nan"), "h1", "h1", float("nan"), "h2"],
            "model": ["human", "gpt4", "mistral", "human", "gpt4"],
            "decoding": [float("nan"), "greedy", "sampling", float("nan"), "sampling"],
            "repetition_penalty": [float("nan"), "no", "yes", float("nan"), "no"],
            "attack": ["none"] * 5,
            "domain": ["news", "news", "news", "books", "books"],
            "generation": ["Human text.", "AI text one.", "AI two.", "Book text.", "AI book."],
        }
    )


def test_raid_mapping_labels_and_groups():
    docs = raid_to_documents(fake_raid())
    by_id = {d.id: d for d in docs}
    assert by_id["h1"].label == "human" and by_id["h1"].generator is None
    assert by_id["a1"].label == "ai" and by_id["a1"].generator == "gpt4"
    assert by_id["a1"].group_id == by_id["h1"].group_id == "h1"
    assert by_id["a3"].group_id == "h2"
    assert by_id["a2"].decoding == "sampling|rep_penalty=yes"
    assert by_id["h1"].decoding is None


def test_raid_without_source_id_falls_back_to_id():
    docs = raid_to_documents(fake_raid().drop(columns=["source_id"]))
    assert all(d.group_id == d.id for d in docs)


def test_raid_test_split_without_labels_is_rejected():
    with pytest.raises(ValueError, match="missing columns"):
        raid_to_documents(fake_raid().drop(columns=["model"]))


def test_raid_languages_cutoff_and_license():
    df = fake_raid()
    df.loc[3, "domain"] = "czech"
    df.loc[4, "domain"] = "code"
    by_id = {d.id: d for d in raid_to_documents(df)}
    assert by_id["h1"].language == "en"
    assert by_id["h2"].language == "cs"
    assert by_id["a3"].language == "zxx"
    assert by_id["h1"].created_before_cutoff is None
    assert "MIT" in by_id["a1"].license


def test_raid_empty_generations_are_dropped():
    df = fake_raid()
    df.loc[1, "generation"] = float("nan")
    df.loc[2, "generation"] = "   "
    with pytest.warns(UserWarning, match="dropped 2"):
        docs = raid_to_documents(df)
    assert {d.id for d in docs} == {"h1", "h2", "a3"}


def test_load_raid_from_local_csv(tmp_path):
    path = tmp_path / "train_none.csv"
    fake_raid().assign(title="t", prompt="p", adv_source_id="x").to_csv(path, index=False)
    docs = load_raid(path=path, sample_per_domain=1)
    assert len(docs) == 4
    assert {d.label for d in docs} == {"human", "ai"}


def test_load_raid_test_split_gives_clear_error(tmp_path):
    path = tmp_path / "test_none.csv"
    fake_raid().drop(columns=["model"]).to_csv(path, index=False)
    with pytest.raises(ValueError, match="no labels"):
        load_raid(path=path, sample_per_domain=1)


def test_cached_raid_file_needs_no_network(tmp_path, monkeypatch):
    monkeypatch.setenv("RAID_CACHE_DIR", str(tmp_path))
    fake_raid().to_csv(tmp_path / "train_none.csv", index=False)

    def no_network(*args, **kwargs):
        raise AssertionError("network used although the file is cached")

    monkeypatch.setattr(raid_module, "urlopen", no_network)
    assert len(load_raid("train")) == 5


def test_unknown_raid_split():
    with pytest.raises(ValueError):
        raid_module.raid_filename("dev", include_adversarial=False)


def test_sample_balanced_caps_each_domain_and_class():
    df = sample_balanced(fake_raid(), per_domain=1)
    counts = Counter(zip(df["domain"], df["model"] == "human", strict=True))
    assert all(v == 1 for v in counts.values())
    assert len(counts) == 4


def test_document_validation():
    with pytest.raises(ValueError):
        Document(id="x", text="t", label="robot", source_dataset="s", group_id="g")
    with pytest.raises(ValueError):
        Document(id="", text="t", label="human", source_dataset="s", group_id="g")
    with pytest.raises(ValueError):
        Document(id="x", text="  ", label="human", source_dataset="s", group_id="g")
    d = Document(
        id="x", text="one two three", label="ai_polished", source_dataset="s", group_id="g"
    )
    assert d.n_words == 3 and d.y == 1


def test_assign_split_is_deterministic_and_grouped():
    assert assign_split("group-42") == assign_split("group-42")
    splits = Counter(assign_split(f"g{i}") for i in range(20000))
    assert set(splits) == {"train", "val", "calibration", "test"}
    assert splits["train"] / 20000 == pytest.approx(0.70, abs=0.02)
    assert splits["test"] / 20000 == pytest.approx(0.10, abs=0.02)


def test_assign_split_seed_changes_assignment():
    a = [assign_split(f"g{i}", seed="v1") for i in range(200)]
    b = [assign_split(f"g{i}", seed="v2") for i in range(200)]
    assert a != b


def test_baselines_shapes():
    texts = ["a b c", "d e", "f"]
    assert length_scores(texts) == [3.0, 2.0, 1.0]
    assert len(random_scores(texts)) == 3
    assert random_scores(texts, seed=1) == random_scores(texts, seed=1)
