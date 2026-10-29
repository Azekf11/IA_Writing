"""Load RAID (Dugan et al., ACL 2024) into the unified Document schema.

Files (https://github.com/liamdugan/raid): train_none.csv is ~802 MB, train.csv
(with adversarial attacks) ~11.8 GB and is not meant to be loaded on a laptop.
They are cached in ~/.cache/raid/ (override with RAID_CACHE_DIR); a cached file is
read without any network access. You can also download a file yourself, e.g.
`curl -O https://dataset.raid-bench.xyz/train_none.csv`, and pass `path=`.
"""

from __future__ import annotations

import math
import os
import shutil
import warnings
from pathlib import Path
from urllib.request import urlopen

import pandas as pd

from aiwd.data.schema import Document

RAID_URL = "https://dataset.raid-bench.xyz"
REQUIRED_COLUMNS = ("id", "model", "generation", "domain", "attack")
OPTIONAL_COLUMNS = ("source_id", "decoding", "repetition_penalty")
DOMAIN_LANGUAGE = {"czech": "cs", "german": "de", "code": "zxx"}


def cache_dir() -> Path:
    return Path(os.getenv("RAID_CACHE_DIR", "~/.cache/raid")).expanduser()


def raid_filename(split: str, include_adversarial: bool) -> str:
    if split not in ("train", "test", "extra"):
        raise ValueError("split must be one of 'train', 'test', 'extra'")
    return f"{split}.csv" if include_adversarial else f"{split}_none.csv"


def download_raid(split: str = "train", include_adversarial: bool = False) -> Path:
    """Return the cached CSV path, downloading it first if it is not there yet."""
    target = cache_dir() / raid_filename(split, include_adversarial)
    if target.is_file():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".part")
    url = f"{RAID_URL}/{target.name}"
    print(f"Downloading {url} to {target}")
    with urlopen(url) as response, open(partial, "wb") as f:
        shutil.copyfileobj(response, f, length=1 << 20)
    partial.rename(target)
    return target


def check_columns(columns) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise ValueError(
            f"RAID data is missing columns {missing}; the RAID test split has no labels"
        )


def _clean(value: object) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def raid_to_documents(df: pd.DataFrame) -> list[Document]:
    check_columns(df.columns)
    keep = df["generation"].notna() & df["generation"].astype(str).str.strip().ne("")
    if (~keep).any():
        warnings.warn(f"dropped {(~keep).sum()} RAID rows with an empty generation", stacklevel=2)
    has_source = "source_id" in df.columns
    docs = []
    for row in df[keep].itertuples(index=False):
        is_human = row.model == "human"
        source = _clean(row.source_id) if has_source else None
        decoding = None
        if not is_human:
            parts = [_clean(getattr(row, "decoding", None))]
            rep = _clean(getattr(row, "repetition_penalty", None))
            if rep is not None:
                parts.append(f"rep_penalty={rep}")
            decoding = "|".join(p for p in parts if p) or None
        domain = _clean(row.domain)
        docs.append(
            Document(
                id=str(row.id),
                text=str(row.generation),
                label="human" if is_human else "ai",
                source_dataset="raid",
                group_id=source or str(row.id),
                generator=None if is_human else str(row.model),
                decoding=decoding,
                domain=domain,
                language=DOMAIN_LANGUAGE.get(domain or "", "en"),
                attack=_clean(row.attack) or "none",
                created_before_cutoff=None,
                license="RAID (MIT); human text under its original source terms"
                if is_human
                else "RAID (MIT)",
            )
        )
    return docs


def csv_read_options(header) -> dict:
    """Read ids and titles as text, and treat only empty cells as missing.

    Without this, pandas may turn an id like "007" into 7.0, and the guessed type can
    differ between chunks of the same file.
    """
    text_columns = ("id", "source_id", "adv_source_id", "title", "generation")
    return {
        "dtype": {c: str for c in text_columns if c in header},
        "keep_default_na": False,
        "na_values": [""],
    }


def read_raid_csv(path: str | Path) -> pd.DataFrame:
    """Read only the columns we use, which keeps memory reasonable on train_none.csv."""
    header = pd.read_csv(path, nrows=0).columns
    check_columns(header)
    usecols = [c for c in (*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS) if c in header]
    return pd.read_csv(path, usecols=usecols, **csv_read_options(header))


def load_raid(
    split: str = "train",
    include_adversarial: bool = False,
    sample_per_domain: int | None = None,
    seed: int = 0,
    path: str | Path | None = None,
) -> list[Document]:
    """Load a RAID split; optionally keep `sample_per_domain` human and AI rows per domain."""
    csv_path = Path(path).expanduser() if path else download_raid(split, include_adversarial)
    df = read_raid_csv(csv_path)
    if sample_per_domain is not None:
        df = sample_balanced(df, sample_per_domain, seed)
    return raid_to_documents(df)


def sample_balanced(df: pd.DataFrame, per_domain: int, seed: int = 0) -> pd.DataFrame:
    """Up to `per_domain` human rows and `per_domain` AI rows for each domain."""
    check_columns(df.columns)
    is_human = df["model"] == "human"
    parts = []
    for _, group in df.groupby([df["domain"], is_human], sort=True):
        parts.append(group.sample(n=min(per_domain, len(group)), random_state=seed))
    return pd.concat(parts).reset_index(drop=True)
