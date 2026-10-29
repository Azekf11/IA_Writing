"""Turn a raw Gutenberg book into clean, self-contained prose passages."""

from __future__ import annotations

import random
import re
from dataclasses import dataclass

MIN_WORDS = 45
MAX_WORDS = 150

_ILLUSTRATION = re.compile(r"\[(?:Illustration|Footnote|Transcriber|Note)[^\]]*\]", re.I | re.S)
_PAGE_MARK = re.compile(r"\[(?:Pg|Page)?\s*\d+\]", re.I)
_ITALIC = re.compile(r"(?<![\w])_([^_\n]+)_(?![\w])")
_SENTENCE_END = re.compile(r"(?<=[.!?…»\"”’])\s+(?=[\"“«‘'—\-]?[A-ZÀ-Ý])")
_HEADING = re.compile(r"^(chapter|book|part|volume|livre|chapitre|partie|tome|section)\b", re.I)
_URL = re.compile(r"https?://|www\.|@\w+\.")
# Editor markup: underscores, brackets, footnote markers, asterisks, SHOUTED words
_NOISE = re.compile(r"[_\[\]{}*^]|\b[A-ZÀ-Ý]{4,}\b")


def clean_book(text: str) -> str:
    """Remove markup that Gutenberg editors add around the author's own words."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _ILLUSTRATION.sub(" ", text)
    text = _PAGE_MARK.sub("", text)
    text = _ITALIC.sub(r"\1", text)
    return text


def paragraphs(text: str) -> list[str]:
    """Blank-line separated blocks, with hard-wrapped lines joined."""
    blocks = re.split(r"\n\s*\n", text)
    return [" ".join(block.split()) for block in blocks if block.strip()]


def word_count(text: str) -> int:
    return len(text.split())


def is_prose(paragraph: str) -> bool:
    """Reject headings, verse, tables of contents, notes and dialogue fragments."""
    if _URL.search(paragraph) or _NOISE.search(paragraph) or _HEADING.match(paragraph):
        return False
    letters = sum(ch.isalpha() for ch in paragraph)
    if letters / max(len(paragraph), 1) < 0.78:
        return False
    upper = sum(ch.isupper() for ch in paragraph)
    if upper / max(letters, 1) > 0.12:
        return False
    if paragraph[-1] not in '.!?…"”»’':
        return False
    # Lines that are mostly short quoted exchanges read as dialogue, not as style samples
    quotes = sum(paragraph.count(q) for q in ('"', "“", "«", "—"))
    return quotes / max(word_count(paragraph), 1) < 0.06


def split_long(paragraph: str, max_words: int = MAX_WORDS) -> list[str]:
    """Cut a long paragraph at sentence boundaries into windows of at most `max_words`."""
    if word_count(paragraph) <= max_words:
        return [paragraph]
    pieces: list[str] = []
    current: list[str] = []
    for sentence in _SENTENCE_END.split(paragraph):
        if current and word_count(" ".join(current + [sentence])) > max_words:
            pieces.append(" ".join(current))
            current = []
        current.append(sentence)
    if current:
        pieces.append(" ".join(current))
    return pieces


def candidates(text: str, min_words: int = MIN_WORDS, max_words: int = MAX_WORDS) -> list[str]:
    """All usable passages of a book, in reading order."""
    body = paragraphs(clean_book(text))
    # Front and back matter (contents, prefaces, indexes) sit at the edges
    cut = max(len(body) // 20, 1)
    out: list[str] = []
    for paragraph in body[cut:-cut]:
        for piece in split_long(paragraph, max_words):
            if min_words <= word_count(piece) <= max_words and is_prose(piece):
                out.append(piece)
    return out


@dataclass(frozen=True)
class Passage:
    book_id: int
    position: int
    text: str


def spread(pool_size: int, per: int, key: str) -> list[int]:
    """`per` indices spread across `pool_size` items, the same ones on every run."""
    if pool_size <= per:
        return list(range(pool_size))
    rng = random.Random(key)
    # One pick per equal slice keeps the beginning, middle and end represented
    edges = [round(i * pool_size / per) for i in range(per + 1)]
    return [rng.randrange(a, max(b, a + 1)) for a, b in zip(edges, edges[1:], strict=False)]


def sample_passages(book_id: int, text: str, per_book: int, seed: int = 0) -> list[Passage]:
    """`per_book` passages spread across the whole book, the same ones on every run."""
    pool = candidates(text)
    return [Passage(book_id, i, pool[i]) for i in spread(len(pool), per_book, f"{seed}-{book_id}")]
