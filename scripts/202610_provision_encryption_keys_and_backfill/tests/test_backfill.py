"""Backfill unit tests with mocked D1 and Neon."""

from __future__ import annotations

from envelope import (
    BACKFILL_TABLES,
    ENCRYPTED_MODELS,
    email_lookup_for,
    encode_key,
    open_model_values,
)
from backfill import backfill
from d1 import CloudflareConfig
from tests.fake_d1 import FakeD1, key_row, make_http
from tests.fake_neon import FakeConn
from utils.logger import Logger

KEK = bytes(32 * [7])
LOOKUP = bytes(32 * [9])
UUID = "11111111-1111-1111-1111-111111111111"
CONFIG = CloudflareConfig(
    account_id="account-1",
    api_token="token",
    database_name="skydiiv--production",
)
LISTED = {name: spec.fields for name, spec in ENCRYPTED_MODELS.items()}


def _log() -> Logger:
    return Logger(output_file=None)


def _d1(keys: list[dict] | None = None) -> FakeD1:
    return FakeD1(
        databases=[{"uuid": UUID, "name": "skydiiv--production"}],
        keys=keys if keys is not None else [key_row(KEK, LOOKUP)],
    )


def _user(**overrides):
    row = {
        "id": "user-1",
        "first_name": "Ada",
        "last_name": "Lovelace",
        "preferred_name": None,
        "email": "Ada@Example.com",
        "birth_date": None,
        "profile_picture_url": None,
        "dek": None,
        "kek_version": None,
        "encrypted_columns": None,
        "lookup_columns": None,
        "email_lookup": None,
        "created_by": "Ada@Example.com",
        "updated_by": "Ada@Example.com",
    }
    row.update(overrides)
    return row


def _summary(**overrides):
    row = {
        "id": "sum-1",
        "summary": "",
        "dek": None,
        "kek_version": None,
        "encrypted_columns": None,
        "lookup_columns": None,
    }
    row.update(overrides)
    return row


def _outfit(**overrides):
    row = {
        "id": "outfit-1",
        "title": "Monday look",
        "image_url": None,
        "dek": None,
        "kek_version": None,
        "encrypted_columns": None,
        "lookup_columns": None,
        "created_by": None,
        "updated_by": None,
    }
    row.update(overrides)
    return row


def _panorama(**overrides):
    row = {
        "id": "pano-1",
        "content": "already-ciphertext",
        "dek": encode_key(bytes(32 * [1])),
        "kek_version": 1,
        "encrypted_columns": ["content"],
        "lookup_columns": None,
    }
    row.update(overrides)
    return row


def _item(**overrides):
    row = {
        "id": "item-1",
        "title": "Linen shirt",
        "image_url": "https://img",
        "dek": None,
        "kek_version": None,
        "encrypted_columns": None,
        "lookup_columns": None,
        "created_by": "Ada@Example.com",
        "updated_by": None,
    }
    row.update(overrides)
    return row


def _run(conn: FakeConn, fake: FakeD1, **kwargs) -> int:
    return backfill(
        config=CONFIG,
        http=make_http(fake),
        log=_log(),
        connect=lambda **_: conn,
        **kwargs,
    )


def test_dry_run_issues_no_update() -> None:
    conn = FakeConn(
        {"users": {"user-1": _user()}},
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=True, table="users")
    assert code == 0
    assert conn.updates() == []
    assert conn.tables["users"]["user-1"]["email"] == "Ada@Example.com"
    assert conn.tables["users"]["user-1"]["dek"] is None


def test_user_email_and_names_become_ciphertext_plus_email_lookup() -> None:
    conn = FakeConn({"users": {"user-1": _user()}}, LISTED)
    code = _run(conn, _d1(), dry_run=False, table="users")
    assert code == 0
    row = conn.tables["users"]["user-1"]
    assert row["first_name"] != "Ada"
    assert row["email"] not in {"Ada@Example.com", "ada@example.com"}
    assert row["preferred_name"] is None
    assert row["dek"] is not None
    assert row["kek_version"] == 1
    assert row["lookup_key_version"] == 1
    assert "first_name" in row["encrypted_columns"]
    assert "email" in row["encrypted_columns"]
    assert "preferred_name" not in row["encrypted_columns"]
    assert row["email_lookup"] not in {None, "ada@example.com", "Ada@Example.com"}
    assert "email" in row["lookup_columns"]
    assert "created_by" in row["encrypted_columns"]
    opened = open_model_values(
        table="users",
        row_id="user-1",
        values=row,
        dek=row["dek"],
        kek=KEK,
        encrypted_columns=row["encrypted_columns"],
    )
    assert opened["created_by"] == row["email_lookup"]
    assert opened["created_by"] == email_lookup_for("Ada@Example.com", LOOKUP)
    assert opened["updated_by"] == opened["created_by"]


def test_empty_summary_is_sealed() -> None:
    conn = FakeConn(
        {"summaries_feedbacks_automatic_thrifting": {"sum-1": _summary()}},
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=False, table="summaries_feedbacks_automatic_thrifting")
    assert code == 0
    row = conn.tables["summaries_feedbacks_automatic_thrifting"]["sum-1"]
    assert row["summary"] != ""
    assert "summary" in row["encrypted_columns"]
    assert row["dek"] is not None


def test_title_only_outfit_is_skipped() -> None:
    conn = FakeConn({"outfits": {"outfit-1": _outfit()}}, LISTED)
    code = _run(conn, _d1(), dry_run=False, table="outfits")
    assert code == 0
    row = conn.tables["outfits"]["outfit-1"]
    assert row["dek"] is None
    assert row["title"] == "Monday look"
    assert row["image_url"] is None
    assert conn.updates() == []


