import type { ScrapedProduct } from "../../../domain/entities/scraped-product.js"
import type { SearchParams } from "../../../domain/entities/search-params.js"
import type { BrowserFactoryPort } from "../../../domain/ports/browser-factory.port.js"
import type { DelayPort } from "../../../domain/ports/delay.port.js"
import type { Logger } from "../../../domain/ports/logger.port.js"
import type { ProxyRotatorPort } from "../../../domain/ports/proxy-rotator.port.js"
import type {
  MarketplaceScrapeInput,
  MarketplaceScraperPort,
} from "../../../domain/ports/marketplace-scraper.port.js"
import { buildEnjoeiSearchUrl } from "./enjoei-search-url.js"

export interface EnjoeiScraperDeps {
  browserFactory: BrowserFactoryPort
  delay: DelayPort
  proxyRotator: ProxyRotatorPort
  logger: Logger
  /** Injectable for tests — defaults to building the public Enjoei search URL. */
  buildSearchUrl?: (params: SearchParams) => string
}

interface EnjoeiDomProduct {
  title: string
  price: number | null
  currency: string | null
  url: string
  imageUrl: string | null
}

/**
 * Browser-side extractor for up to 10 product cards under Enjoei's default
 * "mais relevantes" ranking. Title/price live in dedicated nodes — never use
 * the image-link textContent (that often is just the discount badge, e.g. "7%").
 */
const ENJOEI_EXTRACT_PRODUCTS = `(() => {
  const cards = Array.from(document.querySelectorAll(".c-product-card")).slice(0, 10);
  const products = [];
  for (const card of cards) {
    const anchor = card.querySelector('a[href*="/p/"]');
    const href = anchor ? anchor.getAttribute("href") || "" : "";
    if (!href) continue;

    const titleEl = card.querySelector('[data-test="div-nome-prod"], .c-product-card__title');
    const imgEl = card.querySelector('img[data-test="image-prod"], .c-product-card__img, img');
    let title = (titleEl && titleEl.textContent ? titleEl.textContent : "").trim();
    if (!title && imgEl) {
      title = (imgEl.getAttribute("alt") || "").trim();
    }
    if (!title || /^\\d+%$/.test(title)) continue;

    const priceRoot = card.querySelector('[data-test="div-preco"], .c-product-card__price');
    let price = null;
    if (priceRoot) {
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

    products.push({
      title: title,
      price: price,
      currency: price !== null ? "BRL" : null,
      url: absoluteUrl,
      imageUrl: imageUrl,
    });
  }
  return products;
})()`

/**
 * Marketplace scraper for Enjoei (Brazilian second-hand clothing).
 *
 * Returns at most 10 products per search params entry under the default
 * "mais relevantes" ranking, with optional gender/size filters.
 */
export class EnjoeiScraper implements MarketplaceScraperPort {
  readonly marketplace = "enjoei"

  private readonly buildSearchUrl: (params: SearchParams) => string

  constructor(private readonly deps: EnjoeiScraperDeps) {
    this.buildSearchUrl = deps.buildSearchUrl ?? buildEnjoeiSearchUrl
  }

  async scrape(input: MarketplaceScrapeInput): Promise<ScrapedProduct[]> {
    const proxy = this.deps.proxyRotator.isEnabled()
      ? this.deps.proxyRotator.next()
      : null

    const browser = await this.deps.browserFactory.launch(
      proxy ? { proxyUrl: proxy.proxyUrl } : undefined,
    )
    const products: ScrapedProduct[] = []

    try {
      for (let i = 0; i < input.searchParams.length; i++) {
        const params = input.searchParams[i]!

        if (i > 0) {
          await this.deps.delay.humanDelay()
        }

        this.deps.logger.info("Scraping Enjoei search", {
          userId: input.userId,
          searchTerm: params.searchTerm,
          gender: params.gender,
          topSize: params.topSize,
          bottomSize: params.bottomSize,
          footSize: params.footSize,
          brand: params.brand,
        })

        const page = await browser.newPage()
        try {
          const url = this.buildSearchUrl(params)
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })

          // Wait for product cards to hydrate past the skeleton state.
          await this.deps.delay.humanDelay()

          const extracted = await page.evaluate<EnjoeiDomProduct[]>(
            ENJOEI_EXTRACT_PRODUCTS,
          )
          const listings = Array.isArray(extracted) ? extracted.slice(0, 10) : []

          if (listings.length === 0) {
            this.deps.logger.warn("No relevant Enjoei products found", {
              searchTerm: params.searchTerm,
              url,
            })
            continue
          }

          for (const extractedProduct of listings) {
            const product: ScrapedProduct = {
              marketplace: this.marketplace,
              title: extractedProduct.title,
              price: extractedProduct.price,
              currency: extractedProduct.currency,
              url: extractedProduct.url,
              imageUrl: extractedProduct.imageUrl,
              searchTerm: params.searchTerm,
              searchParams: params,
            }
            products.push(product)
          }

          this.deps.logger.debug("Enjoei search scrape output", {
            searchTerm: params.searchTerm,
            productCount: listings.length,
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
      searchParams: input.searchParams,
      productCount: products.length,
      products,
    })

    return products
  }
}
