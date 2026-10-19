"""Runner tests with a fake Postgres connection."""

from __future__ import annotations

from argparse import Namespace
from typing import Any

import pytest

from catalog import PIECE_COLOR_CATALOG, SCRIPT_ACTOR, unique_piece_size_names
from runner import apply_item, fetch_clothing_items, load_catalogs, plan_item, run
from utils.logger import Logger

ITEM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
TAG_PRETO = "11111111-1111-1111-1111-111111111111"
TAG_TAM_P = "22222222-2222-2222-2222-222222222222"
TAG_CASUAL = "33333333-3333-3333-3333-333333333333"
TAG_COLORIDO = "44444444-4444-4444-4444-444444444444"
TAG_ALGODAO = "55555555-5555-5555-5555-555555555555"
COLOR_BLACK = "color-black"
COLOR_WHITE = "color-white"
SIZE_M = "size-m"
SIZE_P = "size-p"


class _NullLog(Logger):
    def __init__(self) -> None:
        super().__init__(output_file=None)


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn
        self._rows: list[tuple[Any, ...]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        sql = " ".join(query.split())
        self.conn.queries.append((sql, params))
        lower = sql.lower()
        if lower.lstrip().startswith("select") and "from domains" in lower:
            self._rows = [
                (row["id"], row["name"], row["type"], row["source"])
                for row in self.conn.domains
            ]
            return
        if lower.lstrip().startswith("select") and "from clothing_items" in lower:
            force = "not exists" not in lower
            rows: list[tuple[Any, ...]] = []
            for item in self.conn.items:
                has_colors = any(color["item_id"] == item["id"] for color in self.conn.colors)
                missing = item["id_size"] is None or not has_colors
                if force or missing:
                    rows.append(
                        (
                            item["id"],
                            item["title"],
                            item["image_url"],
                            item["id_size"],
                            item["piece_type_source"],
                            has_colors,
                        )
                    )
            self._rows = rows
            return
        if "from clothing_item_tags" in lower and lower.lstrip().startswith("select"):
            wanted = set(params[0]) if params else set()
            self._rows = [
                (link["item_id"], link["tag_id"], tag["name"])
                for link in self.conn.item_tags
                for tag in self.conn.tags
                if tag["id"] == link["tag_id"] and link["item_id"] in wanted
            ]
            return
        if lower.lstrip().startswith("delete from clothing_item_colors"):
            item_id = params[0] if params else None
            self.conn.colors = [row for row in self.conn.colors if row["item_id"] != item_id]
            return
        if lower.lstrip().startswith("insert") and "clothing_item_colors" in lower:
            if self.conn.fail_insert:
                raise RuntimeError("insert failed")
            item_id, color_id, hex_value, created_by, updated_by = params  # type: ignore[misc]
            self.conn.colors.append(
                {
                    "item_id": item_id,
                    "color_id": color_id,
                    "hex": hex_value,
                    "created_by": created_by,
                    "updated_by": updated_by,
                }
            )
            return
        if lower.lstrip().startswith("update") and "clothing_items" in lower:
            id_size, updated_by, item_id = params  # type: ignore[misc]
            for item in self.conn.items:
                if item["id"] == item_id:
                    item["id_size"] = id_size
                    item["updated_by"] = updated_by
            return
        if lower.lstrip().startswith("delete from clothing_item_tags"):
            item_id, tag_ids = params  # type: ignore[misc]
            wanted = set(tag_ids)
            self.conn.item_tags = [
                link
                for link in self.conn.item_tags
                if not (link["item_id"] == item_id and link["tag_id"] in wanted)
            ]
            return
        if lower.lstrip().startswith("delete from tags"):
            tag_ids = set(params[0]) if params else set()
            linked = {link["tag_id"] for link in self.conn.item_tags}
            linked.update(link["tag_id"] for link in self.conn.outfit_tags)
            self.conn.tags = [
                tag for tag in self.conn.tags if tag["id"] not in tag_ids or tag["id"] in linked
            ]
            return

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._rows)


class FakeConn:
    def __init__(
        self,
        *,
        domains: list[dict[str, str | None]],
        items: list[dict[str, Any]],
        tags: list[dict[str, str]],
        item_tags: list[dict[str, str]],
        colors: list[dict[str, str]] | None = None,
        outfit_tags: list[dict[str, str]] | None = None,
        fail_insert: bool = False,
    ) -> None:
        self.domains = domains
        self.items = items
        self.tags = tags
        self.item_tags = item_tags
        self.colors = colors or []
        self.outfit_tags = outfit_tags or []
        self.fail_insert = fail_insert
        self.queries: list[tuple[str, tuple[Any, ...] | None]] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True


