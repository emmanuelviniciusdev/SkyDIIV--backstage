from __future__ import annotations

from abc import ABC, abstractmethod

from models import SearchResult


class StoreScraper(ABC):
    """Base interface for marketplace clothing scrapers."""

    store_name: str

    @abstractmethod
    async def search(self, query: str, *, limit: int = 10) -> SearchResult:
        """Search a store for products matching *query*."""

    async def close(self) -> None:
        """Release browser or network resources."""
