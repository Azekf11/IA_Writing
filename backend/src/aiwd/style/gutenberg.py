"""Download plain-text books from Project Gutenberg, politely and with a local cache."""

from __future__ import annotations

import re
import ssl
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

import certifi

URL = "https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt"
USER_AGENT = "IA_Writing style corpus builder (https://github.com/Azekf11/IA_Writing)"
# Gutenberg asks robots to stay gentle
PAUSE_SECONDS = 1.5

_START = re.compile(r"\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*", re.I)
_END = re.compile(r"\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK", re.I)


def strip_boilerplate(raw: str) -> str:
    """The book itself, without the Gutenberg license header and footer."""
    start, end = _START.search(raw), _END.search(raw)
    if not start or not end or end.start() <= start.end():
        raise ValueError("Gutenberg start/end markers not found")
    return raw[start.end() : end.start()]


def fetch(url: str, retries: int = 3) -> str:
    # Some Python installs ship without root certificates, so use certifi's bundle
    context = ssl.create_default_context(cafile=certifi.where())
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=60, context=context) as response:
                return response.read().decode("utf-8-sig")
        except urllib.error.HTTPError as error:
            # A missing book will not appear on retry
            if error.code == 404 or attempt == retries - 1:
                raise
        except urllib.error.URLError:
            if attempt == retries - 1:
                raise
        time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def download(
    gutenberg_id: int,
    cache_dir: Path,
    *,
    fetcher: Callable[[str], str] = fetch,
    pause: float = PAUSE_SECONDS,
) -> str:
    """Raw text of a book, from the cache when possible."""
    path = cache_dir / f"{gutenberg_id}.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    text = fetcher(URL.format(id=gutenberg_id))
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    time.sleep(pause)
    return text
