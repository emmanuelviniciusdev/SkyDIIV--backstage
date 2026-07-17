"""
PoC — Web scraper for shopping suggestions in Brazilian marketplaces.

Searches one or more product descriptions and returns structured listings
(description, price, images, link) from supported stores.

Usage
-----
    # from inside this folder
    uv run python __main__.py "camiseta oversized" "calça jeans"

    # read queries from a JSON or plain-text file
    uv run python __main__.py --input queries.json

    # sequential execution (default is parallel)
    uv run python __main__.py --sequential "moletom" "jaqueta"

    # save output to a file
    uv run python __main__.py --output results.json "vestido floral"

Exit codes
----------
    0  completed (individual query errors are reported in the JSON payload)
    1  fatal error (invalid arguments, scraper startup failure, etc.)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from scrapers.enjoei import EnjoeiScraper, create_shared_scraper

_OUTPUT_FILE = Path(__file__).parent / "output.json"


def _load_queries_from_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []

    if path.suffix.lower() == ".json":
        payload = json.loads(text)
        if isinstance(payload, list):
            return [str(item).strip() for item in payload if str(item).strip()]
        if isinstance(payload, dict) and "queries" in payload:
            return [str(item).strip() for item in payload["queries"] if str(item).strip()]
        raise ValueError("JSON input must be a list of queries or an object with a 'queries' key.")

    return [line.strip() for line in text.splitlines() if line.strip()]


async def _run_searches(
    queries: list[str],
    *,
    store: str,
    limit: int,
    parallel: bool,
    headless: bool,
) -> list[dict[str, Any]]:
    if store != "enjoei":
        raise ValueError(f"Unsupported store: {store!r}. Available: enjoei")

    scraper = await create_shared_scraper(headless=headless)

    try:
        if parallel:
            results = await asyncio.gather(
                *[scraper.search(query, limit=limit) for query in queries]
            )
        else:
            results = []
            for query in queries:
                results.append(await scraper.search(query, limit=limit))

        return [result.to_dict() for result in results]
    finally:
        await scraper.close()


def _build_payload(
    store: str,
    query_results: list[dict[str, Any]],
) -> dict[str, Any]:
    total_items = sum(len(entry["items"]) for entry in query_results)
    failed_queries = [entry["query"] for entry in query_results if entry.get("error")]

    return {
        "searched_at": datetime.now(timezone.utc).isoformat(),
        "store": store,
        "summary": {
            "queries": len(query_results),
            "items": total_items,
            "failed_queries": failed_queries,
        },
        "results": query_results,
    }


def run(args: argparse.Namespace) -> int:
    queries = list(args.queries)

    if args.input:
        queries.extend(_load_queries_from_file(Path(args.input)))

    queries = [query.strip() for query in queries if query.strip()]
    if not queries:
        print("No search queries provided.", file=sys.stderr)
        return 1

    try:
        query_results = asyncio.run(
            _run_searches(
                queries,
                store=args.store,
                limit=args.limit,
                parallel=not args.sequential,
                headless=not args.headed,
            )
        )
    except Exception as exc:
        print(f"Fatal error: {exc}", file=sys.stderr)
        return 1

    payload = _build_payload(args.store, query_results)
    output_text = json.dumps(payload, ensure_ascii=False, indent=2)

    print(output_text)

    output_path = Path(args.output) if args.output else _OUTPUT_FILE
    output_path.write_text(output_text + "\n", encoding="utf-8")

    return 0


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="PoC web scraper for shopping suggestions in Brazilian marketplaces.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "queries",
        nargs="*",
        help="Product descriptions to search for (e.g. 'camiseta oversized').",
    )
    parser.add_argument(
        "--input",
        "-i",
        metavar="PATH",
        help="File with queries (.json list or one query per line).",
    )
    parser.add_argument(
        "--store",
        default="enjoei",
        choices=["enjoei"],
        help="Marketplace to scrape (default: enjoei).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5,
        metavar="N",
        help="Maximum number of listings per query (default: 5).",
    )
    parser.add_argument(
        "--sequential",
        action="store_true",
        help="Run searches one after another instead of in parallel.",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Run the browser with a visible window (debug).",
    )
    parser.add_argument(
        "--output",
        "-o",
        metavar="PATH",
        help="Write JSON output to this file (default: output.json in this folder).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(run(_parse_args()))
