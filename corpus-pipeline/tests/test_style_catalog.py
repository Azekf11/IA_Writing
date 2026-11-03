import pytest

from aiwd.style.books import KIND_BY_ID
from aiwd.style.catalog import LATEST_DEATH_YEAR, Book, load_catalog, parse_author, short_title


@pytest.mark.parametrize(
    ("raw", "name", "death"),
    [
        ("Austen, Jane, 1775-1817", "Jane Austen", 1817),
        ("Chesterton, G. K. (Gilbert Keith), 1874-1936", "G. K. Chesterton", 1936),
        ("Stendhal, 1783-1842", "Stendhal", 1842),
        ("Twain, Mark, 1835-1910; Kemble, E. W. [Illustrator]", "Mark Twain", 1910),
        ("Anonymous", "Anonymous", None),
    ],
)  # fmt: skip
def test_parse_author(raw, name, death):
    assert parse_author(raw) == (name, death)


def test_short_title_drops_subtitles_and_edition_notes():
    assert short_title("Pride and Prejudice") == "Pride and Prejudice"
    assert short_title("Tess of the d'Urbervilles: A Pure Woman") == "Tess of the d'Urbervilles"
    assert short_title("Essais — Volume 1") == "Essais"
    assert short_title("First line\nsecond line") == "First line"


def test_public_domain_uses_the_death_year_cutoff():
    old = Book(1, "t", "a", "en", LATEST_DEATH_YEAR)
    recent = Book(2, "t", "a", "en", LATEST_DEATH_YEAR + 1)
    unknown = Book(3, "t", "a", "en", None)
    assert old.public_domain
    assert not recent.public_domain
    assert not unknown.public_domain


def test_load_catalog_keeps_only_texts(tmp_path):
    path = tmp_path / "cat.csv"
    path.write_text(
        "Text#,Type,Issued,Title,Language,Authors,Subjects,LoCC,Bookshelves\n"
        '1342,Text,2008-06-01,Pride and Prejudice,en,"Austen, Jane, 1775-1817",,,\n'
        "9,Sound,2008-06-01,Some recording,en,Nobody,,,\n",
        encoding="utf-8",
    )
    books = load_catalog(path)
    assert list(books) == [1342]
    assert books[1342].author == "Jane Austen"
    assert books[1342].public_domain


def test_the_curated_list_has_no_duplicates_and_both_kinds():
    from aiwd.style import books

    everything = books.FICTION_EN + books.ESSAY_EN + books.FICTION_FR + books.ESSAY_FR
    assert len(everything) == len(set(everything)) == len(KIND_BY_ID)
    assert set(KIND_BY_ID.values()) == {"fiction", "essay"}
