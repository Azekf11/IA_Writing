"""Write the vectors that the TypeScript embedder is tested against.

Usage (from corpus-pipeline/), after export_embedder.py:
    uv run python scripts/export_parity_fixture.py

frontend/tests/embedder.test.ts embeds the same texts in TypeScript and fails when a value
differs by 1e-4 or more. That keeps the query vectors (TypeScript, per request) and the stored
corpus vectors (Python, ingest_style.py) in the same space, as long as this file is regenerated
after any change to embed.py: no check does that.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aiwd.style.embed import Embedder

ROOT = Path(__file__).resolve().parents[2]

# Plain prose in both languages, punctuation and accents the tokenizer must handle, and digits
TEXTS = [
    "The quick brown fox jumps over the lazy dog.",
    "Il regardait la pluie tomber sur la ville et songeait à sa mère.",
    "It is crucial to understand that liberty plays a pivotal role.",
    "Café crème, naïve façade; été — « quoi ? »",
    "1984 was a year. 42!",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedder", default=str(ROOT / "frontend/data/embedder"))
    parser.add_argument("--out", default=str(ROOT / "frontend/tests/fixtures/embedder-parity.json"))
    args = parser.parse_args()

    embedder = Embedder.load(Path(args.embedder))
    cases = []
    for text in TEXTS:
        vector = embedder.embed(text)
        if vector is None:
            raise SystemExit(f"cannot embed {text!r}")
        cases.append({"text": text, "vector": [round(float(v), 6) for v in vector]})

    out = Path(args.out)
    out.write_text(json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(cases)} vectors of {embedder.dim} dims -> {out}")


if __name__ == "__main__":
    main()
