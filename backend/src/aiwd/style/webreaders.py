"""Read articles from the two open web datasets, one dict per article.

English: one cached shard of C4 "realnewslike" (30 MB). French: a few row groups from several
FineWeb-2 files, streamed, so nothing large is stored on disk.
"""

from __future__ import annotations

import gzip
import json
import ssl
import urllib.request
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed

import certifi
import pyarrow.parquet as pq
from huggingface_hub import HfFileSystem, hf_hub_download

from aiwd.style.clean import spread
from aiwd.style.web import LATEST_CRAWL_YEAR, SITES_EN, SITES_FR, allowed_site, crawl_year

FW2 = "HuggingFaceFW/fineweb-2"
FW2_TREE = f"https://huggingface.co/api/datasets/{FW2}/tree/main/data/fra_Latn/train"


def english_articles(limit: int, shards: int = 3) -> Iterator[dict]:
    """Articles from the first `shards` C4 realnewslike files, `limit` rows read in total."""
    read = 0
    for shard in range(shards):
        name = f"realnewslike/c4-train.{shard:05d}-of-00512.json.gz"
        with gzip.open(hf_hub_download("allenai/c4", name, repo_type="dataset"), "rt") as handle:
            for line in handle:
                if read >= limit:
                    return
                row = json.loads(line)
                ident = f"c4-{shard}-{read}"
                read += 1
                if allowed_site(row["url"], SITES_EN):
                    year = int(row["timestamp"][:4])
                    yield dict(url=row["url"], text=row["text"], year=year, id=ident)


def french_file_names(files: int) -> list[str]:
    """FineWeb-2 files spread over the whole dataset: they cover different crawl years."""
    context = ssl.create_default_context(cafile=certifi.where())
    request = urllib.request.Request(FW2_TREE, headers={"User-Agent": "rewrity-corpus-builder"})
    with urllib.request.urlopen(request, timeout=30, context=context) as response:
        names = sorted(entry["path"] for entry in json.load(response))
    step = (len(names) - 1) / max(files - 1, 1)
    return [names[round(i * step)] for i in range(files)]


def _read_file(name: str, groups_per_file: int) -> list[dict]:
    """News pages from a few spread-out row groups of one FineWeb-2 file."""
    out: list[dict] = []
    fs = HfFileSystem()
    with fs.open(f"datasets/{FW2}/{name}", "rb", block_size=8 * 1024 * 1024) as handle:
        parquet = pq.ParquetFile(handle)
        total = parquet.metadata.num_row_groups
        for group in spread(total, groups_per_file, f"fw2-{name}"):
            table = parquet.read_row_group(group, columns=["url", "dump", "text", "id"])
            for row in table.to_pylist():
                year = crawl_year(row["dump"])
                if not year or year > LATEST_CRAWL_YEAR:
                    continue
                if allowed_site(row["url"], SITES_FR):
                    ident = f"fw2-{row['id']}"
                    out.append(dict(url=row["url"], text=row["text"], year=year, id=ident))
    return out


def french_articles(files: int, groups_per_file: int, workers: int = 6) -> Iterator[dict]:
    """Files are read in parallel: each one spends most of its time waiting on the network.

    Results come back as each file finishes, so the build can stop early once it has enough.
    """
    names = french_file_names(files)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_read_file, name, groups_per_file) for name in names]
        for done, future in enumerate(as_completed(futures), start=1):
            try:
                batch = future.result()
            except Exception as error:  # one slow or failing file must not sink the build
                print(f"  fr file {done}/{len(names)} skipped: {type(error).__name__}", flush=True)
                continue
            print(f"  fr file {done}/{len(names)}: {len(batch)} news pages", flush=True)
            yield from batch
        for future in futures:
            future.cancel()
