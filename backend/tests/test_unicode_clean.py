import random
import unicodedata

import pytest

from aiwd.normalize import normalize_text

# Same mapping as RAID's attacker: generation/adversarial/attackers/homoglyph.py
RAID_HOMOGLYPHS = {
    "a": ["\u0430"],
    "A": ["\u0410", "\u0391"],
    "B": ["\u0412", "\u0392"],
    "e": ["\u0435"],
    "E": ["\u0415", "\u0395"],
    "c": ["\u0441"],
    "p": ["\u0440"],
    "K": ["\u041a", "\u039a"],
    "O": ["\u041e", "\u039f"],
    "P": ["\u0420", "\u03a1"],
    "M": ["\u041c", "\u039c"],
    "H": ["\u041d", "\u0397"],
    "T": ["\u0422", "\u03a4"],
    "X": ["\u0425", "\u03a7"],
    "C": ["\u0421"],
    "y": ["\u0443"],
    "o": ["\u043e"],
    "x": ["\u0445"],
    "I": ["\u0406", "\u0399"],
    "i": ["\u0456"],
    "N": ["\u039d"],
    "Z": ["\u0396"],
}

PARAGRAPH = (
    "I think the Internet changed how people communicate. In the early years, it was a "
    "niche tool. Today India and Iceland both rely on it. No one expected that.\n\n"
    "My view: Amazing Machines, Tools and eXperiments helped. Zero Kids Ever Objected, "
    "Hence The Point."
)
SHORT_REVIEW = "I bought a copy for my son. A great gift, I would buy it again."


def raid_homoglyph_attack(text: str, seed: int) -> str:
    rng = random.Random(seed)
    return "".join(rng.choice(RAID_HOMOGLYPHS[c]) if c in RAID_HOMOGLYPHS else c for c in text)


def zero_width_attack(text: str, seed: int, n: float = 0.3) -> str:
    rng = random.Random(seed)
    chars = list(text)
    for i in rng.sample(range(len(chars)), int(n * len(chars))):
        chars[i] += "\u200b"
    return "".join(chars)


@pytest.mark.parametrize("seed", range(10))
@pytest.mark.parametrize("text", [PARAGRAPH, SHORT_REVIEW])
def test_raid_homoglyph_attack_is_undone(text, seed):
    attacked = raid_homoglyph_attack(text, seed)
    assert attacked != text
    r = normalize_text(attacked)
    assert r.text == normalize_text(text).text
    assert r.tampered


@pytest.mark.parametrize("seed", range(5))
def test_zero_width_attack_is_undone(seed):
    r = normalize_text(zero_width_attack(PARAGRAPH, seed))
    assert r.text == normalize_text(PARAGRAPH).text
    assert r.tampered


def test_whitespace_attack_is_undone():
    attacked = PARAGRAPH.replace(" ", "  ", 7).replace("it ", "it   ")
    assert normalize_text(attacked).text == normalize_text(PARAGRAPH).text


def test_nfkc_fullwidth_ligature_and_nbsp():
    r = normalize_text("ｆｕｌｌ ﬁle\u00a0x")
    assert r.text == "full file x"
    assert not r.tampered


def test_single_zero_width_space_is_counted_but_not_tampered():
    r = normalize_text("Copied from a web\u200bpage")
    assert r.text == "Copied from a webpage"
    assert r.flags["invisible_chars"] == 1
    assert not r.tampered


def test_benign_invisibles_are_removed_silently():
    r = normalize_text("\ufeffThis is a con\u00adtent\u200f test")
    assert r.text == "This is a content test"
    assert r.flags["benign_invisibles"] == 3
    assert r.flags["invisible_chars"] == 0
    assert not r.tampered


def test_decomposed_hangul_is_composed():
    assert normalize_text("\u1112\u1161\u11ab\u1100\u116e\u11a8").text == "\ud55c\uad6d"


def test_joiner_next_to_lookalike_is_removed_in_one_pass():
    r = normalize_text("\u0440\u200cAss \ufb01\u200c\u0430t")
    assert r.text == "pAss fiat"
    assert r.flags["invisible_chars"] == 2


def test_joiners_inside_latin_words_are_attacks():
    r = normalize_text("wo\u200drd te\u200cxt")
    assert r.text == "word text"
    assert r.flags["invisible_chars"] == 2
    assert r.tampered


