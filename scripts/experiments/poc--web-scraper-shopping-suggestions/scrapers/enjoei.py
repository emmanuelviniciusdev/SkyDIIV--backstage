from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import quote_plus

from playwright.async_api import APIRequestContext, Browser, Page, Playwright, async_playwright

from models import ClothingItem, SearchResult
from scrapers.base import StoreScraper

_BASE_URL = "https://www.enjoei.com.br"
_SEARCH_URL = f"{_BASE_URL}/s?q={{query}}"
_PRODUCT_API = "https://pages.enjoei.com.br/products/{product_id}/v2.json"
_PHOTO_BASE = "https://photos.enjoei.com.br/public"
_PRODUCT_ID_RE = re.compile(r"-(\d+)(?:\?|$)")
_EXTRACT_PRODUCT_IDS_JS = """
() => {
    const ids = new Set();
    for (const link of document.querySelectorAll('a[href*="/p/"]')) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/-(\\d+)(?:\\?|$)/);
        if (match) ids.add(match[1]);
    }
    return [...ids];
}
"""


def _format_price(amount: float | int | None) -> str:
    if amount is None:
        return ""
    if float(amount).is_integer():
        return f"R$ {int(amount)}"
    return f"R$ {float(amount):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _photo_url(photo_id: str, size: str = "1200x1200") -> str:
    return f"{_PHOTO_BASE}/{size}/{photo_id}"


def _product_id_from_url(url: str) -> str | None:
    match = _PRODUCT_ID_RE.search(url)
    return match.group(1) if match else None


class EnjoeiScraper(StoreScraper):
    """Scrape clothing listings from Enjoei."""

    store_name = "enjoei"

    def __init__(
        self,
        *,
        headless: bool = True,
        timeout_ms: int = 60_000,
        playwright: Playwright | None = None,
        browser: Browser | None = None,
        owns_browser: bool = True,
    ) -> None:
        self._headless = headless
        self._timeout_ms = timeout_ms
        self._playwright = playwright
        self._browser = browser
        self._owns_browser = owns_browser
        self._request: APIRequestContext | None = None
        self._started = False

    async def _ensure_browser(self) -> Browser:
        if self._browser is not None:
            return self._browser

        if self._playwright is None:
            self._playwright = await async_playwright().start()
            self._owns_browser = True

        if self._request is None:
            self._request = await self._playwright.request.new_context()

        self._browser = await self._playwright.chromium.launch(headless=self._headless)
        self._started = True
        return self._browser

    @staticmethod
    async def _dismiss_cookie_banner(page: Page) -> None:
        try:
            button = page.get_by_role("button", name="entendi e concordo")
            if await button.count() > 0:
                await button.first.click(timeout=3_000)
        except Exception:
            pass

    async def _collect_product_ids(self, query: str, *, limit: int) -> list[str]:
        browser = await self._ensure_browser()
        page = await browser.new_page()

        try:
            url = _SEARCH_URL.format(query=quote_plus(query))
            await page.goto(url, wait_until="networkidle", timeout=self._timeout_ms)
            await self._dismiss_cookie_banner(page)
            await page.wait_for_timeout(1_500)

            product_ids: list[str] = await page.evaluate(_EXTRACT_PRODUCT_IDS_JS)
            return product_ids[:limit]
        finally:
            await page.close()

    async def _fetch_product(self, product_id: str) -> ClothingItem | None:
        if self._request is None:
            assert self._playwright is not None
            self._request = await self._playwright.request.new_context()

        api_url = _PRODUCT_API.format(product_id=product_id)
        response = await self._request.get(api_url, timeout=self._timeout_ms)
        if not response.ok:
            return None

        data: dict[str, Any] = await response.json()
        return self._parse_product(data, product_id)

    @staticmethod
    def _parse_product(data: dict[str, Any], product_id: str) -> ClothingItem:
        description = (data.get("description") or data.get("title") or "").strip()
        link = data.get("canonical_url") or f"{_BASE_URL}/p/-{product_id}"

        pricing = data.get("fallback_pricing") or {}
        price_info = pricing.get("price") or {}
        listed = price_info.get("listed")
        price_amount = float(listed) if listed is not None else None

        photos = data.get("photos") or []
        images = [_photo_url(photo_id) for photo_id in photos if photo_id]

        return ClothingItem(
            description=description,
            price=_format_price(price_amount),
            price_amount=price_amount,
            images=images,
            link=link,
            product_id=product_id,
        )

    async def search(self, query: str, *, limit: int = 10) -> SearchResult:
        result = SearchResult(query=query, store=self.store_name)

        try:
            await self._ensure_browser()
            product_ids = await self._collect_product_ids(query, limit=limit)
            if not product_ids:
                return result

            fetched = await asyncio.gather(
                *[self._fetch_product(product_id) for product_id in product_ids],
                return_exceptions=True,
            )

            for product_id, item in zip(product_ids, fetched, strict=True):
                if isinstance(item, Exception):
                    continue
                if item is not None:
                    result.items.append(item)
                else:
                    # Fallback: keep at least the product link when the API fails.
                    result.items.append(
                        ClothingItem(
                            description=query,
                            price="",
                            images=[],
                            link=f"{_BASE_URL}/p/-{product_id}",
                            product_id=product_id,
                        )
                    )
        except Exception as exc:
            result.error = str(exc)

        return result

    async def close(self) -> None:
        if self._request is not None:
            await self._request.dispose()
            self._request = None

        if self._browser is not None and self._owns_browser:
            await self._browser.close()
            self._browser = None

        if self._playwright is not None and self._owns_browser:
            await self._playwright.stop()
            self._playwright = None

    async def __aenter__(self) -> EnjoeiScraper:
        await self._ensure_browser()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()


async def create_shared_scraper(*, headless: bool = True) -> EnjoeiScraper:
    """Create a scraper with a shared Playwright browser for parallel searches."""
    playwright = await async_playwright().start()
    browser = await playwright.chromium.launch(headless=headless)
    return EnjoeiScraper(
        headless=headless,
        playwright=playwright,
        browser=browser,
        owns_browser=True,
    )
