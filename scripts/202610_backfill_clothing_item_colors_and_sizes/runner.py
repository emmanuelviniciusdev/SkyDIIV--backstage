"""
Backfill clothing_item_colors and clothing_items.id_size from tags (and Color Thief).

Usage
-----
    cd scripts/202610_backfill_clothing_item_colors_and_sizes
    uv sync
    uv run python __main__.py --dry-run
    uv run python __main__.py
    uv run python __main__.py --force --limit 20 --env /path/to/.env

Exit codes
----------
    0  completed (or --dry-run finished)
    1  fatal error (connection, missing catalog domain, …)
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from catalog import (
    DOMAIN_SOURCE_CLOTHING_ITEMS,
    PIECE_COLOR_CATALOG,
    PIECE_COLOR_NAMES,
    SCRIPT_ACTOR,
)
from color_matcher import infer_colors_from_tags
from image_color import ImageColorError, infer_color_from_image_url
from size_matcher import infer_size_from_tags

_SCRIPT_DIR = Path(__file__).resolve().parent
_SCRIPTS_ROOT = _SCRIPT_DIR.parent
if str(_SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_ROOT))

from utils.db import get_connection  # noqa: E402
from utils.logger import Logger  # noqa: E402

_OUTPUT_FILE = _SCRIPT_DIR / "output.txt"
_SCRIPT_NAME = "202610_backfill_clothing_item_colors_and_sizes"

ConnectFn = Callable[..., Any]
InferImageColorFn = Callable[..., tuple[str, str] | None]


@dataclass(frozen=True)
class ItemTag:
    id: str
    name: str


@dataclass
class ClothingItemRecord:
    id: str
    title: str
    image_url: str | None
    id_size: str | None
    piece_type_source: str | None
    has_colors: bool
    tags: list[ItemTag] = field(default_factory=list)


@dataclass(frozen=True)
class ResolvedColor:
    name: str
    hex: str
    color_id: str


@dataclass(frozen=True)
class ResolvedCatalogs:
    colors_by_name: dict[str, ResolvedColor]
    sizes_by_name: dict[str, str]


@dataclass(frozen=True)
class ItemPlan:
    colors: tuple[ResolvedColor, ...]
    size_name: str | None
    size_id: str | None
    color_tag_ids: tuple[str, ...]
    size_tag_ids: tuple[str, ...]
    write_colors: bool
    write_size: bool
    image_attempted: bool
    size_conflict: bool


def load_catalogs(conn: Any) -> ResolvedCatalogs:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, type, source
              FROM domains
             WHERE type IN ('piece_color', 'piece_size', 'piece_type')
            """
        )
        rows = cur.fetchall()

    colors_by_name: dict[str, ResolvedColor] = {}
    sizes_by_name: dict[str, str] = {}
    for row_id, name, domain_type, source in rows:
        if domain_type == "piece_color" and source == DOMAIN_SOURCE_CLOTHING_ITEMS:
            hex_value = PIECE_COLOR_CATALOG.get(name)
            if hex_value is None:
                continue
            colors_by_name[name] = ResolvedColor(
                name=name,
                hex=hex_value,
                color_id=str(row_id),
            )
        elif domain_type == "piece_size" and source == DOMAIN_SOURCE_CLOTHING_ITEMS:
            sizes_by_name[name] = str(row_id)

    missing = [name for name in PIECE_COLOR_NAMES if name not in colors_by_name]
    if missing:
        raise RuntimeError(
            "Missing piece_color domains (source=clothing_items): " + ", ".join(missing)
        )
    return ResolvedCatalogs(colors_by_name=colors_by_name, sizes_by_name=sizes_by_name)


