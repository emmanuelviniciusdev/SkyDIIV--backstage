import type { ScrapedProduct } from "../../../domain/entities/scraped-product.js"
import type { BrowserFactoryPort } from "../../../domain/ports/browser-factory.port.js"
import type { DelayPort } from "../../../domain/ports/delay.port.js"
import type { Logger } from "../../../domain/ports/logger.port.js"
import type { ProxyRotatorPort } from "../../../domain/ports/proxy-rotator.port.js"
import type {
  MarketplaceScrapeInput,
  MarketplaceScraperPort,
} from "../../../domain/ports/marketplace-scraper.port.js"

export interface EnjoeiScraperDeps {
  browserFactory: BrowserFactoryPort
  delay: DelayPort
  proxyRotator: ProxyRotatorPort
  logger: Logger
  /** Injectable for tests — defaults to building the public Enjoei search URL. */
  buildSearchUrl?: (term: string) => string
}

interface EnjoeiDomProduct {
  title: string
  price: number | null
  currency: string | null
  url: string
  imageUrl: string | null
}

const ENJOEI_ORIGIN = "https://www.enjoei.com.br"

/**
 * Browser-side extractor for the single most relevant product card.
 *
 * Enjoei search defaults to "mais relevantes"; the first `.c-product-card`
 * is therefore the top match. Title/price live in dedicated nodes — never use
 * the image-link textContent (that often is just the discount badge, e.g. "7%").
 */
const ENJOEI_EXTRACT_TOP_PRODUCT = `(() => {
  const card = document.querySelector(".c-product-card");
  if (!card) return null;

  const anchor = card.querySelector('a[href*="/p/"]');
  const href = anchor ? anchor.getAttribute("href") || "" : "";
  if (!href) return null;

  const titleEl = card.querySelector('[data-test="div-nome-prod"], .c-product-card__title');
  const imgEl = card.querySelector('img[data-test="image-prod"], .c-product-card__img, img');
  let title = (titleEl && titleEl.textContent ? titleEl.textContent : "").trim();
  if (!title && imgEl) {
    title = (imgEl.getAttribute("alt") || "").trim();
  }
  // Reject discount badges / empty titles (e.g. "7%", "20%")
  if (!title || /^\\d+%$/.test(title)) return null;

  const priceRoot = card.querySelector('[data-test="div-preco"], .c-product-card__price');
  let price = null;
  if (priceRoot) {
    // Current price is the first text node span; strike-through lives in
    // .c-product-card__price-discount and must be ignored.
    const discount = priceRoot.querySelector(".c-product-card__price-discount");
    const clone = priceRoot.cloneNode(true);
    if (discount && clone.querySelector) {
      const discountClone = clone.querySelector(".c-product-card__price-discount");
      if (discountClone) discountClone.remove();
    }
    const priceText = (clone.textContent || "").replace(/\\s/g, "");
    const priceMatch = priceText.match(/R\\$?\\s*([\\d.,]+)/i) || priceText.match(/([\\d.,]+)/);
    if (priceMatch && priceMatch[1]) {
      const raw = priceMatch[1];
      const normalized = raw.includes(",")
        ? raw.replace(/\\./g, "").replace(",", ".")
        : raw;
      const parsed = Number.parseFloat(normalized);
      price = Number.isFinite(parsed) ? parsed : null;
    }
  }

  const imageUrl = imgEl
    ? imgEl.getAttribute("src") || imgEl.getAttribute("data-src")
    : null;

  const absoluteUrl = href.startsWith("http")
    ? href.split("?")[0]
    : "https://www.enjoei.com.br" + (href.startsWith("/") ? "" : "/") + href.split("?")[0];

  return {
    title: title,
    price: price,
    currency: price !== null ? "BRL" : null,
    url: absoluteUrl,
    imageUrl: imageUrl,
  };
})()`

/**
 * Marketplace scraper for Enjoei (Brazilian second-hand clothing).
 *
 * Returns at most one product per search term — the top result under the
 * default "mais relevantes" ranking.
 */
export class EnjoeiScraper implements MarketplaceScraperPort {
  readonly marketplace = "enjoei"

  private readonly buildSearchUrl: (term: string) => string

  constructor(private readonly deps: EnjoeiScraperDeps) {
    this.buildSearchUrl =
      deps.buildSearchUrl ?? ((term) => `${ENJOEI_ORIGIN}/s/?q=${encodeURIComponent(term)}`)
  }

  async scrape(input: MarketplaceScrapeInput): Promise<ScrapedProduct[]> {
    const proxyUrl = this.deps.proxyRotator.isEnabled()
      ? this.deps.proxyRotator.next().proxyUrl
      : undefined

    const browser = await this.deps.browserFactory.launch({ proxyUrl })
    const products: ScrapedProduct[] = []

    try {
      for (let i = 0; i < input.searchTerms.length; i++) {
        const term = input.searchTerms[i]!

        if (i > 0) {
          await this.deps.delay.humanDelay()
        }

        this.deps.logger.info("Scraping Enjoei search term", {
          userId: input.userId,
          searchTerm: term,
        })

        const page = await browser.newPage()
        try {
          const url = this.buildSearchUrl(term)
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })

          // Wait for product cards to hydrate past the skeleton state.
          await this.deps.delay.humanDelay()

          const extracted = await page.evaluate<EnjoeiDomProduct | null>(
            ENJOEI_EXTRACT_TOP_PRODUCT,
          )

          if (!extracted) {
            this.deps.logger.warn("No relevant Enjoei product found", {
              searchTerm: term,
            })
            continue
          }

          const product: ScrapedProduct = {
            marketplace: this.marketplace,
            title: extracted.title,
            price: extracted.price,
            currency: extracted.currency,
            url: extracted.url,
            imageUrl: extracted.imageUrl,
            searchTerm: term,
          }
          products.push(product)

          this.deps.logger.debug("Enjoei search term scrape output", {
            searchTerm: term,
            product,
          })
        } finally {
          await page.close()
        }
      }
    } finally {
      await browser.close()
    }

    this.deps.logger.debug("Enjoei scrape output", {
      userId: input.userId,
      searchTerms: input.searchTerms,
      productCount: products.length,
      products,
    })

    return products
  }
}
