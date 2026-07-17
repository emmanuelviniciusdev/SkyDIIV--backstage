from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(slots=True)
class ClothingItem:
    """A clothing listing scraped from a marketplace."""

    description: str
    price: str
    images: list[str]
    link: str
    price_amount: float | None = None
    currency: str = "BRL"
    product_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SearchResult:
    """Results for a single search query."""

    query: str
    store: str
    items: list[ClothingItem] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "store": self.store,
            "items": [item.to_dict() for item in self.items],
            "error": self.error,
        }
