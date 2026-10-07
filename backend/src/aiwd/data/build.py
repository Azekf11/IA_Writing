"""Build a frozen, versioned dataset from a RAID CSV (train_none.csv).

A group is a human source text plus every AI generation made from it. RAID builds its
generation prompts from the title, so human sources of the same domain that share a
title are merged into one group: their AI texts are near-identical and must never land
in different splits. `per_domain` groups are drawn per domain, a group never straddles
two splits, and the same parameters always produce the same rows (`content_sha256`).
"""

from __future__ import annotations

import hashlib
import json
import math
import warnings
from collections import Counter
from pathlib import Path

import pandas as pd

from aiwd.data.raid import (
    OPTIONAL_COLUMNS,
    REQUIRED_COLUMNS,
    check_columns,
    csv_read_options,
    raid_to_documents,
)
from aiwd.data.splits import DEFAULT_WEIGHTS, assign_split

LENGTH_BUCKETS: tuple[tuple[int, str], ...] = (
    (150, "<150"),
    (300, "150-299"),
    (600, "300-599"),
)
LONGEST_BUCKET = ">=600"
LARGE_GROUP = 50


def length_bucket(n_words: int) -> str:
    for upper, name in LENGTH_BUCKETS:
        if n_words < upper:
            return name
    return LONGEST_BUCKET


def source_ids(df: pd.DataFrame) -> pd.Series:
    """The human source each row comes from (its own id for a human text)."""
    if "source_id" not in df.columns:
        return df["id"].astype(str)
    source = df["source_id"].astype("string").str.strip()
    return source.where(source.notna() & source.ne(""), df["id"].astype(str)).astype(str)


def _title_key(title: object) -> str | None:
    if title is None or (isinstance(title, float) and math.isnan(title)):
        return None
    key = " ".join(str(title).split()).casefold()
    return key or None


def canonical_groups(meta: pd.DataFrame) -> dict[str, str]:
    """Map every human source id to its group id: the smallest source id sharing
    the same domain and title (a source without a title is its own group)."""
    human = meta[meta["model"] == "human"]
    sources = source_ids(human).tolist()
    titles = human["title"].tolist() if "title" in human.columns else [None] * len(sources)
    mapping: dict[str, str] = {}
    by_title: dict[tuple[str, str], list[str]] = {}
    for src, domain, title in zip(sources, human["domain"].astype(str), titles, strict=True):
        key = _title_key(title)
        if key is None:
            mapping[src] = src
        else:
            by_title.setdefault((domain, key), []).append(src)
    for members in by_title.values():
        group = min(members)
        for src in members:
            mapping[src] = group
    return mapping


def _rank(seed: int, group_id: str) -> str:
    return hashlib.sha256(f"{seed}:{group_id}".encode()).hexdigest()


def select_groups(path: str | Path, per_domain: int, seed: int = 0) -> dict[str, str]:
    """Draw `per_domain` groups per domain; return {source_id: group_id} for their members.

    The draw ranks groups by a hash of (seed, group id), so it does not depend on the
    NumPy version, and a smaller `per_domain` always picks a subset of a larger one.
    """
    if per_domain < 1:
        raise ValueError("per_domain must be >= 1")
    header = pd.read_csv(path, nrows=0).columns
    check_columns(header)
    columns = [c for c in ("id", "source_id", "model", "domain", "title") if c in header]
    meta = pd.read_csv(path, usecols=columns, **csv_read_options(header))
    canonical = canonical_groups(meta)
    human = meta[meta["model"] == "human"]
    domain_of = dict(zip(source_ids(human), human["domain"].astype(str), strict=True))
    groups_by_domain: dict[str, set[str]] = {}
    for src, group in canonical.items():
        groups_by_domain.setdefault(domain_of[src], set()).add(group)
    chosen: set[str] = set()
    for domain in sorted(groups_by_domain):
        ranked = sorted(groups_by_domain[domain], key=lambda g: _rank(seed, g))
        chosen.update(ranked[:per_domain])
    return {src: group for src, group in canonical.items() if group in chosen}


def read_sources(path: str | Path, sources: set[str], chunksize: int = 100_000) -> pd.DataFrame:
    """Every row (human or AI) coming from `sources`, read in chunks to save memory."""
    header = pd.read_csv(path, nrows=0).columns
    check_columns(header)
    usecols = [c for c in (*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS) if c in header]
    parts = [
        chunk[source_ids(chunk).isin(sources)]
        for chunk in pd.read_csv(
            path, usecols=usecols, chunksize=chunksize, **csv_read_options(header)
        )
    ]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=usecols)


