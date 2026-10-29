"""Recent journalism from the web, as clean style passages.

Two open datasets of web crawls are read:
- C4 "realnewslike" (English): articles from news sites, crawled in April 2019.
- FineWeb-2 (French): a mix of crawls from 2013 to 2024, filtered here to news and magazine
  sites and to crawls up to 2022.

The cut-off matters. From late 2022 a growing share of web text is written by language models,
which would defeat the point of using it as a reference for human writing.

Web pages carry a lot more clutter than books: menus, "read also" lists, cookie notices, author
boxes. Most of the work is dropping that and keeping the article body.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from urllib.parse import urlparse

# Crawls after this year are not used: model-written text starts to dilute them
LATEST_CRAWL_YEAR = 2022
MIN_ARTICLE_WORDS = 250
# A line this long is a sentence of the article, never a menu entry
BOILERPLATE_MAX_WORDS = 12
MAX_ARTICLE_WORDS = 6000

# Reputable news, magazine and public-broadcaster sites. Editorial judgement lives here:
# add or remove a domain and rebuild. Matched against the registered domain (no "www.").
SITES_EN = frozenset(
    """
    nytimes.com theguardian.com washingtonpost.com latimes.com chicagotribune.com bbc.com
    bbc.co.uk reuters.com apnews.com npr.org theatlantic.com newyorker.com economist.com
    ft.com wsj.com telegraph.co.uk independent.co.uk time.com newsweek.com smithsonianmag.com
    nationalgeographic.com scientificamerican.com wired.com arstechnica.com theverge.com
    vox.com slate.com salon.com politico.com thehill.com usatoday.com cbsnews.com nbcnews.com
    abcnews.go.com cnn.com aljazeera.com bostonglobe.com sfchronicle.com baltimoresun.com
    seattletimes.com denverpost.com startribune.com theconversation.com propublica.org
    pbs.org vice.com mashable.com cnet.com zdnet.com engadget.com techcrunch.com
    """.split()
)
SITES_FR = frozenset(
    """
    lemonde.fr lefigaro.fr liberation.fr lexpress.fr leparisien.fr francetvinfo.fr
    ouest-france.fr lapresse.ca ledevoir.com radio-canada.ca courrierinternational.com
    lepoint.fr nouvelobs.com rfi.fr france24.com slate.fr telerama.fr lesechos.fr latribune.fr
    20minutes.fr huffingtonpost.fr mediapart.fr lamontagne.fr ladepeche.fr sudouest.fr
    lavoixdunord.fr leprogres.fr ledauphine.com bfmtv.com europe1.fr francebleu.fr
    franceculture.fr arte.tv tv5monde.com usinenouvelle.com challenges.fr marianne.net
    humanite.fr la-croix.com lequipe.fr sciencesetavenir.fr futura-sciences.com numerama.com
    clubic.com 01net.com lemonde.fr letemps.ch lesoir.be lalibre.be rtbf.be tdg.ch
    """.split()
)

# Lines that belong to the page, not to the article
_BOILERPLATE = re.compile(
    r"""(?ix)
    \b(
      subscribe | newsletter | sign\ up | sign\ in | log\ in | cookies? | privacy\ policy |
      terms\ of\ (use|service) | all\ rights\ reserved | copyright | follow\ us |
      read\ more | related\ (articles|stories) | advertisement | click\ here |
      abonnez | abonnement | s'abonner | inscrivez | connectez | cookies | mentions\ l[ée]gales |
      tous\ droits | lire\ aussi | à\ lire\ aussi | partager | suivez | publicit[ée] |
      reproduction\ interdite | newsletters? | cliquez
    )\b
    """
)
_ARTICLE_END = re.compile(
    r"(?i)^(related|read more|more from|you may also|lire aussi|à lire aussi)"
)


def registered_domain(url: str) -> str:
    """'https://www.news.example.co.uk/a' -> 'example.co.uk' (good enough for reports)."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "gov", "ac"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def matching_site(url: str, sites: frozenset[str]) -> str | None:
    """The allowed domain a URL belongs to, or None. A host matches itself and its subdomains."""
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    for site in sites:
        if host == site or host.endswith("." + site):
            return site
    return None


def allowed_site(url: str, sites: frozenset[str]) -> bool:
    return matching_site(url, sites) is not None


def crawl_year(dump: str | None) -> int | None:
    """'CC-MAIN-2021-21' -> 2021."""
    match = re.search(r"(\d{4})", dump or "")
    return int(match.group(1)) if match else None


def clean_article(text: str) -> str:
    """The article body: boilerplate lines dropped, and everything after a 'related' footer."""
    blocks: list[str] = []
    for line in text.replace("\r", "").split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if _ARTICLE_END.match(stripped):
            break
        # Short lines that mention a page element are menus and footers
        if len(stripped.split()) < BOILERPLATE_MAX_WORDS and _BOILERPLATE.search(stripped):
            continue
        blocks.append(stripped)
    return "\n\n".join(blocks)


def usable_article(text: str) -> bool:
    words = len(text.split())
    return MIN_ARTICLE_WORDS <= words <= MAX_ARTICLE_WORDS


def hosts_summary(urls: Iterable[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for url in urls:
        domain = registered_domain(url)
        out[domain] = out.get(domain, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))