def test_service_identifier_actor_is_sealed_as_is() -> None:
    conn = FakeConn(
        {
            "wardrobe_panorama": {
                "pano-2": {
                    "id": "pano-2",
                    "content": "# Wardrobe",
                    "dek": None,
                    "kek_version": None,
                    "encrypted_columns": None,
                    "lookup_columns": None,
                    "created_by": "worker-ai-workflows",
                    "updated_by": "worker-ai-workflows",
                }
            }
        },
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=False, table="wardrobe_panorama")
    assert code == 0
    row = conn.tables["wardrobe_panorama"]["pano-2"]
    opened = open_model_values(
        table="wardrobe_panorama",
        row_id="pano-2",
        values=row,
        dek=row["dek"],
        kek=KEK,
        encrypted_columns=row["encrypted_columns"],
    )
    assert opened["created_by"] == "worker-ai-workflows"
    assert opened["content"] == "# Wardrobe"


def test_tag_name_stays_plaintext_while_actor_is_sealed() -> None:
    conn = FakeConn(
        {
            "tags": {
                "tag-1": {
                    "id": "tag-1",
                    "name": "casual",
                    "created_by": "Ada@Example.com",
                    "updated_by": None,
                    "dek": None,
                    "kek_version": None,
                    "encrypted_columns": None,
                    "lookup_columns": None,
                }
            }
        },
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=False, table="tags")
    assert code == 0
    row = conn.tables["tags"]["tag-1"]
    assert row["name"] == "casual"
    opened = open_model_values(
        table="tags",
        row_id="tag-1",
        values=row,
        dek=row["dek"],
        kek=KEK,
        encrypted_columns=row["encrypted_columns"],
    )
    assert opened["created_by"] == email_lookup_for("Ada@Example.com", LOOKUP)


def test_dek_set_rows_are_unchanged() -> None:
    original = _panorama()
    conn = FakeConn({"wardrobe_panorama": {"pano-1": dict(original)}}, LISTED)
    code = _run(conn, _d1(), dry_run=False, table="wardrobe_panorama")
    assert code == 0
    row = conn.tables["wardrobe_panorama"]["pano-1"]
    assert row["content"] == original["content"]
    assert row["dek"] == original["dek"]
    assert row["kek_version"] == original["kek_version"]
    assert row["encrypted_columns"] == original["encrypted_columns"]
    assert conn.updates() == []


def test_missing_keys_exit_before_any_update() -> None:
    conn = FakeConn({"users": {"user-1": _user()}}, LISTED)
    called = {"connect": False}

    def connect(**_: object) -> FakeConn:
        called["connect"] = True
        return conn

    code = backfill(
        config=CONFIG,
        http=make_http(_d1(keys=[])),
        log=_log(),
        dry_run=False,
        connect=connect,
        table="users",
    )
    assert code == 1
    assert called["connect"] is False
    assert conn.updates() == []
    assert conn.tables["users"]["user-1"]["email"] == "Ada@Example.com"


def test_one_failing_user_does_not_block_the_next() -> None:
    conn = FakeConn(
        {
            "users": {
                "user-1": _user(id="user-1"),
                "user-2": _user(id="user-2", first_name="Grace", email="grace@example.com"),
            }
        },
        LISTED,
        fail_update_ids={"user-1"},
    )
    code = _run(conn, _d1(), dry_run=False, table="users")
    assert code == 0
    first = conn.tables["users"]["user-1"]
    second = conn.tables["users"]["user-2"]
    assert first["email"] == "Ada@Example.com"
    assert first["dek"] is None
    assert second["first_name"] != "Grace"
    assert second["dek"] is not None
    assert second["email_lookup"] is not None


def test_clothing_item_title_stays_plaintext_and_tags_are_untouched() -> None:
    conn = FakeConn(
        {
            "clothing_items": {"item-1": _item()},
            "tags": {"tag-1": {"id": "tag-1", "name": "casual"}},
        },
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=False, table="clothing_items")
    assert code == 0
    item = conn.tables["clothing_items"]["item-1"]
    assert item["title"] == "Linen shirt"
    assert item["image_url"] != "https://img"
    assert item["dek"] is not None
    assert item.get("lookup_key_version") is None
    opened = open_model_values(
        table="clothing_items",
        row_id="item-1",
        values=item,
        dek=item["dek"],
        kek=KEK,
        encrypted_columns=item["encrypted_columns"],
    )
    assert opened["created_by"] == email_lookup_for("Ada@Example.com", LOOKUP)
    assert conn.tables["tags"]["tag-1"]["name"] == "casual"
    assert not any(" from tags" in query[0].lower() for query in conn.queries)


def test_limit_and_table_flags() -> None:
    conn = FakeConn(
        {
            "users": {
                "user-1": _user(id="user-1"),
                "user-2": _user(id="user-2", email="grace@example.com"),
            },
            "outfits": {
                "outfit-2": _outfit(id="outfit-2", image_url="https://outfit"),
            },
        },
        LISTED,
    )
    code = _run(conn, _d1(), dry_run=False, table="users", limit=1)
    assert code == 0
    assert conn.tables["users"]["user-1"]["dek"] is not None
    assert conn.tables["users"]["user-2"]["dek"] is None
    assert conn.tables["outfits"]["outfit-2"]["image_url"] == "https://outfit"


def test_backfill_table_order_matches_spec() -> None:
    assert BACKFILL_TABLES == (
        "users",
        "weekly_outfit_preferences",
        "shopping_suggestions_preferences",
        "clothing_items",
        "feedbacks_automatic_thrifting",
        "summaries_feedbacks_automatic_thrifting",
        "llm_interactions",
        "outfits",
        "wardrobe_panorama",
        "tags",
    )
