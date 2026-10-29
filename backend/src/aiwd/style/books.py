"""Hand-picked books, by Project Gutenberg id.

Titles, authors, languages and death years come from the Gutenberg catalog, never from here.
A book is kept only if its author died in 1955 or earlier (public domain in the EU).
Originals only, no translations. "fiction" is narrative prose, "essay" is non-fiction.
"""

from __future__ import annotations

# fmt: off
FICTION_EN = (
    1342, 158, 105, 145, 6688, 1400, 786, 219, 974, 541, 284, 24, 242, 144, 1245, 5670,
    2814, 1429, 718, 110, 122, 1260, 394, 64317, 35555, 174, 120, 35, 1661,
)
ESSAY_EN = (
    2944, 2945, 205, 34901, 11224, 575, 944, 5116, 130, 470, 23, 148, 2376, 15776, 833,
    1325, 10012, 4203, 2040, 1293, 4212, 386, 2398, 2447, 852, 15000, 4351, 64457, 7373,
    3420, 1228, 245, 68611, 1091,
)
FICTION_FR = (
    14155, 12065, 11049, 17457, 11131, 6497, 6470, 5711, 5250, 16852, 17489, 17493, 17494,
    796, 798, 2650, 13862, 39976, 4647, 4649, 4650, 23582, 34204, 5781, 6377, 4785, 33808,
    16239, 13861, 52006, 800, 4791, 60746, 14288, 56149, 10775, 10746, 11770, 10687, 13703,
    73058, 79151,
)
ESSAY_FR = (
    65434, 31440, 15113, 41486, 54339, 8074, 13846, 17980, 30268, 48529, 30514, 40489, 55501,
    65224, 16825, 66924, 41969, 28568,
)
# fmt: on

KIND_BY_ID: dict[int, str] = {
    **dict.fromkeys(FICTION_EN + FICTION_FR, "fiction"),
    **dict.fromkeys(ESSAY_EN + ESSAY_FR, "essay"),
}
