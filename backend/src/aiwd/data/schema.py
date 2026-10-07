from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Label = Literal["human", "ai", "mixed", "ai_polished"]
LABELS: tuple[str, ...] = ("human", "ai", "mixed", "ai_polished")


@dataclass(frozen=True)
class Document:
    """One row of the unified dataset.

    group_id ties together documents that must land in the same split
    (a human text and the AI texts generated from the same prompt or source).
    created_before_cutoff: written before 2022-11-30 (ChatGPT release); None if unknown.
    language: ISO 639-1 code, or "zxx" for content with no natural language (code).
    """

    id: str
    text: str
    label: Label
    source_dataset: str
    group_id: str
    generator: str | None = None
    decoding: str | None = None
    domain: str | None = None
    language: str = "en"
    attack: str = "none"
    is_non_native: bool | None = None
    created_before_cutoff: bool | None = None
    license: str | None = None

    def __post_init__(self) -> None:
        if self.label not in LABELS:
            raise ValueError(f"unknown label {self.label!r}, expected one of {LABELS}")
        if not self.id or not self.group_id:
            raise ValueError("id and group_id must be non-empty")
        if not self.text.strip():
            raise ValueError(f"document {self.id!r} has an empty text")

    @property
    def n_words(self) -> int:
        return len(self.text.split())

    @property
    def y(self) -> int:
        """Binary target: 0 for human, 1 for anything with AI involvement."""
        return 0 if self.label == "human" else 1