def _catalog_domains(*, omit_gold: bool = False) -> list[dict[str, str | None]]:
    domains: list[dict[str, str | None]] = []
    for name, _hex in PIECE_COLOR_CATALOG.items():
        if omit_gold and name == "Gold":
            continue
        slug = name.lower().replace(" ", "-")
        domains.append(
            {
                "id": f"color-{slug}",
                "name": name,
                "type": "piece_color",
                "source": "clothing_items",
            }
        )
    for name in unique_piece_size_names():
        domains.append(
            {
                "id": f"size-{name.lower()}",
                "name": name,
                "type": "piece_size",
                "source": "clothing_items",
            }
        )
    for source in ("top", "outerwear", "dress", "bottom", "footwear", "accessory"):
        domains.append(
            {
                "id": f"type-{source}",
                "name": source.title(),
                "type": "piece_type",
                "source": source,
            }
        )
    return domains


def _args(**overrides: Any) -> Namespace:
    values = {
        "dry_run": False,
        "force": False,
        "limit": None,
        "env": None,
    }
    values.update(overrides)
    return Namespace(**values)


def _mutating(conn: FakeConn) -> list[str]:
    kinds: list[str] = []
    for sql, _params in conn.queries:
        start = sql.lstrip().split(" ", 1)[0].upper()
        if start in {"INSERT", "UPDATE", "DELETE"}:
            kinds.append(start)
    return kinds


def test_load_catalogs_raises_when_gold_is_absent() -> None:
    conn = FakeConn(
        domains=_catalog_domains(omit_gold=True),
        items=[],
        tags=[],
        item_tags=[],
    )
    with pytest.raises(RuntimeError, match="Gold"):
        load_catalogs(conn)


def test_run_aborts_at_startup_when_gold_is_absent() -> None:
    conn = FakeConn(
        domains=_catalog_domains(omit_gold=True),
        items=[],
        tags=[],
        item_tags=[],
    )
    code = run(_args(), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 1
    assert conn.closed is True
    assert _mutating(conn) == []


def test_fetch_skips_items_that_already_have_colors_and_size() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": SIZE_M,
                "piece_type_source": "top",
            }
        ],
        tags=[{"id": TAG_PRETO, "name": "vermelho"}],
        item_tags=[{"item_id": ITEM_A, "tag_id": TAG_PRETO}],
        colors=[{"item_id": ITEM_A, "color_id": COLOR_BLACK, "hex": "#1A1A1A"}],
    )
    items = fetch_clothing_items(conn, force=False)
    assert items == []
    forced = fetch_clothing_items(conn, force=True)
    assert len(forced) == 1


def test_dry_run_issues_no_insert_update_delete() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": None,
                "piece_type_source": "top",
            }
        ],
        tags=[
            {"id": TAG_PRETO, "name": "preto"},
            {"id": TAG_TAM_P, "name": "tam. P"},
            {"id": TAG_CASUAL, "name": "casual"},
        ],
        item_tags=[
            {"item_id": ITEM_A, "tag_id": TAG_PRETO},
            {"item_id": ITEM_A, "tag_id": TAG_TAM_P},
            {"item_id": ITEM_A, "tag_id": TAG_CASUAL},
        ],
    )
    code = run(_args(dry_run=True), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    assert _mutating(conn) == []
    assert conn.commits == 0
    assert {tag["id"] for tag in conn.tags} == {TAG_PRETO, TAG_TAM_P, TAG_CASUAL}
    assert len(conn.item_tags) == 3
    assert conn.colors == []


def test_force_replaces_existing_colors() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": SIZE_M,
                "piece_type_source": "top",
            }
        ],
        tags=[{"id": TAG_PRETO, "name": "preto"}],
        item_tags=[{"item_id": ITEM_A, "tag_id": TAG_PRETO}],
        colors=[
            {
                "item_id": ITEM_A,
                "color_id": COLOR_WHITE,
                "hex": "#F5F5F5",
                "created_by": "user",
                "updated_by": "user",
            }
        ],
    )
    code = run(_args(force=True), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    assert [row["hex"] for row in conn.colors] == ["#1A1A1A"]
    assert conn.colors[0]["color_id"] == "color-black"
    assert conn.colors[0]["created_by"] == SCRIPT_ACTOR
    assert conn.colors[0]["updated_by"] == SCRIPT_ACTOR


def test_color_and_size_tags_deleted_only_after_successful_write() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": None,
                "piece_type_source": "top",
            }
        ],
        tags=[
            {"id": TAG_PRETO, "name": "preto"},
            {"id": TAG_TAM_P, "name": "tam. P"},
            {"id": TAG_CASUAL, "name": "casual"},
        ],
        item_tags=[
            {"item_id": ITEM_A, "tag_id": TAG_PRETO},
            {"item_id": ITEM_A, "tag_id": TAG_TAM_P},
            {"item_id": ITEM_A, "tag_id": TAG_CASUAL},
        ],
    )
    code = run(_args(), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    remaining_tag_ids = {link["tag_id"] for link in conn.item_tags}
    assert remaining_tag_ids == {TAG_CASUAL}
    assert {tag["id"] for tag in conn.tags} == {TAG_CASUAL}
    assert conn.items[0]["id_size"] == "size-p"
    assert conn.items[0]["updated_by"] == SCRIPT_ACTOR


def test_tags_stay_when_write_fails() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": None,
                "piece_type_source": "top",
            }
        ],
        tags=[{"id": TAG_PRETO, "name": "preto"}],
        item_tags=[{"item_id": ITEM_A, "tag_id": TAG_PRETO}],
        fail_insert=True,
    )
    code = run(_args(), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    assert conn.rollbacks == 1
    assert conn.item_tags == [{"item_id": ITEM_A, "tag_id": TAG_PRETO}]


def test_shared_tag_is_unlinked_but_not_deleted() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "one",
                "image_url": None,
                "id_size": SIZE_M,
                "piece_type_source": "top",
            },
            {
                "id": ITEM_B,
                "title": "two",
                "image_url": None,
                "id_size": SIZE_M,
                "piece_type_source": "top",
            },
        ],
        tags=[{"id": TAG_PRETO, "name": "preto"}],
        item_tags=[
            {"item_id": ITEM_A, "tag_id": TAG_PRETO},
            {"item_id": ITEM_B, "tag_id": TAG_PRETO},
        ],
    )
    catalogs = load_catalogs(conn)
    items = fetch_clothing_items(conn, force=False)
    first = next(item for item in items if item.id == ITEM_A)
    plan = plan_item(
        first,
        catalogs,
        force=False,
        downloads_used=0,
        download_limit=None,
        infer_image_color=lambda _url: None,
    )
    apply_item(conn, first, plan)
    assert {link["item_id"] for link in conn.item_tags} == {ITEM_B}
    assert {tag["id"] for tag in conn.tags} == {TAG_PRETO}


