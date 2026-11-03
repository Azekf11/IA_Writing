import pytest

from aiwd.style.quality import (
    build_vocabulary,
    dehyphenate,
    fold,
    has_strange_accents,
    is_clean,
    is_running_prose,
    noise_report,
)

GOOD = (
    "The morning was grey and quiet, and the old house stood where it had always stood, "
    "at the end of the lane. Nobody had lived there for years, yet the garden was kept "
    "as if someone were expected to return."
)


@pytest.fixture
def vocab():
    return build_vocabulary([GOOD] * 5, min_count=2)


def test_fold_ignores_case_and_accents():
    assert fold("ÉTÉ") == fold("ete") == "ete"


def test_build_vocabulary_keeps_only_repeated_words(vocab):
    assert "garden" in vocab
    assert build_vocabulary(["alpha beta"], min_count=2) == set()


def test_clean_prose_is_accepted(vocab):
    assert is_clean(GOOD, vocab)


@pytest.mark.parametrize(
    "noisy",
    [
        "Thf morning wa.s grcy aud qnict, aiid thf old hou.sc stoud wlicrc it liad alwa)'s",
        "Tlie old house sIood at tlie eiid of tlie lane, aud nobodv liad lived tliere.",
        "The old HouseStood at the endOf the lane and nobody had lived there for years.",
        "The old house stood at the end of the laaaaaane and nobody had lived there.",
    ],
)
def test_ocr_noise_is_rejected(vocab, noisy):
    assert not is_clean(noisy, vocab)


def test_noise_report_counts_the_signals(vocab):
    report = noise_report(GOOD, vocab)
    assert report["common_ratio"] > 0.9
    assert report["unknown_ratio"] == 0
    assert report["bad_case_words"] == 0


def test_running_prose_needs_sentences():
    assert is_running_prose(GOOD)
    assert not is_running_prose("One long line with no end and no second sentence at all")


@pytest.mark.parametrize(
    "junk",
    [
        "Flour 3s. Sugar 2s. Tea 4s. Coffee 5s. Rice 1s. Salt 1s. Soap 2s. Lard 6s. Oil 7s.",
        "Smith. Jones. Brown. Taylor. Wilson. Davies. Evans. Thomas. Roberts. Walker. Wright.",
    ],
)
def test_lists_and_tables_are_not_prose(junk):
    assert not is_running_prose(junk)


def test_dehyphenate_joins_known_words_and_keeps_real_hyphens(vocab):
    assert dehyphenate("the gar- den was kept", vocab) == "the garden was kept"
    assert dehyphenate("a well- known man", vocab) == "a well-known man"


def test_strange_accents_flag_misread_letters():
    assert has_strange_accents("Gráce á l'obscurité, fréres, páleur et resta á moitié")
    assert not has_strange_accents("Il était allé à Besançon, naïve et ravi.")