@pytest.mark.parametrize(
    "text",
    [
        "Coding all night \U0001f469\u200d\U0001f4bb "
        "with my team \U0001f468\U0001f3fd\u200d\U0001f52c",
        "Persian: می\u200cخواهم and Hindi: क\u094d\u200dष",
    ],
)
def test_legitimate_joiners_are_kept(text):
    r = normalize_text(text)
    assert r.text == text
    assert not r.tampered


@pytest.mark.parametrize(
    "text",
    [
        "The H\u03b1 emission line and G\u03b1s signalling.",
        "PPAR\u03b3 agonists and the \u03c3v product.",
        "The α-helix and β-sheet are secondary structures.",
    ],
)
def test_greek_letters_in_science_text_are_left_alone(text):
    r = normalize_text(text)
    assert r.text == text
    assert not r.tampered


@pytest.mark.parametrize(
    "text",
    [
        "Привет мир, как дела",
        "Our guide Егор said его name means farmer.",
        "The poet Ігор Калинець wrote it.",
    ],
)
def test_genuine_cyrillic_is_left_alone(text):
    r = normalize_text(text)
    assert r.text == text
    assert not r.tampered


@pytest.mark.parametrize(
    "text",
    [
        "Café déjà vu, naïve. Où ça ? À l'été, l'œuvre coûte 12 €.",
        "Ça s'écrit « ainsi » — avec des guillemets “anglais” aussi.",
    ],
)
def test_french_text_is_preserved(text):
    r = normalize_text(text)
    assert r.text == text
    assert not r.tampered


def test_decomposed_accents_are_composed():
    r = normalize_text("Cafe\u0301 ok")
    assert r.text == "Café ok"
    assert r.to_original_span(3, 4) == (3, 5)
    assert not r.tampered


def test_format_char_between_base_and_mark():
    assert normalize_text("Cafe\u200b\u0301 ok").text == "Café ok"


def test_mapped_homoglyph_recomposes_with_its_accent():
    assert normalize_text("caf\u0435\u0301 au lait").text == "café au lait"


def test_spacing_acute_used_as_apostrophe():
    assert normalize_text("don´t worry").text == "don’t worry"


def test_whitespace_is_collapsed_and_paragraphs_kept():
    r = normalize_text("  a  \t b\n\n\n c\r\nd \u2003 e  ")
    assert r.text == "a b\n\nc\nd e"


def test_offsets_point_back_to_original_text():
    original = "Th\u200bis ｉs fine"
    r = normalize_text(original)
    assert r.text == "This is fine"
    start, end = r.to_original_span(5, 7)
    assert original[start:end] == "ｉs"


def test_ligature_span_maps_to_single_original_char():
    r = normalize_text("ﬁle")
    assert r.text == "file"
    assert r.to_original_span(0, 2) == (0, 1)
    assert r.to_original_span(0, 4) == (0, 3)


def test_invalid_span_raises():
    r = normalize_text("abc")
    with pytest.raises(ValueError):
        r.to_original_span(2, 2)
    with pytest.raises(ValueError):
        r.to_original_span(0, 4)


def test_empty_and_whitespace_only():
    assert normalize_text("").text == ""
    assert normalize_text(" \n\t ").text == ""


IDEMPOTENCE_CASES = [
    raid_homoglyph_attack(PARAGRAPH, 3),
    zero_width_attack(SHORT_REVIEW, 1),
    "Cafe\u200b\u0301 \u0301start caf\u0435\u0301 ｆｕｌｌ ﬁ\n\n\nx",
    "Café déjà vu.\r\n\r\nNew paragraph. Привет мир. H\u03b1 line.",
    "\U0001f469\u200d\U0001f4bb don´t ½ ⑴",
    "\u0440\u200cA p\u200d\u0391 I\u200d\u0430 \ufb01\u200c\u0430",
    "b\u00ad\u200d\u0391 I\u200b\u200do \u0435\u0301\u200cx",
    "\u1100\u1161\u11a8 \u1112\u1161\u11ab\u1100\u116e\u11a8",
]


@pytest.mark.parametrize("text", IDEMPOTENCE_CASES)
def test_normalization_is_idempotent_and_nfc(text):
    once = normalize_text(text).text
    assert normalize_text(once).text == once
    assert unicodedata.normalize("NFC", once) == once


@pytest.mark.parametrize("text", IDEMPOTENCE_CASES)
def test_offset_arrays_are_consistent(text):
    r = normalize_text(text)
    assert len(r.starts) == len(r.ends) == len(r.text)
    assert all(0 <= s < e <= len(text) for s, e in zip(r.starts, r.ends, strict=True))
    assert r.starts == sorted(r.starts)
