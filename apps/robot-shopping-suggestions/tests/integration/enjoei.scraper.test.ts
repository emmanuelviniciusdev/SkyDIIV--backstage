import { describe, expect, it, vi } from "vitest"
import type {
  BrowserFactoryPort,
  BrowserPage,
  BrowserSession,
} from "../../src/domain/ports/browser-factory.port.js"
import type { DelayPort } from "../../src/domain/ports/delay.port.js"
import type { ProxyRotatorPort } from "../../src/domain/ports/proxy-rotator.port.js"
import type { Logger } from "../../src/domain/ports/logger.port.js"
import { EnjoeiScraper } from "../../src/infrastructure/scraping/marketplaces/enjoei.scraper.js"
import { searchParams } from "../helpers/search-params.js"

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("EnjoeiScraper (integration with fake browser)", () => {
  it("returns the top product for each search params entry", async () => {
    const delayCalls: number[] = []
    const delay: DelayPort = {
      humanDelay: async () => {
        delayCalls.push(Date.now())
      },
    }

    const proxyRotator: ProxyRotatorPort = {
      isEnabled: () => false,
      next: () => {
        throw new Error("unused")
      },
    }

    const visitedUrls: string[] = []
    let evaluateCount = 0

    const fakePage: BrowserPage = {
      goto: async (url) => {
        visitedUrls.push(url)
      },
      content: async () => "",
      evaluate: async <T>(fn: string | (() => T | Promise<T>)) => {
        void fn
        evaluateCount += 1
        // Simulate returning only the most relevant product (single object).
        if (evaluateCount === 1) {
          return {
            title: "jaqueta youcom azul pp",
            price: 51,
            currency: "BRL",
            url: "https://www.enjoei.com.br/p/jaqueta-youcom-azul-pp-143818536",
            imageUrl: "https://img.example/1.jpg",
          } as T
        }
        return {
          title: "vestido floral midi",
          price: 89.9,
          currency: "BRL",
          url: "https://www.enjoei.com.br/p/vestido-floral",
          imageUrl: "https://img.example/2.jpg",
        } as T
      },
      close: async () => {},
    }

    const fakeSession: BrowserSession = {
      newPage: async () => fakePage,
      close: async () => {},
    }

    const browserFactory: BrowserFactoryPort = {
      launch: async () => fakeSession,
    }

    const scraper = new EnjoeiScraper({
      browserFactory,
      delay,
      proxyRotator,
      logger: silentLogger(),
      buildSearchUrl: (params) =>
        `https://www.enjoei.com.br/s/?q=${params.searchTerm}`,
    })

    const products = await scraper.scrape({
      searchParams: [
        searchParams("jaqueta jeans youcom"),
        searchParams("vestido floral"),
      ],
      userId: "user-9",
    })

    expect(visitedUrls).toEqual([
      "https://www.enjoei.com.br/s/?q=jaqueta jeans youcom",
      "https://www.enjoei.com.br/s/?q=vestido floral",
    ])
    expect(delayCalls.length).toBe(3)
    expect(products).toHaveLength(2)
    expect(products[0]).toMatchObject({
      title: "jaqueta youcom azul pp",
      price: 51,
      currency: "BRL",
      searchTerm: "jaqueta jeans youcom",
    })
    expect(products[1]?.searchTerm).toBe("vestido floral")
  })

  it("uses the default URL builder with gender and size filters", async () => {
    const visitedUrls: string[] = []

    const scraper = new EnjoeiScraper({
      browserFactory: {
        launch: async () => ({
          newPage: async () => ({
            goto: async (url) => {
              visitedUrls.push(url)
            },
            content: async () => "",
            evaluate: async <T>() => null as T,
            close: async () => {},
          }),
          close: async () => {},
        }),
      },
      delay: { humanDelay: async () => {} },
      proxyRotator: {
        isEnabled: () => false,
        next: () => {
          throw new Error("unused")
        },
      },
      logger: silentLogger(),
    })

    await scraper.scrape({
      searchParams: [
        searchParams("camiseta", {
          gender: "Female",
          topSize: "M",
          bottomSize: "40",
          footSize: "38",
        }),
      ],
      userId: "u1",
    })

    expect(visitedUrls).toEqual([
      "https://www.enjoei.com.br/s/?q=camiseta&dep=feminino&sc=m&sw=40&ss=38",
    ])
  })

  it("skips an entry when no product card is found", async () => {
    const scraper = new EnjoeiScraper({
      browserFactory: {
        launch: async () => ({
          newPage: async () => ({
            goto: async () => {},
            content: async () => "",
            evaluate: async <T>() => null as T,
            close: async () => {},
          }),
          close: async () => {},
        }),
      },
      delay: { humanDelay: async () => {} },
      proxyRotator: {
        isEnabled: () => false,
        next: () => {
          throw new Error("unused")
        },
      },
      logger: silentLogger(),
    })

    const products = await scraper.scrape({
      searchParams: [searchParams("produto inexistente xyz")],
      userId: "u1",
    })

    expect(products).toEqual([])
  })

  it("passes rotated proxy URL to the browser factory when proxy rotation is on", async () => {
    const launch = vi.fn().mockResolvedValue({
      newPage: async () => ({
        goto: async () => {},
        content: async () => "",
        evaluate: async <T>() => null as T,
        close: async () => {},
      }),
      close: async () => {},
    })

    const scraper = new EnjoeiScraper({
      browserFactory: { launch },
      delay: { humanDelay: async () => {} },
      proxyRotator: {
        isEnabled: () => true,
        next: () => ({ proxyUrl: "socks5://proxy-a.example.com:1080" }),
      },
      logger: silentLogger(),
    })

    await scraper.scrape({
      searchParams: [searchParams("saia")],
      userId: "u1",
    })

    expect(launch).toHaveBeenCalledWith({
      proxyUrl: "socks5://proxy-a.example.com:1080",
    })
  })
})
