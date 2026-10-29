"""Turn Common Corpus (Pleias) documents into clean style passages.

Common Corpus is an open dataset of public-domain books and newspapers, with one licence and
one date per document. Its texts are OCR output, so most of the work here is rejecting noise.
Only documents with a known date up to LATEST_YEAR are used, which keeps every source
comfortably old enough to be in the public domain.
"""

from __future__ import annotations

import hashlib

import pandas as pd

from aiwd.style.catalog import parse_author
from aiwd.style.clean import (
    MAX_WORDS,
    MIN_WORDS,
    clean_book,
    is_prose,
    paragraphs,
    split_long,
    spread,
    word_count,
)
from aiwd.style.quality import dehyphenate, has_strange_accents, is_clean, is_running_prose

LATEST_YEAR = 1950
MIN_DOC_WORDS = 500

LANGUAGES = {"English": "en", "French": "fr"}
# The dataset spells it "Publc Domain" in a few rows
PUBLIC_DOMAIN = {"Public Domain", "Publc Domain"}

# Collection -> kind. Gutenberg is left out: those books are already in the corpus.
KIND_BY_COLLECTION = {
    "English-PD": "book",
    "US-PD-Books": "book",
    "LoC-PD-Books": "book",
    "French-PD-Books": "book",
    "French-PD-diverse": "book",
    "Wikisource": "book",
    "Europeana": "book",
    "US-PD-Newspapers": "news",
    "French-PD-Newspapers": "news",
    "NewZealand-PD-Newspapers": "news",
}

# Newspapers rarely carry a title, so they are credited by origin and year
NEWS_LABEL = {
    "US-PD-Newspapers": "US newspaper",
    "NewZealand-PD-Newspapers": "New Zealand newspaper",
    "French-PD-Newspapers": "Presse fran\u00e7aise",
}

COLUMNS = [
    "identifier", "collection", "open_type", "license", "date", "title", "creator", "language",
    "word_count",
]  # fmt: skip


def fix_mojibake(text: str) -> str:
    """Repair UTF-8 that was read as Latin-1 (\"m\u00c3\u00a9tiers\" -> \"m\u00e9tiers\")."""
    if "\u00c3" not in text and "\u00c2" not in text:
        return text
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def select_documents(meta: pd.DataFrame) -> pd.DataFrame:
    """Documents worth reading: open-licence books and papers, en/fr, dated, old enough."""
    keep = (
        (meta["open_type"] == "Open Culture")
        & meta["language"].isin(LANGUAGES)
        & meta["license"].isin(PUBLIC_DOMAIN)
        & meta["collection"].isin(KIND_BY_COLLECTION)
        & meta["date"].notna()
        & (meta["date"] <= LATEST_YEAR)
        & (meta["word_count"] >= MIN_DOC_WORDS)
    )
    docs = meta[keep].copy()
    docs["lang"] = docs["language"].map(LANGUAGES)
    docs["kind"] = docs["collection"].map(KIND_BY_COLLECTION)
    return docs


def _clean_value(value: object) -> str:
    text = "" if value is None or (isinstance(value, float) and value != value) else str(value)
    return "" if text.strip() in ("", "None") else fix_mojibake(text.strip())


def credit_for(row: pd.Series) -> tuple[str, str]:
    """(credit, title) shown to the user: the author, else the title, else the origin."""
    title = _clean_value(row["title"])
    creator = _clean_value(row["creator"]).split("|")[0]
    if creator:
        name, _ = parse_author(creator)
        if name:
            return name, title or name
    if title:
        return title, title
    label = NEWS_LABEL.get(row["collection"], "Book")
    year = int(row["date"])
    return f"{label} ({year})", f"{label}, {year}"


def windows(text: str, min_words: int = MIN_WORDS, max_words: int = MAX_WORDS) -> list[str]:
    """Candidate passages of one document, in reading order.

    Newspaper OCR often has no paragraph breaks, so a whole page can be one block:
    it is cut at sentence boundaries like any long paragraph.
    """
    out: list[str] = []
    for paragraph in paragraphs(clean_book(text)):
        for piece in split_long(paragraph, max_words):
            if min_words <= word_count(piece) <= max_words:
                out.append(piece)
    return out


def reject_reason(passage: str, vocabulary: frozenset[str] | set[str]) -> str | None:
    """Why a passage is unusable, or None when it is fine."""
    if not is_prose(passage):
        return "not prose"
    if not is_running_prose(passage):
        return "list or table"
    if has_strange_accents(passage):
        return "misread letters"
    if not is_clean(passage, vocabulary):
        return "ocr noise"
    return None


def document_passages(
    text: str, vocabulary: frozenset[str] | set[str], per_doc: int, key: str
) -> list[str]:
    """Up to `per_doc` clean passages spread across one document, the same on every run."""
    candidates = windows(dehyphenate(text, vocabulary))
    pool = [w for w in candidates if reject_reason(w, vocabulary) is None]
    return [pool[i] for i in spread(len(pool), per_doc, key)]


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