def test_non_matching_tags_stay_when_no_colors_or_size_written() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": None,
                "piece_type_source": "top",
            }
        ],
        tags=[
            {"id": TAG_CASUAL, "name": "casual"},
            {"id": TAG_ALGODAO, "name": "algodão"},
        ],
        item_tags=[
            {"item_id": ITEM_A, "tag_id": TAG_CASUAL},
            {"item_id": ITEM_A, "tag_id": TAG_ALGODAO},
        ],
    )
    code = run(_args(), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    assert {link["tag_id"] for link in conn.item_tags} == {TAG_CASUAL, TAG_ALGODAO}


def test_colorido_removed_after_image_fallback_write() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": "https://assets.example/red.png",
                "id_size": SIZE_M,
                "piece_type_source": "top",
            }
        ],
        tags=[{"id": TAG_COLORIDO, "name": "colorido"}],
        item_tags=[{"item_id": ITEM_A, "tag_id": TAG_COLORIDO}],
    )
    code = run(
        _args(),
        _NullLog(),
        connect=lambda env_file=None: conn,
        infer_image_color=lambda _url: ("Red", "#C0392B"),
    )
    assert code == 0
    assert [row["hex"] for row in conn.colors] == ["#C0392B"]
    assert conn.item_tags == []
    assert conn.tags == []


def test_limit_caps_image_downloads() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "one",
                "image_url": "https://assets.example/a.png",
                "id_size": SIZE_M,
                "piece_type_source": "top",
            },
            {
                "id": ITEM_B,
                "title": "two",
                "image_url": "https://assets.example/b.png",
                "id_size": SIZE_M,
                "piece_type_source": "top",
            },
        ],
        tags=[],
        item_tags=[],
    )
    calls: list[str] = []

    def extract(url: str) -> tuple[str, str]:
        calls.append(url)
        return ("Red", "#C0392B")

    code = run(
        _args(limit=1),
        _NullLog(),
        connect=lambda env_file=None: conn,
        infer_image_color=extract,
    )
    assert code == 0
    assert calls == ["https://assets.example/a.png"]
    colored_items = {row["item_id"] for row in conn.colors}
    assert colored_items == {ITEM_A}


def test_force_without_inferred_size_leaves_id_size() -> None:
    conn = FakeConn(
        domains=_catalog_domains(),
        items=[
            {
                "id": ITEM_A,
                "title": "camiseta",
                "image_url": None,
                "id_size": SIZE_M,
                "piece_type_source": "top",
            }
        ],
        tags=[{"id": TAG_PRETO, "name": "preto"}],
        item_tags=[{"item_id": ITEM_A, "tag_id": TAG_PRETO}],
        colors=[
            {
                "item_id": ITEM_A,
                "color_id": COLOR_WHITE,
                "hex": "#F5F5F5",
                "created_by": "user",
                "updated_by": "user",
            }
        ],
    )
    code = run(_args(force=True), _NullLog(), connect=lambda env_file=None: conn)
    assert code == 0
    assert conn.items[0]["id_size"] == SIZE_M
