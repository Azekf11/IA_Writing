"""Read Project Gutenberg plain-text books that are already on disk.

Gutenberg asks for human browsing only: automated downloads from the website can get an IP
blocked. Get the files through one of their sanctioned routes (robot/harvest, or a mirror, see
https://www.gutenberg.org/policy/robot_access.html) and save each one as <id>.txt in one folder.
"""

from __future__ import annotations

import re
from pathlib import Path

_START = re.compile(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*", re.I)
_END = re.compile(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK", re.I)


def strip_boilerplate(raw: str) -> str:
    """The book itself, without the Gutenberg license header and footer."""
    start, end = _START.search(raw), _END.search(raw)
    if not start or not end or end.start() <= start.end():
        raise ValueError("Gutenberg start/end markers not found")
    return raw[start.end() : end.start()]


def read_book(gutenberg_id: int, directory: Path) -> str:
    """Raw text of a book saved as <id>.txt in `directory`."""
    path = directory / f"{gutenberg_id}.txt"
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} is missing. Fetch it through a route Gutenberg allows "
            "(see the module docstring), not with a script against the website."
        )
    return path.read_text(encoding="utf-8")