def fetch_clothing_items(conn: Any, force: bool) -> list[ClothingItemRecord]:
    if force:
        where = ""
    else:
        where = """
            WHERE ci.id_size IS NULL
               OR NOT EXISTS (
                    SELECT 1
                      FROM clothing_item_colors cic
                     WHERE cic.clothing_item_id = ci.id
               )
        """
    query = f"""
        SELECT ci.id,
               ci.title,
               ci.image_url,
               ci.id_size,
               pt.source AS piece_type_source,
               EXISTS (
                   SELECT 1
                     FROM clothing_item_colors cic
                    WHERE cic.clothing_item_id = ci.id
               ) AS has_colors
          FROM clothing_items ci
          LEFT JOIN domains pt
            ON pt.id = ci.piece_type_id
         {where}
         ORDER BY ci.id
    """
    with conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()

    items = [
        ClothingItemRecord(
            id=str(row[0]),
            title=row[1],
            image_url=row[2],
            id_size=str(row[3]) if row[3] else None,
            piece_type_source=row[4],
            has_colors=bool(row[5]),
        )
        for row in rows
    ]
    if not items:
        return items

    ids = [item.id for item in items]
    tags_by_item: dict[str, list[ItemTag]] = {item.id: [] for item in items}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT cit.clothing_item_id, t.id, t.name
              FROM clothing_item_tags cit
              JOIN tags t ON t.id = cit.tag_id
             WHERE cit.clothing_item_id = ANY(%s)
             ORDER BY t.name
            """,
            (ids,),
        )
        for item_id, tag_id, name in cur.fetchall():
            tags_by_item[str(item_id)].append(ItemTag(id=str(tag_id), name=name))
    for item in items:
        item.tags = tags_by_item[item.id]
    return items


def plan_item(
    item: ClothingItemRecord,
    catalogs: ResolvedCatalogs,
    *,
    force: bool,
    downloads_used: int,
    download_limit: int | None,
    infer_image_color: InferImageColorFn,
) -> ItemPlan:
    needs_colors = force or not item.has_colors
    needs_size = force or item.id_size is None
    tag_names = [tag.name for tag in item.tags]

    color_names, color_related = infer_colors_from_tags(tag_names)
    size_match = infer_size_from_tags(tag_names, item.piece_type_source)

    image_attempted = False
    if needs_colors and not color_names:
        under_limit = download_limit is None or downloads_used < download_limit
        if item.image_url and under_limit:
            image_attempted = True
            extracted = infer_image_color(item.image_url)
            if extracted is not None:
                color_names = (extracted[0],)

    colors: list[ResolvedColor] = []
    for name in color_names:
        resolved = catalogs.colors_by_name.get(name)
        if resolved is not None:
            colors.append(resolved)

    size_id = None
    if needs_size and size_match.name:
        size_id = catalogs.sizes_by_name.get(size_match.name)

    write_colors = needs_colors and bool(colors)
    write_size = needs_size and size_id is not None

    color_tag_ids = tuple(item.tags[i].id for i in color_related) if write_colors else ()
    size_tag_ids = (
        tuple(item.tags[i].id for i in size_match.related_indexes) if write_size else ()
    )
    return ItemPlan(
        colors=tuple(colors),
        size_name=size_match.name if write_size else None,
        size_id=size_id if write_size else None,
        color_tag_ids=color_tag_ids,
        size_tag_ids=size_tag_ids,
        write_colors=write_colors,
        write_size=write_size,
        image_attempted=image_attempted,
        size_conflict=bool(write_size and size_match.conflict),
    )


def _delete_related_tags(
    conn: Any,
    item_id: str,
    tag_ids: Sequence[str],
) -> None:
    unique_ids = list(dict.fromkeys(tag_ids))
    if not unique_ids:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM clothing_item_tags
             WHERE clothing_item_id = %s
               AND tag_id = ANY(%s)
            """,
            (item_id, unique_ids),
        )
        cur.execute(
            """
            DELETE FROM tags
             WHERE id = ANY(%s)
               AND NOT EXISTS (
                    SELECT 1 FROM clothing_item_tags cit WHERE cit.tag_id = tags.id
               )
               AND NOT EXISTS (
                    SELECT 1 FROM outfit_tags ot WHERE ot.tag_id = tags.id
               )
            """,
            (unique_ids,),
        )


def apply_item(conn: Any, item: ClothingItemRecord, plan: ItemPlan) -> None:
    with conn.cursor() as cur:
        if plan.write_colors:
            cur.execute(
                "DELETE FROM clothing_item_colors WHERE clothing_item_id = %s",
                (item.id,),
            )
            for color in plan.colors:
                cur.execute(
                    """
                    INSERT INTO clothing_item_colors (
                        id, clothing_item_id, color_id, hex,
                        created_at, created_by, updated_at, updated_by
                    )
                    VALUES (
                        gen_random_uuid(), %s, %s, %s,
                        NOW(), %s, NOW(), %s
                    )
                    """,
                    (item.id, color.color_id, color.hex, SCRIPT_ACTOR, SCRIPT_ACTOR),
                )
        if plan.write_size:
            cur.execute(
                """
                UPDATE clothing_items
                   SET id_size = %s,
                       updated_at = NOW(),
                       updated_by = %s
                 WHERE id = %s
                """,
                (plan.size_id, SCRIPT_ACTOR, item.id),
            )
    tag_ids = (*plan.color_tag_ids, *plan.size_tag_ids)
    _delete_related_tags(conn, item.id, tag_ids)


