import pandas as pd
import pytest

from aiwd.style.commoncorpus import (
    LATEST_YEAR,
    credit_for,
    document_passages,
    fix_mojibake,
    select_documents,
    windows,
)
from aiwd.style.quality import build_vocabulary

SENTENCE = (
    "The old house stood at the end of the lane, and nobody had lived there for years. "
    "The garden was kept as if someone were expected to return."
)
DOC = " ".join([SENTENCE] * 30)


def meta(**overrides):
    row = dict(
        identifier="doc-1", collection="English-PD", open_type="Open Culture",
        license="Public Domain", date=1890.0, title="A Title", creator="Smith, John, 1820-1900",
        language="English", word_count=900,
    )  # fmt: skip
    row.update(overrides)
    return pd.DataFrame([row])


def test_fix_mojibake_repairs_utf8_read_as_latin1():
    broken = "métiers".encode().decode("latin-1")
    assert fix_mojibake(broken) == "métiers"
    assert fix_mojibake("déjà propre") == "déjà propre"


@pytest.mark.parametrize(
    ("change", "kept"),
    [
        ({}, True),
        ({"license": "Publc Domain"}, True),
        ({"license": "CC-By"}, False),
        ({"date": float(LATEST_YEAR + 1)}, False),
        ({"date": None}, False),
        ({"language": "German"}, False),
        ({"collection": "Gutenberg"}, False),
        ({"open_type": "Open Web"}, False),
        ({"word_count": 100}, False),
    ],
)
def test_select_documents(change, kept):
    assert (len(select_documents(meta(**change))) == 1) is kept


def test_select_documents_labels_language_and_kind():
    doc = select_documents(meta(collection="US-PD-Newspapers")).iloc[0]
    assert (doc["lang"], doc["kind"]) == ("en", "news")


def test_credit_prefers_author_then_title_then_origin():
    author = credit_for(meta().iloc[0])
    assert author == ("John Smith", "A Title")
    title_only = credit_for(meta(creator="None").iloc[0])
    assert title_only == ("A Title", "A Title")
    anonymous = credit_for(meta(title="None", creator=None, collection="US-PD-Newspapers").iloc[0])
    assert anonymous == ("US newspaper (1890)", "US newspaper, 1890")


def test_windows_cut_a_block_without_paragraph_breaks():
    pieces = windows(DOC)
    assert len(pieces) > 1
    assert all(45 <= len(piece.split()) <= 150 for piece in pieces)


def test_document_passages_are_deterministic_and_capped():
    vocab = build_vocabulary([DOC], min_count=2)
    a = document_passages(DOC, vocab, per_doc=3, key="k")
    assert a == document_passages(DOC, vocab, per_doc=3, key="k")
    assert 0 < len(a) <= 3


def test_document_passages_drop_noisy_text():
    vocab = build_vocabulary([DOC], min_count=2)
    noisy = " ".join(["Thf hou.sc stoud wlicrc aud nobodv liad lived tliere for ycars."] * 40)
    assert document_passages(noisy, vocab, per_doc=3, key="k") == []
