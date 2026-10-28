import pytest

from aiwd.style.clean import (
    candidates,
    clean_book,
    is_prose,
    paragraphs,
    sample_passages,
    split_long,
    word_count,
)

PROSE = (
    "The morning was grey and quiet, and the old house stood where it had always stood, "
    "at the end of the lane, with its shutters closed against the wind. Nobody had lived "
    "there for years, yet the garden was kept as if someone were expected to return."
)


def test_paragraphs_join_hard_wrapped_lines():
    text = "first line\nsecond line\n\n\nnext block\n"
    assert paragraphs(text) == ["first line second line", "next block"]


def test_clean_book_drops_editor_markup_but_keeps_the_words():
    raw = "A [Illustration: a cat] _very_ [Pg 12]good day."
    assert " ".join(clean_book(raw).split()) == "A very good day."


def test_is_prose_accepts_a_normal_paragraph():
    assert is_prose(PROSE)


@pytest.mark.parametrize(
    "bad",
    [
        "CHAPTER I. Down the rabbit hole and what came of it afterwards",
        "See https://example.com for the full text of this very long license and more" + ".",
        "THE END OF THE FIRST PART OF THE STORY AND THE START OF THE SECOND ONE.",
        "A note_with_underscores that should never reach a style corpus at all, sorry.",
        "No final punctuation here, so it is probably a title or a cut-off line",
        '"Yes," said he. "No," said she. "Why?" "Because." "Oh." "Well." "So." "Fine."',
    ],
)
def test_is_prose_rejects_non_prose(bad):
    assert not is_prose(bad)


def test_split_long_cuts_on_sentence_boundaries_within_the_limit():
    sentence = "This is a sentence of exactly ten words, no more, no less. "
    paragraph = (sentence * 30).strip()
    pieces = split_long(paragraph, max_words=60)
    assert len(pieces) > 1
    assert all(word_count(piece) <= 60 for piece in pieces)
    assert " ".join(pieces) == paragraph


def test_split_long_leaves_short_paragraphs_alone():
    assert split_long(PROSE, max_words=150) == [PROSE]


def _book(n: int) -> str:
    return "\n\n".join(f"{PROSE} Number {i} closes the paragraph properly." for i in range(n))


def test_candidates_skip_front_and_back_matter():
    pool = candidates(_book(100))
    assert 0 < len(pool) < 100


def test_sample_passages_are_deterministic_and_spread_out():
    book = _book(200)
    a = sample_passages(1, book, per_book=10, seed=3)
    b = sample_passages(1, book, per_book=10, seed=3)
    assert a == b
    assert len(a) == 10
    positions = [p.position for p in a]
    assert positions == sorted(positions)
    assert positions[-1] - positions[0] > 100


def test_sample_passages_differ_with_the_seed():
    book = _book(200)
    assert sample_passages(1, book, 10, seed=1) != sample_passages(1, book, 10, seed=2)


def test_sample_passages_returns_everything_for_a_short_book():
    assert len(sample_passages(1, _book(8), per_book=50)) <= 8
