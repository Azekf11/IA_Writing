import pandas as pd
import pytest
from conftest import make_raid_frame

from aiwd.data.build import (
    build_raid_dataset,
    content_sha256,
    drop_duplicates,
    length_bucket,
    load_dataset,
    read_sources,
    save_dataset,
    select_groups,
)


def test_length_buckets():
    assert [length_bucket(n) for n in (0, 149, 150, 299, 300, 599, 600, 5000)] == [
        "<150", "<150", "150-299", "150-299", "300-599", "300-599", ">=600", ">=600",
    ]  # fmt: skip


def test_select_groups_samples_per_domain(raid_csv):
    chosen = select_groups(raid_csv, per_domain=10, seed=0)
    assert len(chosen) == 30
    assert {g.split("-")[0] for g in chosen} == {"news", "books", "reddit"}
    assert select_groups(raid_csv, per_domain=10, seed=0) == chosen
    assert select_groups(raid_csv, per_domain=10, seed=1) != chosen
    assert len(select_groups(raid_csv, per_domain=1000)) == 120
    assert set(select_groups(raid_csv, per_domain=5)) <= set(chosen)


def test_read_sources_keeps_whole_groups_whatever_the_chunksize(raid_csv):
    sources = set(select_groups(raid_csv, per_domain=5))
    full = read_sources(raid_csv, sources, chunksize=1_000_000)
    small = read_sources(raid_csv, sources, chunksize=7)
    assert len(full) == len(small) == 15 * 5
    assert sorted(full["id"]) == sorted(small["id"])
    assert set(full["source_id"]) == sources


def test_build_keeps_groups_inside_one_split(raid_csv):
    df, manifest = build_raid_dataset(raid_csv, per_domain=40)
    assert df.groupby("group_id")["split"].nunique().max() == 1
    assert set(df["split"]) <= {"train", "val", "calibration", "test"}
    assert manifest["n_rows"] == len(df) == 120 * 5
    assert manifest["n_groups"] == 120
    assert manifest["dropped"] == {
        "empty_text": 0, "duplicates_dropped": 0, "conflicting_dropped": 0,
    }  # fmt: skip
    assert set(df["label"]) == {"human", "ai"}
    assert (df.loc[df["label"] == "human", "generator"].isna()).all()


def test_build_is_deterministic(raid_csv):
    a, ma = build_raid_dataset(raid_csv, per_domain=20, seed=3)
    b, mb = build_raid_dataset(raid_csv, per_domain=20, seed=3, chunksize=11)
    assert ma["content_sha256"] == mb["content_sha256"]
    c, mc = build_raid_dataset(raid_csv, per_domain=20, seed=4)
    assert mc["content_sha256"] != ma["content_sha256"]


def test_duplicates_and_conflicts(tmp_path):
    frame = make_raid_frame(sources_per_domain=3)
    ai = frame[frame["model"] != "human"].index
    human = frame[frame["model"] == "human"].index
    frame.loc[ai[1], "generation"] = frame.loc[ai[0], "generation"].upper() + "  "
    frame.loc[ai[5], "generation"] = frame.loc[human[1], "generation"]
    frame.loc[ai[7], "generation"] = "   "
    path = tmp_path / "train_none.csv"
    frame.to_csv(path, index=False)
    with pytest.warns(UserWarning, match="dropped 1"):
        df, manifest = build_raid_dataset(path, per_domain=3)
    assert manifest["dropped"] == {
        "empty_text": 1, "duplicates_dropped": 1, "conflicting_dropped": 2,
    }  # fmt: skip
    assert len(df) == len(frame) - 4


def test_drop_duplicates_keeps_first_id():
    df = pd.DataFrame(
        {"id": ["b", "a"], "text": ["Same text", "same  TEXT"], "label": ["ai", "ai"]}
    )
    kept, stats = drop_duplicates(df)
    assert kept["id"].tolist() == ["a"]
    assert stats == {"duplicates_dropped": 1, "conflicting_dropped": 0}


def test_save_and_load_roundtrip(raid_csv, tmp_path):
    df, manifest = build_raid_dataset(raid_csv, per_domain=5)
    out, manifest_path = save_dataset(df, manifest, tmp_path / "ds" / "raid-v1.parquet")
    assert manifest_path.name == "raid-v1.manifest.json"
    loaded = load_dataset(out)
    assert content_sha256(loaded) == manifest["content_sha256"]


def test_missing_file_columns(tmp_path):
    path = tmp_path / "bad.csv"
    make_raid_frame(3).drop(columns=["model"]).to_csv(path, index=False)
    with pytest.raises(ValueError, match="no labels"):
        build_raid_dataset(path, per_domain=1)


def test_numeric_looking_ids_survive_chunked_reads(tmp_path):
    frame = make_raid_frame(sources_per_domain=4)
    mapping = {old: f"{i:03d}" for i, old in enumerate(frame["id"])}
    frame["id"] = frame["id"].map(mapping)
    frame["adv_source_id"] = frame["id"]
    frame["source_id"] = frame["source_id"].map(mapping)
    frame.loc[frame.index[-1], "source_id"] = None
    path = tmp_path / "train_none.csv"
    frame.to_csv(path, index=False)
    a, ma = build_raid_dataset(path, per_domain=4, chunksize=1_000_000)
    b, mb = build_raid_dataset(path, per_domain=4, chunksize=5)
    assert ma["content_sha256"] == mb["content_sha256"]
    assert len(a) == len(frame) - 1
    assert "000" in set(a["id"])


def test_sources_sharing_a_title_form_one_group(tmp_path):
    frame = make_raid_frame(sources_per_domain=6)
    news_humans = frame[(frame["domain"] == "news") & (frame["model"] == "human")]["id"].tolist()
    same = frame["source_id"].isin(news_humans[:3])
    frame.loc[same, "title"] = "  The Same   Headline "
    frame.loc[frame["source_id"] == news_humans[1], "title"] = "the same headline"
    path = tmp_path / "train_none.csv"
    frame.to_csv(path, index=False)
    df, manifest = build_raid_dataset(path, per_domain=6)
    merged = df[df["group_id"] == min(news_humans[:3])]
    assert len(merged) == 3 * 5
    assert merged["split"].nunique() == 1
    assert manifest["n_sources_merged_by_title"] == 2
    assert manifest["n_groups"] == 18 - 2


def test_hash_covers_metadata(raid_csv):
    df, manifest = build_raid_dataset(raid_csv, per_domain=5)
    changed = df.copy()
    changed.loc[changed.index[0], "domain"] = "elsewhere"
    assert content_sha256(changed) != manifest["content_sha256"]
    assert content_sha256(df.sample(frac=1, random_state=0)) == manifest["content_sha256"]


def test_placeholder_title_triggers_a_warning(tmp_path):
    frame = make_raid_frame(sources_per_domain=60)
    frame.loc[frame["domain"] == "poetry", "title"] = "x"
    frame.loc[frame["domain"] == "news", "title"] = "Untitled"
    path = tmp_path / "train_none.csv"
    frame.to_csv(path, index=False)
    with pytest.warns(UserWarning, match="merges 60 human sources"):
        _, manifest = build_raid_dataset(path, per_domain=60)
    assert manifest["largest_group"]["n_sources"] == 60
