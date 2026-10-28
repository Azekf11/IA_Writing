"""Static multilingual embeddings, shrunk to fit a serverless function.

The model (sentence-transformers/static-similarity-mrl-multilingual-v1) averages one learned
vector per token. It was trained with Matryoshka loss, so keeping the first 256 of its 1024
dimensions loses little. Rows are then stored as int8 with one scale each (~27 MB instead of
433 MB). The same files are read here and by the Next.js route, so both compute identical
vectors: tokenize, average the rows, L2-normalize.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer

MODEL_ID = "sentence-transformers/static-similarity-mrl-multilingual-v1"
DIM = 256

WEIGHTS_FILE = "weights.i8"
SCALES_FILE = "scales.f32"
TOKENIZER_FILE = "tokenizer.json"
META_FILE = "meta.json"


def quantize(weights: np.ndarray, dim: int = DIM) -> tuple[np.ndarray, np.ndarray]:
    """First `dim` columns as int8 plus one float32 scale per row."""
    rows = np.ascontiguousarray(weights[:, :dim], dtype=np.float32)
    scales = np.abs(rows).max(axis=1) / 127.0
    # An all-zero row keeps scale 1 so that dividing never produces NaN
    scales[scales == 0] = 1.0
    quantized = np.clip(np.rint(rows / scales[:, None]), -127, 127).astype(np.int8)
    return quantized, scales.astype(np.float32)


def normalize(vector: np.ndarray) -> np.ndarray | None:
    norm = float(np.linalg.norm(vector))
    return None if norm == 0.0 else (vector / norm).astype(np.float32)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_artifacts(
    out_dir: Path, weights: np.ndarray, tokenizer_json: Path, dim: int = DIM
) -> dict:
    """Write the int8 table, the scales, the tokenizer and a manifest with checksums."""
    out_dir.mkdir(parents=True, exist_ok=True)
    quantized, scales = quantize(weights, dim)
    (out_dir / WEIGHTS_FILE).write_bytes(quantized.tobytes())
    (out_dir / SCALES_FILE).write_bytes(scales.astype("<f4").tobytes())
    (out_dir / TOKENIZER_FILE).write_bytes(tokenizer_json.read_bytes())
    files = (WEIGHTS_FILE, SCALES_FILE, TOKENIZER_FILE)
    meta = {
        "model": MODEL_ID,
        "dim": dim,
        "vocab": int(weights.shape[0]),
        "sha256": {name: sha256(out_dir / name) for name in files},
    }
    (out_dir / META_FILE).write_text(json.dumps(meta, indent=2) + "\n")
    return meta


@dataclass
class Embedder:
    tokenizer: Tokenizer
    quantized: np.ndarray  # (vocab, dim) int8
    scales: np.ndarray  # (vocab,) float32

    @classmethod
    def load(cls, directory: Path) -> Embedder:
        meta = json.loads((directory / META_FILE).read_text())
        dim, vocab = meta["dim"], meta["vocab"]
        for name, expected in meta["sha256"].items():
            if sha256(directory / name) != expected:
                raise ValueError(f"{name} does not match its checksum in {META_FILE}")
        quantized = np.frombuffer((directory / WEIGHTS_FILE).read_bytes(), dtype=np.int8)
        scales = np.frombuffer((directory / SCALES_FILE).read_bytes(), dtype="<f4")
        return cls(
            Tokenizer.from_file(str(directory / TOKENIZER_FILE)),
            quantized.reshape(vocab, dim),
            scales.astype(np.float32),
        )

    @property
    def dim(self) -> int:
        return self.quantized.shape[1]

    def embed(self, text: str) -> np.ndarray | None:
        """Unit vector for `text`, or None when it holds no known token."""
        ids = self.tokenizer.encode(text, add_special_tokens=False).ids
        if not ids:
            return None
        rows = self.quantized[ids].astype(np.float32) * self.scales[ids, None]
        return normalize(rows.mean(axis=0))

    def embed_many(self, texts: list[str]) -> list[np.ndarray | None]:
        return [self.embed(text) for text in texts]