def _log_plan(log: Logger, item: ClothingItemRecord, plan: ItemPlan, dry_run: bool) -> None:
    color_label = ",".join(color.name for color in plan.colors) or "-"
    size_label = plan.size_name or "-"
    prefix = "WOULD " if dry_run else ""
    log.info(
        f"{prefix}ASSIGN  id={item.id}  title={item.title!r}  "
        f"colors={color_label}  size={size_label}"
    )
    if dry_run and (plan.color_tag_ids or plan.size_tag_ids):
        log.info(
            f"WOULD DELETE TAGS  id={item.id}  "
            f"color_tags={len(plan.color_tag_ids)}  size_tags={len(plan.size_tag_ids)}"
        )


def run(
    args: argparse.Namespace,
    log: Logger,
    *,
    connect: ConnectFn = get_connection,
    infer_image_color: InferImageColorFn = infer_color_from_image_url,
) -> int:
    log.info("Connecting to the database…")
    try:
        conn = connect(env_file=args.env)
    except Exception as exc:
        log.error(f"Failed to connect: {exc}")
        return 1

    try:
        log.info("Loading piece_color / piece_size / piece_type domains…")
        catalogs = load_catalogs(conn)
        log.info(
            f"Loaded {len(catalogs.colors_by_name)} catalog colors and "
            f"{len(catalogs.sizes_by_name)} sizes."
        )

        log.info(f"Fetching clothing items (force={args.force})…")
        items = fetch_clothing_items(conn, force=args.force)
        log.info(f"Found {len(items)} item(s) to process.")

        stats = {"updated": 0, "skipped": 0, "failed": 0}
        downloads_used = 0

        for item in items:
            try:
                plan = plan_item(
                    item,
                    catalogs,
                    force=args.force,
                    downloads_used=downloads_used,
                    download_limit=args.limit,
                    infer_image_color=infer_image_color,
                )
            except ImageColorError as exc:
                log.warning(f"IMAGE SKIP  id={item.id}  title={item.title!r}  error={exc}")
                downloads_used += 1
                plan = plan_item(
                    item,
                    catalogs,
                    force=args.force,
                    downloads_used=downloads_used,
                    download_limit=0,
                    infer_image_color=lambda _url: None,
                )
            else:
                if plan.image_attempted:
                    downloads_used += 1
                    if not plan.colors:
                        log.warning(
                            f"IMAGE SKIP  id={item.id}  title={item.title!r}  "
                            "no catalog color from image"
                        )

            if not plan.write_colors and not plan.write_size:
                stats["skipped"] += 1
                continue

            if plan.size_conflict:
                log.warning(
                    f"CONFLICTING SIZES  id={item.id}  title={item.title!r}  "
                    f"using={plan.size_name!r}"
                )
            _log_plan(log, item, plan, dry_run=args.dry_run)
            if args.dry_run:
                stats["updated"] += 1
                continue

            try:
                apply_item(conn, item, plan)
                conn.commit()
                stats["updated"] += 1
            except Exception as exc:
                conn.rollback()
                log.warning(
                    f"ITEM FAILED  id={item.id}  title={item.title!r}  error={exc}"
                )
                stats["failed"] += 1

        if args.dry_run:
            log.info("Dry-run mode — no changes written to the database.")
        log.info(
            f"Done.  updated={stats['updated']}  "
            f"skipped={stats['skipped']}  failed={stats['failed']}"
        )
        return 0
    except Exception as exc:
        log.error(str(exc))
        return 1
    finally:
        conn.close()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill clothing-item catalog colors and type-scoped sizes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log intended colors, sizes, and tag deletions without writing.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-process all items; replace existing colors when inferred.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Cap the number of image downloads after tag matching.",
    )
    parser.add_argument(
        "--env",
        metavar="PATH",
        default=None,
        help="Path to a .env file containing DATABASE_URL_UNPOOLED / DATABASE_URL.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    with Logger(output_file=_OUTPUT_FILE) as log:
        log.info(
            f"{_SCRIPT_NAME} started  dry_run={args.dry_run}  "
            f"force={args.force}  limit={args.limit}"
        )
        code = run(args, log)
        log.info(f"{_SCRIPT_NAME} finished  exit_code={code}")
    return code
