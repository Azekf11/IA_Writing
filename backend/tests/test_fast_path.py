import random

import pytest

from aiwd.normalize.unicode_clean import _normalize_ascii, _normalize_general

ALPHABET = "ab Z.'\t\n\r\x0b\x0c\x1c\x1f  \r\n"


@pytest.mark.parametrize("seed", range(20))
def test_ascii_fast_path_matches_general_path(seed):
    rng = random.Random(seed)
    for _ in range(300):
        text = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 40)))
        fast, general = _normalize_ascii(text), _normalize_general(text)
        assert fast.text == general.text, repr(text)
        assert fast.starts == general.starts, repr(text)
        assert fast.ends == general.ends, repr(text)
        assert fast.flags == general.flags


def test_fast_path_is_fast():
    import time

    text = "The quick brown fox jumps over the lazy dog.\n\n" * 20000
    t0 = time.perf_counter()
    _normalize_ascii(text)
    assert time.perf_counter() - t0 < 2.0
