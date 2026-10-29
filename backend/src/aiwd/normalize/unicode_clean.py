"""Text normalization that defeats character-level attacks (RAID, SilverSpeak).

Pipeline: drop invisible characters used in attacks, NFKC per grapheme cluster,
map Cyrillic/Greek lookalikes back to ASCII, recompose (NFC), collapse whitespace.
Every output character keeps the span of the original characters it came from,
so findings computed on the clean text can be highlighted in the original text.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# Inverse of RAID's homoglyph attack (generation/adversarial/attackers/homoglyph.py),
# plus a few Cyrillic lookalikes used by other attacks. Lowercase Greek letters are
# deliberately absent (except omicron): alpha, gamma, sigma... are common in science.
LOOKALIKES: dict[str, str] = {
    # Cyrillic
    "\u0430": "a", "\u0410": "A", "\u0412": "B", "\u0435": "e", "\u0415": "E", "\u0441": "c",
    "\u0421": "C", "\u0440": "p", "\u0420": "P", "\u041a": "K", "\u041e": "O", "\u043e": "o",
    "\u041c": "M", "\u041d": "H", "\u0422": "T", "\u0425": "X", "\u0445": "x", "\u0443": "y",
    "\u0406": "I", "\u0456": "i", "\u04c0": "I", "\u0458": "j", "\u0408": "J", "\u0455": "s",
    "\u0405": "S", "\u0501": "d", "\u04bb": "h", "\u051b": "q", "\u051d": "w",
    # Greek
    "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I",
    "\u039a": "K", "\u039c": "M", "\u039d": "N", "\u039f": "O", "\u03bf": "o", "\u03a1": "P",
    "\u03a4": "T", "\u03a5": "Y", "\u03a7": "X",
}  # fmt: skip

# Invisible characters inserted by attacks: removed and counted.
SUSPICIOUS_INVISIBLES = frozenset(
    "\u200b\u2060\u180e\u2061\u2062\u2063\u2064"  # zero-width space, word joiner, ...
    "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"  # bidi embeddings / isolates
)
# Invisible characters common in ordinary copy-paste: removed, counted separately.
BENIGN_INVISIBLES = frozenset("\u00ad\u200e\u200f")
_JOINERS = frozenset("\u200c\u200d")
_BOM = "\ufeff"
_SPACING_ACUTE = "\u00b4"
_NEWLINES = frozenset("\n\r\u2028\u2029\x85")

_ASCII_WHITESPACE_RUN = re.compile(
    "[" + re.escape("".join(chr(i) for i in range(128) if chr(i).isspace())) + "]+"
)

Char = tuple[str, int, int]


@dataclass(frozen=True)
class NormalizedText:
    text: str
    starts: list[int]
    ends: list[int]
    flags: dict[str, int] = field(default_factory=dict)

    @property
    def tampered(self) -> bool:
        """Lookalike letters, or more than one attack-style invisible character.

        A single zero-width space can come from an ordinary copy-paste.
        """
        return self.flags.get("homoglyphs", 0) > 0 or self.flags.get("invisible_chars", 0) > 1

    def to_original_span(self, start: int, end: int) -> tuple[int, int]:
        """Map a [start, end) span of the clean text to a span of the original text."""
        if not 0 <= start < end <= len(self.text):
            raise ValueError(f"invalid span ({start}, {end}) for text of length {len(self.text)}")
        return self.starts[start], self.ends[end - 1]


def _empty_flags() -> dict[str, int]:
    return {
        "invisible_chars": 0,
        "benign_invisibles": 0,
        "homoglyphs": 0,
        "homoglyph_words": 0,
        "nfkc_changes": 0,
    }


def normalize_text(text: str) -> NormalizedText:
    if text.isascii():
        return _normalize_ascii(text)
    return _normalize_general(text)


def _normalize_ascii(text: str) -> NormalizedText:
    """Fast path: for pure ASCII only whitespace collapsing can change anything."""
    pieces: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    pos = 0
    for m in _ASCII_WHITESPACE_RUN.finditer(text):
        s, e = m.span()
        pieces.append(text[pos:s])
        starts.extend(range(pos, s))
        ends.extend(range(pos + 1, s + 1))
        if s > 0 and e < len(text):
            run = m.group()
            newlines = run.count("\n") + run.count("\r") - run.count("\r\n")
            replacement = "\n\n" if newlines >= 2 else ("\n" if newlines == 1 else " ")
            pieces.append(replacement)
            starts.extend([s] * len(replacement))
            ends.extend([e] * len(replacement))
        pos = e
    pieces.append(text[pos:])
    starts.extend(range(pos, len(text)))
    ends.extend(range(pos + 1, len(text) + 1))
    return NormalizedText(text="".join(pieces), starts=starts, ends=ends, flags=_empty_flags())


def _normalize_general(text: str) -> NormalizedText:
    flags = _empty_flags()
    chars = _drop_invisibles(text, flags)
    chars = _per_cluster(chars, "NFKC", flags)
    chars = _drop_attack_joiners(chars, flags)
    chars = _map_lookalikes(chars, flags)
    chars = _per_cluster(chars, "NFC")
    chars = _collapse_whitespace(chars)
    return NormalizedText(
        text="".join(c for c, _, _ in chars),
        starts=[s for _, s, _ in chars],
        ends=[e for _, _, e in chars],
        flags=flags,
    )


def _is_latin_like(ch: str) -> bool:
    return (ch.isascii() and ch.isalpha()) or ch in LOOKALIKES


def _drop_invisibles(text: str, flags: dict[str, int]) -> list[Char]:
    kept: list[Char] = []
    for i, ch in enumerate(text):
        if ch in SUSPICIOUS_INVISIBLES or (ch == _BOM and i > 0):
            flags["invisible_chars"] += 1
        elif ch in BENIGN_INVISIBLES or ch == _BOM:
            flags["benign_invisibles"] += 1
        else:
            kept.append((ch, i, i + 1))
    out: list[Char] = []
    for k, (ch, s, e) in enumerate(kept):
        if (
            ch == _SPACING_ACUTE
            and 0 < k < len(kept) - 1
            and kept[k - 1][0].isalpha()
            and kept[k + 1][0].isalpha()
        ):
            out.append(("\u2019", s, e))
        else:
            out.append((ch, s, e))
    return out


def _drop_attack_joiners(chars: list[Char], flags: dict[str, int]) -> list[Char]:
    """Remove ZWJ/ZWNJ between Latin-looking letters; keep them in emoji and joining scripts."""
    out: list[Char] = []
    n = len(chars)
    for k, item in enumerate(chars):
        if item[0] not in _JOINERS:
            out.append(item)
            continue
        p = k - 1
        while p >= 0 and chars[p][0] in _JOINERS:
            p -= 1
        q = k + 1
        while q < n and chars[q][0] in _JOINERS:
            q += 1
        if p >= 0 and q < n and _is_latin_like(chars[p][0]) and _is_latin_like(chars[q][0]):
            flags["invisible_chars"] += 1
        else:
            out.append(item)
    return out


def _continues_cluster(ch: str) -> bool:
    """Combining marks, and Hangul vowel/final jamo that compose with the previous jamo."""
    return unicodedata.category(ch).startswith("M") or (
        "\u1160" <= ch <= "\u11ff" or "\ud7b0" <= ch <= "\ud7ff"
    )


def _clusters(chars: list[Char]):
    """Yield (i, j) index ranges of a base character followed by the characters it composes with."""
    i, n = 0, len(chars)
    while i < n:
        j = i + 1
        while j < n and _continues_cluster(chars[j][0]):
            j += 1
        yield i, j
        i = j


def _per_cluster(chars: list[Char], form: str, flags: dict[str, int] | None = None) -> list[Char]:
    out: list[Char] = []
    for i, j in _clusters(chars):
        cluster = "".join(c for c, _, _ in chars[i:j])
        normalized = unicodedata.normalize(form, cluster)
        if normalized == cluster:
            out.extend(chars[i:j])
            continue
        if flags is not None:
            flags["nfkc_changes"] += 1
        start, end = chars[i][1], chars[j - 1][2]
        out.extend((c, start, end) for c in normalized)
    return out


def _script(ch: str) -> str:
    return unicodedata.name(ch, "UNKNOWN").split(" ", 1)[0]


def _is_word_char(ch: str) -> bool:
    return ch.isalpha() or unicodedata.category(ch).startswith("M")


def _words(chars: list[Char]):
    i, n = 0, len(chars)
    while i < n:
        if not _is_word_char(chars[i][0]):
            i += 1
            continue
        j = i
        while j < n and _is_word_char(chars[j][0]):
            j += 1
        yield i, j
        i = j


def _map_lookalikes(chars: list[Char], flags: dict[str, int]) -> list[Char]:
    """Map lookalikes in mixed Latin/Cyrillic/Greek words, and in words made only of
    lookalikes when the text contains no genuine letter of that script."""
    genuine = {
        _script(c)
        for c, _, _ in chars
        if c.isalpha() and c not in LOOKALIKES and _script(c) in {"CYRILLIC", "GREEK"}
    }
    out = list(chars)
    for i, j in _words(chars):
        letters = [c for c, _, _ in chars[i:j] if c.isalpha()]
        targets = [k for k in range(i, j) if chars[k][0] in LOOKALIKES]
        if not targets:
            continue
        has_latin = any(_script(c) == "LATIN" for c in letters)
        only_lookalikes = all(c in LOOKALIKES for c in letters)
        scripts = {_script(c) for c in letters}
        if has_latin or (only_lookalikes and not scripts & genuine):
            flags["homoglyph_words"] += 1
            flags["homoglyphs"] += len(targets)
            for k in targets:
                ch, s, e = chars[k]
                out[k] = (LOOKALIKES[ch], s, e)
    return out


def _collapse_whitespace(chars: list[Char]) -> list[Char]:
    out: list[Char] = []
    i, n = 0, len(chars)
    while i < n:
        ch, start, end = chars[i]
        if not ch.isspace():
            out.append((ch, start, end))
            i += 1
            continue
        j, newlines = i, 0
        while j < n and chars[j][0].isspace():
            c = chars[j][0]
            if c in _NEWLINES and not (c == "\n" and j > i and chars[j - 1][0] == "\r"):
                newlines += 1
            j += 1
        if out and j < n:
            run_start, run_end = chars[i][1], chars[j - 1][2]
            if newlines >= 2:
                out.extend([("\n", run_start, run_end), ("\n", run_start, run_end)])
            else:
                out.append(("\n" if newlines == 1 else " ", run_start, run_end))
        i = j
    return out
