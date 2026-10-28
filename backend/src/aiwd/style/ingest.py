"""Embed the style passages and load them into Supabase through PostgREST."""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from collections.abc import Iterable, Iterator
from pathlib import Path

import certifi
import numpy as np

from aiwd.style.embed import Embedder

BATCH = 100


def read_passages(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def vector_literal(vector: np.ndarray) -> str:
    """pgvector text format, with enough digits to survive the round trip."""
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"


def to_rows(passages: Iterable[dict], embedder: Embedder) -> Iterator[dict]:
    """Database rows, skipping any passage the tokenizer cannot embed."""
    for passage in passages:
        vector = embedder.embed(passage["text"])
        if vector is None:
            continue
        yield dict(
            id=passage["id"],
            gutenberg_id=passage["gutenberg_id"],
            author=passage["author"],
            title=passage["title"],
            lang=passage["lang"],
            kind=passage["kind"],
            n_words=passage["n_words"],
            body=passage["text"],
            embedding=vector_literal(vector),
        )  # fmt: skip


def batches(rows: Iterable[dict], size: int = BATCH) -> Iterator[list[dict]]:
    batch: list[dict] = []
    for row in rows:
        batch.append(row)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def upsert(base_url: str, secret_key: str, batch: list[dict]) -> None:
    """Insert or update a batch. Re-running the ingestion is safe."""
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/rest/v1/style_passages?on_conflict=id",
        data=json.dumps(batch).encode(),
        method="POST",
        headers={
            "apikey": secret_key,
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    # Some Python installs ship without root certificates, so use certifi's bundle
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        urllib.request.urlopen(request, timeout=120, context=context).read()
    except urllib.error.HTTPError as error:
        # The body says which column or constraint failed
        raise RuntimeError(f"upsert failed: {error.code} {error.read().decode()[:300]}") from error
