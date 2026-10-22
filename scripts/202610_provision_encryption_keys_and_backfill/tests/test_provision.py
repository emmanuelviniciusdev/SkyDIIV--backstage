"""Provision unit tests with a mocked Cloudflare HTTP client."""

from __future__ import annotations

from d1 import CloudflareConfig
from envelope import LOCAL_TEST_KEK, LOCAL_TEST_LOOKUP_KEY, decode_aes_key, encode_key
from provision import provision
from tests.fake_d1 import FakeD1, json_response, key_row, make_http
from utils.logger import Logger

ACCOUNT = "account-1"
DB_NAME = "skydiiv--production"
EXISTING_UUID = "11111111-1111-1111-1111-111111111111"
FIXED_KEY = bytes(32 * [0x33])
FIXED_KEY_B64 = encode_key(FIXED_KEY)

CONFIG = CloudflareConfig(
    account_id=ACCOUNT,
    api_token="token",
    database_name=DB_NAME,
)


def _log() -> Logger:
    return Logger(output_file=None)


def test_create_when_missing() -> None:
    fake = FakeD1()
    code = provision(
        config=CONFIG,
        http=make_http(fake),
        log=_log(),
        dry_run=False,
        generate_key=lambda: FIXED_KEY,
    )
    assert code == 0
    assert len(fake.databases) == 1
    assert fake.databases[0]["name"] == DB_NAME
    assert fake.databases[0]["uuid"] == "created-uuid-0001"
    assert len(fake.keys) == 1
    assert fake.keys[0]["kek_version"] == 1
    assert fake.keys[0]["lookup_key_version"] == 1
    assert fake.keys[0]["created_by"] == (
        "script:202610_provision_encryption_keys_and_backfill"
    )
    create_posts = [
        call
        for call in fake.post_calls()
        if call[1].endswith("/d1/database")
    ]
    assert len(create_posts) == 1


def test_reuse_existing_database() -> None:
    fake = FakeD1(databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}])
    code = provision(
        config=CONFIG,
        http=make_http(fake),
        log=_log(),
        dry_run=False,
        generate_key=lambda: FIXED_KEY,
    )
    assert code == 0
    assert [db["uuid"] for db in fake.databases] == [EXISTING_UUID]
    create_posts = [
        call
        for call in fake.post_calls()
        if call[1].endswith("/d1/database")
    ]
    assert create_posts == []
    assert len(fake.keys) == 1


def test_dry_run_issues_no_post_create_or_query_writes() -> None:
    fake = FakeD1()
    code = provision(config=CONFIG, http=make_http(fake), log=_log(), dry_run=True)
    assert code == 0
    assert fake.databases == []
    assert fake.keys == []
    assert fake.post_calls() == []

    existing = FakeD1(databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}])
    code = provision(config=CONFIG, http=make_http(existing), log=_log(), dry_run=True)
    assert code == 0
    assert existing.keys == []
    assert existing.post_calls() == []


def test_empty_table_inserts_version_1_not_test_vectors() -> None:
    fake = FakeD1(databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}])
    code = provision(config=CONFIG, http=make_http(fake), log=_log(), dry_run=False)
    assert code == 0
    assert len(fake.keys) == 1
    row = fake.keys[0]
    assert row["kek_version"] == 1
    assert row["lookup_key_version"] == 1
    kek = decode_aes_key(row["kek"])
    lookup = decode_aes_key(row["lookup_key"])
    assert len(kek) == 32
    assert len(lookup) == 32
    assert kek != LOCAL_TEST_KEK
    assert lookup != LOCAL_TEST_LOOKUP_KEY
    assert kek != lookup
    inserts = fake.insert_calls()
    assert len(inserts) == 1
    assert "datetime('now')" in inserts[0]["sql"]


def test_existing_row_skip() -> None:
    original = key_row(bytes(32 * [0x44]), bytes(32 * [0x55]))
    fake = FakeD1(
        databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}],
        keys=[original],
    )
    code = provision(
        config=CONFIG,
        http=make_http(fake),
        log=_log(),
        dry_run=False,
        generate_key=lambda: FIXED_KEY,
    )
    assert code == 0
    assert len(fake.keys) == 1
    assert fake.keys[0]["kek"] == original["kek"]
    assert fake.keys[0]["lookup_key"] == original["lookup_key"]
    assert fake.insert_calls() == []


def test_create_table_permission_error_is_logged(capsys) -> None:
    class ReadOnlyD1(FakeD1):
        def _query(self, body):
            sql = " ".join(str(body.get("sql", "")).split()).upper()
            if "CREATE TABLE" in sql:
                return json_response(
                    {
                        "success": False,
                        "errors": [
                            {
                                "code": 7500,
                                "message": (
                                    "You do not have permission to perform this operation."
                                ),
                            }
                        ],
                    },
                    400,
                )
            return super()._query(body)

    fake = ReadOnlyD1(databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}])
    code = provision(config=CONFIG, http=make_http(fake), log=_log(), dry_run=False)
    assert code == 1
    assert fake.keys == []
    out = capsys.readouterr().out
    assert "You do not have permission to perform this operation." in out
    assert "worker query token" in out


def test_logs_contain_uuid_but_not_key_material(capsys) -> None:
    fake = FakeD1(databases=[{"uuid": EXISTING_UUID, "name": DB_NAME}])
    code = provision(
        config=CONFIG,
        http=make_http(fake),
        log=_log(),
        dry_run=False,
        generate_key=lambda: FIXED_KEY,
    )
    assert code == 0
    out = capsys.readouterr().out
    assert EXISTING_UUID in out
    assert FIXED_KEY_B64 not in out
    assert fake.keys[0]["kek"] not in out
    assert fake.keys[0]["lookup_key"] not in out
    assert "kek=" not in out.lower() or FIXED_KEY_B64 not in out
