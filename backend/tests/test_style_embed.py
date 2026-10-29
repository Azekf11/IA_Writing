import json

import numpy as np
import pytest

from aiwd.style.embed import (
    META_FILE,
    WEIGHTS_FILE,
    Embedder,
    normalize,
    quantize,
    write_artifacts,
)
from aiwd.style.ingest import batches, to_rows, vector_literal

# A tiny WordPiece tokenizer: five words plus the unknown token
TOKENIZER = {
    "version": "1.0",
    "truncation": None,
    "padding": None,
    "added_tokens": [],
    "normalizer": {
        "type": "BertNormalizer",
        "clean_text": True,
        "handle_chinese_chars": True,
        "strip_accents": None,
        "lowercase": True,
    },  # fmt: skip
    "pre_tokenizer": {"type": "BertPreTokenizer"},
    "post_processor": None,
    "decoder": None,
    "model": {
        "type": "WordPiece",
        "unk_token": "[UNK]",
        "continuing_subword_prefix": "##",
        "max_input_chars_per_word": 100,
        "vocab": {"[UNK]": 0, "the": 1, "cat": 2, "dog": 3, "sat": 4, "ran": 5},
    },
}


@pytest.fixture
def embedder(tmp_path):
    rng = np.random.default_rng(0)
    weights = rng.normal(size=(6, 8)).astype(np.float32)
    weights[0] = 0  # the unknown token carries no signal
    tokenizer = tmp_path / "tok.json"
    tokenizer.write_text(json.dumps(TOKENIZER))
    out = tmp_path / "emb"
    write_artifacts(out, weights, tokenizer, dim=8)
    return Embedder.load(out), out, weights


def test_quantize_round_trip_stays_close_and_handles_zero_rows():
    rng = np.random.default_rng(1)
    weights = rng.normal(size=(50, 32)).astype(np.float32)
    weights[3] = 0
    quantized, scales = quantize(weights, dim=16)
    assert quantized.shape == (50, 16) and quantized.dtype == np.int8
    assert np.all(scales > 0)
    restored = quantized.astype(np.float32) * scales[:, None]
    assert np.abs(restored - weights[:, :16]).max() < 0.05
    assert not restored[3].any()


def test_normalize_returns_unit_vectors_and_none_for_zero():
    assert float(np.linalg.norm(normalize(np.array([3.0, 4.0])))) == pytest.approx(1.0)
    assert normalize(np.zeros(4)) is None


def test_embed_gives_unit_vectors_and_ignores_word_order(embedder):
    emb, _, _ = embedder
    a, b = emb.embed("the cat sat"), emb.embed("sat the cat")
    assert float(np.linalg.norm(a)) == pytest.approx(1.0, abs=1e-5)
    assert np.allclose(a, b, atol=1e-6)


def test_similar_texts_score_higher_than_different_ones(embedder):
    emb, _, _ = embedder
    cat_sat = emb.embed("the cat sat")
    assert float(cat_sat @ emb.embed("cat cat sat")) > float(cat_sat @ emb.embed("dog ran"))


def test_text_without_known_tokens_has_no_embedding(embedder):
    emb, _, _ = embedder
    assert emb.embed("") is None
    assert emb.embed("zzzz") is None  # maps to [UNK], whose vector is zero


def test_load_detects_a_corrupted_file(embedder):
    _, out, _ = embedder
    (out / WEIGHTS_FILE).write_bytes(b"\x00" * (6 * 8))
    with pytest.raises(ValueError, match="checksum"):
        Embedder.load(out)


def test_manifest_lists_dimensions_and_checksums(embedder):
    _, out, _ = embedder
    meta = json.loads((out / META_FILE).read_text())
    assert meta["dim"] == 8 and meta["vocab"] == 6
    assert set(meta["sha256"]) == {"weights.i8", "scales.f32", "tokenizer.json"}


def test_vector_literal_matches_the_pgvector_text_format():
    assert vector_literal(np.array([0.5, -0.25], dtype=np.float32)) == "[0.500000,-0.250000]"


def test_to_rows_skips_passages_that_cannot_be_embedded(embedder):
    emb, _, _ = embedder
    base = dict(gutenberg_id=1, author="A", title="T", lang="en", kind="essay", n_words=3)
    passages = [dict(base, id="ok", text="the cat sat"), dict(base, id="bad", text="zzzz")]
    rows = list(to_rows(passages, emb))
    assert [row["id"] for row in rows] == ["ok"]
    assert rows[0]["embedding"].startswith("[") and rows[0]["embedding"].count(",") == 7


def test_batches_split_evenly_and_keep_the_remainder():
    sizes = [len(batch) for batch in batches(({"i": i} for i in range(7)), size=3)]
    assert sizes == [3, 3, 1]
