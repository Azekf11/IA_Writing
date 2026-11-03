"""Project Gutenberg catalog: look a book up and check its author is in the public domain."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

# Authors who died before this year are in the public domain in the EU (life + 70 years)
LATEST_DEATH_YEAR = 1955

_DATES = re.compile(r"(\d{4})\s*-\s*(\d{4})")
_ROLE = re.compile(r"\[[^\]]+\]")
_PARENS = re.compile(r"\([^)]*\)")


@dataclass(frozen=True)
class Book:
    gutenberg_id: int
    title: str
    author: str
    lang: str
    death_year: int | None

    @property
    def public_domain(self) -> bool:
        return self.death_year is not None and self.death_year <= LATEST_DEATH_YEAR


def parse_author(raw: str) -> tuple[str, int | None]:
    """First credited author and death year, from 'Austen, Jane, 1775-1817; Other [Editor]'."""
    first = _ROLE.sub("", raw.split(";")[0]).strip()
    match = _DATES.search(first)
    death = int(match.group(2)) if match else None
    name = _PARENS.sub("", _DATES.sub("", first)).strip(" ,")
    if "," in name:
        last, given = name.split(",", 1)
        name = f"{given.strip()} {last.strip()}"
    return " ".join(name.split()), death


def short_title(raw: str) -> str:
    """Title without subtitle or edition notes."""
    first_line = raw.split("\n")[0]
    return re.split(r":| — ", first_line)[0].strip()


def load_catalog(path: Path) -> dict[int, Book]:
    """Every text in the catalog, keyed by Gutenberg id."""
    csv.field_size_limit(10**8)
    books: dict[int, Book] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["Type"] != "Text":
                continue
            author, death = parse_author(row["Authors"])
            gid = int(row["Text#"])
            books[gid] = Book(gid, short_title(row["Title"]), author, row["Language"], death)
    return books
