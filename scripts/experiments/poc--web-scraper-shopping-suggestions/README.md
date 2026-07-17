# PoC — Web Scraper for Shopping Suggestions

Proof of concept for scraping shopping suggestions from online marketplaces.
One store is implemented today; the architecture is designed to add more stores
later.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |

---

## Setup

```bash
cd scripts/experiments/poc--web-scraper-shopping-suggestions

# install dependencies
uv sync

# install the Chromium browser used by Playwright
uv run playwright install chromium
```

---

## Usage

### Command-line search

```bash
# single query
uv run python __main__.py "camiseta oversized"

# multiple queries (parallel by default)
uv run python __main__.py "camiseta oversized" "calça jeans" "moletom"

# sequential execution
uv run python __main__.py --sequential "vestido floral" "jaqueta couro"
```

### File-based search

JSON file (list or object with a `queries` key):

```json
[
  "camiseta oversized",
  "calça jeans"
]
```

Or a `.txt` file with one description per line.

```bash
uv run python __main__.py --input queries.json
```

### Options

| Flag | Description |
|------|-------------|
| `--store <id>` | Marketplace to query (see `--help` for supported values) |
| `--limit N` | Maximum listings per search (default: `5`) |
| `--sequential` | Run searches one after another (default: parallel) |
| `--headed` | Open a visible browser window (debug) |
| `--output PATH` | Output JSON file path (default: `output.json`) |

---

## Output format

The script prints JSON to **stdout** and writes the same content to
`output.json` (gitignored).

Fields per item:

| Field | Description |
|-------|-------------|
| `description` | Full listing description |
| `price` | Formatted price (e.g. `R$ 49`) |
| `price_amount` | Numeric amount |
| `currency` | Currency code (`BRL`) |
| `images` | Product photo URLs |
| `link` | Canonical listing URL |
| `product_id` | Marketplace-internal product ID |

Example (abbreviated):

```json
{
  "searched_at": "2026-07-17T14:52:00+00:00",
  "store": "<store-id>",
  "summary": {
    "queries": 2,
    "items": 8,
    "failed_queries": []
  },
  "results": [
    {
      "query": "camiseta oversized",
      "store": "<store-id>",
      "items": [
        {
          "description": "camiseta preta estampada...",
          "price": "R$ 49",
          "price_amount": 49.0,
          "currency": "BRL",
          "images": [
            "https://cdn.example.com/public/828x828/..."
          ],
          "link": "https://marketplace.example.com/p/...",
          "product_id": "143217317"
        }
      ],
      "error": null
    }
  ]
}
```

---

## How it works

1. **Playwright** opens the marketplace search page and extracts product IDs
   from listing links.
2. For each ID, the scraper calls the store's public product API, which returns
   title, description, price, and photos.
3. Independent searches run in **parallel** (`asyncio.gather`), sharing a single
   Chromium browser instance.

---

## Structure

```
poc--web-scraper-shopping-suggestions/
├── __main__.py          # CLI and orchestration
├── models.py            # output dataclasses
├── scrapers/
│   ├── base.py          # base store interface
│   └── *.py             # per-store scraper implementations
├── pyproject.toml
└── README.md
```

To add a new store, implement `StoreScraper` under `scrapers/` and register it
in the CLI.

---

## Limitations (PoC)

- No automated tests (PoC scope).
- No robust retry/backoff; per-query failures appear in `error`.
- Depends on each marketplace's public layout and APIs — site changes may break
  the scraper.
- Respect the marketplace terms of use; keep request volume reasonable.
