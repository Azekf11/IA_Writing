import pytest

from aiwd.style.gutenberg import download, strip_boilerplate

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


def test_download_fetches_once_then_reads_the_cache(tmp_path):
    calls: list[str] = []

    def fetcher(url: str) -> str:
        calls.append(url)
        return RAW

    first = download(42, tmp_path, fetcher=fetcher, pause=0)
    second = download(42, tmp_path, fetcher=fetcher, pause=0)
    assert first == second == RAW
    assert calls == ["https://www.gutenberg.org/cache/epub/42/pg42.txt"]
    assert (tmp_path / "42.txt").exists()
