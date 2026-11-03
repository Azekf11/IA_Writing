import pytest

from aiwd.style.gutenberg import read_book, strip_boilerplate

RAW = (
    "license header\n*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n"
    "The actual book.\n*** END OF THE PROJECT GUTENBERG EBOOK TEST ***\nlicense footer"
)


def test_strip_boilerplate_keeps_only_the_book():
    assert strip_boilerplate(RAW).strip() == "The actual book."


def test_strip_boilerplate_accepts_the_older_wording():
    raw = (
        "*** START OF THIS PROJECT GUTENBERG EBOOK X ***\nbody\n"
        "*** END OF THIS PROJECT GUTENBERG EBOOK X"
    )
    assert strip_boilerplate(raw).strip() == "body"


def test_strip_boilerplate_refuses_text_without_markers():
    with pytest.raises(ValueError):
        strip_boilerplate("just some text")


def test_read_book_reads_a_saved_file(tmp_path):
    (tmp_path / "42.txt").write_text(RAW, encoding="utf-8")
    assert read_book(42, tmp_path) == RAW


def test_read_book_never_downloads_and_explains_why(tmp_path):
    with pytest.raises(FileNotFoundError, match="not with a script"):
        read_book(42, tmp_path)