def _dedup_key(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).casefold().encode()).hexdigest()


def drop_duplicates(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    """Keep one copy of exact duplicates (after whitespace/case folding).

    If copies carry different labels, all of them are dropped.
    """
    df = df.sort_values("id", kind="stable").reset_index(drop=True)
    keys = df["text"].map(_dedup_key)
    labels_per_key = df.groupby(keys)["label"].nunique()
    conflicting = keys.map(labels_per_key) > 1
    duplicate = keys.duplicated(keep="first") & ~conflicting
    stats = {
        "duplicates_dropped": int(duplicate.sum()),
        "conflicting_dropped": int(conflicting.sum()),
    }
    return df[~(duplicate | conflicting)].reset_index(drop=True), stats


def _jsonable(value: object) -> object:
    return value.item() if hasattr(value, "item") else str(value)


def content_sha256(df: pd.DataFrame) -> str:
    """Hash of every column of every row, independent of row order and parquet version."""
    columns = sorted(df.columns)
    rows = df.sort_values("id", kind="stable")[columns].astype(object)
    rows = rows.where(rows.notna(), None)
    h = hashlib.sha256(json.dumps(columns).encode())
    for record in rows.itertuples(index=False, name=None):
        h.update(json.dumps(record, ensure_ascii=False, default=_jsonable).encode() + b"\n")
    return h.hexdigest()


def build_raid_dataset(
    path: str | Path,
    per_domain: int = 500,
    seed: int = 0,
    chunksize: int = 100_000,
    name: str = "raid-v1",
) -> tuple[pd.DataFrame, dict]:
    members = select_groups(path, per_domain, seed)
    raw = read_sources(path, set(members), chunksize)
    docs = raid_to_documents(raw)
    if not docs:
        raise ValueError(f"no usable rows found in {path}")
    rows = []
    for d in docs:
        group = members.get(d.group_id, d.group_id)
        rows.append(
            {
                "id": d.id,
                "group_id": group,
                "split": assign_split(group),
                "label": d.label,
                "y": d.y,
                "source_dataset": d.source_dataset,
                "generator": d.generator,
                "decoding": d.decoding,
                "domain": d.domain,
                "language": d.language,
                "attack": d.attack,
                "n_words": d.n_words,
                "length_bucket": length_bucket(d.n_words),
                "text": d.text,
            }
        )
    df, dedup_stats = drop_duplicates(pd.DataFrame(rows))
    sources_per_group = Counter(members.values())
    largest_group, largest_size = max(sources_per_group.items(), key=lambda kv: (kv[1], kv[0]))
    if largest_size > LARGE_GROUP:
        warnings.warn(
            f"group {largest_group} merges {largest_size} human sources that share one title; "
            "check that this title is not a placeholder",
            stacklevel=2,
        )
    manifest = {
        "name": name,
        "source": Path(path).name,
        "params": {"per_domain": per_domain, "seed": seed, "split_weights": dict(DEFAULT_WEIGHTS)},
        "n_rows": len(df),
        "n_groups": int(df["group_id"].nunique()),
        "n_sources_merged_by_title": sum(1 for src, grp in members.items() if src != grp),
        "largest_group": {"group_id": largest_group, "n_sources": largest_size},
        "content_sha256": content_sha256(df),
        "dropped": {"empty_text": len(raw) - len(docs), **dedup_stats},
        "counts": {
            split: {k: int(v) for k, v in Counter(part["label"]).items()}
            for split, part in sorted(df.groupby("split"), key=lambda kv: kv[0])
        },
        "domains": {k: int(v) for k, v in sorted(Counter(df["domain"]).items())},
        "generators": {k: int(v) for k, v in sorted(Counter(df["generator"].dropna()).items())},
        "length_buckets": {k: int(v) for k, v in sorted(Counter(df["length_bucket"]).items())},
    }
    return df, manifest


def save_dataset(df: pd.DataFrame, manifest: dict, out: str | Path) -> tuple[Path, Path]:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    manifest_path = out.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    return out, manifest_path


def load_dataset(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found: run scripts/build_dataset.py first")
    return pd.read_parquet(path)
