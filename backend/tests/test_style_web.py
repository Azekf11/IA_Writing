import pytest

from aiwd.style.web import (
    LATEST_CRAWL_YEAR,
    SITES_EN,
    SITES_FR,
    allowed_site,
    clean_article,
    crawl_year,
    hosts_summary,
    registered_domain,
    usable_article,
)

BODY = (
    "The mayor said the plan would cost twelve million dollars and take three years to "
    "finish, a timeline that critics called unrealistic given the city's record of delays "
    "on projects of this size."
)


@pytest.mark.parametrize(
    ("url", "domain"),
    [
        ("https://www.nytimes.com/2019/04/22/x.html", "nytimes.com"),
        ("https://www.bbc.co.uk/news/world", "bbc.co.uk"),
        ("http://news.bbc.co.uk/a", "bbc.co.uk"),
        ("https://blogs.lemonde.fr/a", "lemonde.fr"),
        ("https://quebec.huffingtonpost.ca/x", "huffingtonpost.ca"),
        ("not a url", ""),
    ],
)
def test_registered_domain(url, domain):
    assert registered_domain(url) == domain


def test_allow_lists_match_the_registered_domain_only():
    assert allowed_site("https://www.theguardian.com/world/x", SITES_EN)
    assert allowed_site("https://blogs.lemonde.fr/x", SITES_FR)
    # A trusted name inside a hostile host must not pass
    assert not allowed_site("https://www.nytimes.com.evil.example/x", SITES_EN)
    assert not allowed_site("https://nytimes.com.evil.net/x", SITES_EN)
    # Languages do not leak into each other
    assert not allowed_site("https://www.lemonde.fr/x", SITES_EN)
    assert not allowed_site("https://www.nytimes.com/x", SITES_FR)


def test_every_listed_site_matches_its_own_urls():
    for site in SITES_EN | SITES_FR:
        assert site == site.lower()
        assert "/" not in site and not site.startswith("www.")
        assert allowed_site(f"https://{site}/", SITES_EN | SITES_FR)
        assert allowed_site(f"https://www.{site}/x", SITES_EN | SITES_FR)


@pytest.mark.parametrize("dump", ["CC-MAIN-2021-21", "CC-MAIN-2016-50"])
def test_crawl_year(dump):
    assert crawl_year(dump) == int(dump[8:12])


def test_crawl_year_of_nothing_is_none():
    assert crawl_year(None) is None
    assert crawl_year("unknown") is None


def test_cutoff_keeps_model_written_text_out():
    assert LATEST_CRAWL_YEAR <= 2022


def test_clean_article_drops_page_furniture_and_keeps_the_body():
    raw = f"Sign up for our newsletter\n\n{BODY}\n\nAbonnez-vous\nFollow us on Twitter\n"
    assert clean_article(raw) == BODY


def test_clean_article_stops_at_a_related_footer():
    raw = f"{BODY}\n\nRelated stories\n\nSomething that must not appear in the passage at all"
    assert clean_article(raw) == BODY


def test_clean_article_keeps_long_sentences_that_mention_cookies():
    sentence = (
        "The bakery has sold its famous chocolate cookies from the same counter for sixty "
        "years, and the owner says the recipe has never changed."
    )
    assert clean_article(sentence) == sentence


def test_usable_article_length_bounds():
    assert not usable_article("too short")
    assert usable_article(" ".join(["word"] * 400))
    assert not usable_article(" ".join(["word"] * 20000))


def test_hosts_summary_counts_and_sorts():
    urls = ["https://a.example.com/1", "https://www.example.com/2", "https://other.org/3"]
    assert hosts_summary(urls) == {"example.com": 2, "other.org": 1}
