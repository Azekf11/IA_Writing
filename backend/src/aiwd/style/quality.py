"""Reject OCR noise before it reaches the style corpus.

Digitized newspapers and old books are full of recognition errors ("thf", "fifsident").
The checks are cheap word-level statistics, so they work in English and French without a model.

Known blind spot: scrambled text made of real words (a poem whose columns were read across)
passes every word-level check. A word-pair check was tried and could not tell it apart from
real prose, so it is not used.
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path

_WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*", re.UNICODE)
_JUNK_CHARS = re.compile(r"[^\w\s.,;:!?'’\"“”«»()\-—–…%$&/]")
_ALTERNATING_CASE = re.compile(r"\b\w*[a-zà-ÿ][A-ZÀ-Ý]\w*\b")
_REPEATED = re.compile(r"(.)\1{3,}")
_SENTENCE_END = re.compile(r"[.!?…]+[\"”»’)]*\s+")
_BROKEN_WORD = re.compile(r"([^\W\d_]+)-\s+([a-zà-ÿ]+)")
# Accents that do not occur in French or English prose: a sign of misread letters
_STRANGE_ACCENTS = re.compile(r"[áíóúñãõýåøščřž]")

DATA_DIR = Path(__file__).resolve().parents[3] / "data" / "style"

# Measured on held-out Gutenberg books: these keep ~96% of English and ~90% of French prose
MIN_COMMON_RATIO = 0.35
MAX_UNKNOWN_RATIO = 0.10
MAX_SHORT_FRAGMENT_RATIO = 0.22
MAX_JUNK_CHARS_PER_100 = 1.5

Vocabulary = frozenset[str] | set[str]


def fold(word: str) -> str:
    """Lowercase without accents, so "été" and "ete" count as the same word."""
    decomposed = unicodedata.normalize("NFD", word.lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def words(text: str) -> list[str]:
    return _WORD.findall(text)


def build_vocabulary(texts, top: int = 40000, min_count: int = 3) -> set[str]:
    """Most frequent folded words of a body of clean text: the notion of 'a real word'."""
    counts: Counter[str] = Counter()
    for text in texts:
        counts.update(fold(w) for w in words(text))
    return {w for w, n in counts.most_common(top) if n >= min_count and len(w) > 1}


@lru_cache(maxsize=4)
def load_vocabulary(lang: str, directory: Path = DATA_DIR) -> frozenset[str]:
    path = directory / f"vocab_{lang}.txt"
    return frozenset(path.read_text(encoding="utf-8").split())


def noise_report(text: str, vocabulary: Vocabulary) -> dict[str, float]:
    tokens = words(text)
    n = max(len(tokens), 1)
    folded = [fold(t) for t in tokens]
    known = sum(t in vocabulary for t in folded)
    # Longer words that are not in the vocabulary: the signature of OCR garbage
    unknown_long = sum(t not in vocabulary and len(t) >= 4 for t in folded)
    short_fragments = sum(len(t) <= 2 and t not in vocabulary for t in folded)
    return {
        "common_ratio": known / n,
        "unknown_ratio": unknown_long / n,
        "fragment_ratio": short_fragments / n,
        "junk_per_100": 100 * len(_JUNK_CHARS.findall(text)) / max(len(text), 1),
        "bad_case_words": len(_ALTERNATING_CASE.findall(text)),
        "repeats": len(_REPEATED.findall(text)),
    }


def is_clean(text: str, vocabulary: Vocabulary) -> bool:
    r = noise_report(text, vocabulary)
    return (
        r["common_ratio"] >= MIN_COMMON_RATIO
        and r["unknown_ratio"] <= MAX_UNKNOWN_RATIO
        and r["fragment_ratio"] <= MAX_SHORT_FRAGMENT_RATIO
        and r["junk_per_100"] <= MAX_JUNK_CHARS_PER_100
        and r["bad_case_words"] == 0
        and r["repeats"] == 0
    )


def is_running_prose(text: str) -> bool:
    """Sentences, not a price list, a table of names or a classified ad."""
    sentences = [part for part in _SENTENCE_END.split(text.strip()) if part.strip()]
    if len(sentences) < 2:
        return False
    if not 6 <= len(words(text)) / len(sentences) <= 45:
        return False
    if sum(ch.isdigit() for ch in text) / max(len(text), 1) > 0.02:
        return False
    tokens = text.split()
    capitalized = sum(token[:1].isupper() for token in tokens[1:])
    return capitalized / max(len(tokens) - 1, 1) <= 0.30


def dehyphenate(text: str, vocabulary: Vocabulary) -> str:
    """Glue words that were split across lines ("tra- versing" -> "traversing").

    When the glued word is unknown the hyphen stays, minus the space ("peut- être" -> "peut-être").
    """

    def join(match: re.Match[str]) -> str:
        left, right = match.group(1), match.group(2)
        return left + right if fold(left + right) in vocabulary else f"{left}-{right}"

    return _BROKEN_WORD.sub(join, text)


def has_strange_accents(text: str) -> bool:
    return len(_STRANGE_ACCENTS.findall(text)) >= 2
