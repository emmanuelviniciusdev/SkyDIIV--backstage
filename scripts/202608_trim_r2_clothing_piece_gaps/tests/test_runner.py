"""R2 backup / trim runner tests with a fake S3 client."""

from __future__ import annotations

from datetime import date
from io import BytesIO
from types import SimpleNamespace
from typing import Any

from botocore.exceptions import ClientError
from PIL import Image

from runner import Config, run
from utils.logger import Logger

TODAY = date(2026, 8, 25)
BACKUP_PREFIX = "clothing-pieces--backup--2026-08-25/"


class _NullLog(Logger):
    def __init__(self) -> None:
        super().__init__(output_file=None)


class FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class FakeS3:
    def __init__(
        self,
        objects: dict[str, bytes],
        *,
        fail_copy: set[str] | None = None,
    ) -> None:
        self.objects = dict(objects)
        self.copies: list[tuple[str, str]] = []
        self.puts: list[str] = []
        self.put_content_types: list[str] = []
        self.fail_copy = fail_copy or set()

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        prefix = kwargs.get("Prefix", "")
        keys = sorted(
            k for k in self.objects if k.startswith(prefix) and not k.endswith("/")
        )
        return {"Contents": [{"Key": k} for k in keys], "IsTruncated": False}

    def copy_object(self, **kwargs: Any) -> None:
        source_key = kwargs["CopySource"]["Key"]
        dest_key = kwargs["Key"]
        if source_key in self.fail_copy:
            raise ClientError(
                {"Error": {"Code": "InternalError", "Message": "copy failed"}},
                "CopyObject",
            )
        self.copies.append((source_key, dest_key))
        self.objects[dest_key] = self.objects[source_key]

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        return {"Body": FakeBody(self.objects[kwargs["Key"]])}

    def put_object(self, **kwargs: Any) -> None:
        self.puts.append(kwargs["Key"])
        self.put_content_types.append(kwargs.get("ContentType", ""))
        self.objects[kwargs["Key"]] = kwargs["Body"]

    def head_bucket(self, **kwargs: Any) -> dict[str, Any]:
        return {}


def _png_padded() -> bytes:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    image.putpixel((3, 3), (10, 20, 30, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _cfg() -> Config:
    return Config(
        endpoint="https://example.r2.cloudflarestorage.com",
        access_key_id="id",
        secret_access_key="secret",
        bucket="skydiiv--production--assets",
        public_url="https://assets.skydiiv.space",
        cloudflare_api_token="token",
        cloudflare_zone_id="zone",
    )


def _args(**overrides: Any) -> SimpleNamespace:
    values = {
        "dry_run": False,
        "skip_backup": False,
        "limit": None,
        "purge_only": False,
        "env": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _recording_purge() -> tuple[list[dict[str, Any]], Any]:
    calls: list[dict[str, Any]] = []

    def post(zone_id: str, token: str, body: dict[str, Any]) -> dict[str, Any]:
        calls.append({"zone_id": zone_id, "token": token, "body": body})
        return {"success": True}

    return calls, post


def test_dry_run_does_not_copy_or_put() -> None:
    client = FakeS3({"clothing-pieces/a.png": _png_padded(), "outfits/look.png": b"x"})
    calls, post = _recording_purge()
    code = run(
        _args(dry_run=True),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 0
    assert client.copies == []
    assert client.puts == []
    assert calls == []


def test_occupied_backup_prefix_aborts_without_overwrite() -> None:
    client = FakeS3(
        {
            "clothing-pieces/a.png": _png_padded(),
            f"{BACKUP_PREFIX}old.png": b"old",
        }
    )
    calls, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 1
    assert client.copies == []
    assert client.puts == []
    assert calls == []


def test_backup_happens_before_puts() -> None:
    client = FakeS3({"clothing-pieces/a.png": _png_padded()})
    order: list[str] = []
    original_copy = client.copy_object
    original_put = client.put_object

    def copy_hook(**kwargs: Any) -> None:
        order.append("copy")
        original_copy(**kwargs)

    def put_hook(**kwargs: Any) -> None:
        order.append("put")
        original_put(**kwargs)

    client.copy_object = copy_hook  # type: ignore[method-assign]
    client.put_object = put_hook  # type: ignore[method-assign]

    _, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 0
    assert order == ["copy", "put"]
    assert client.copies == [
        ("clothing-pieces/a.png", f"{BACKUP_PREFIX}a.png"),
    ]
    assert client.puts == ["clothing-pieces/a.png"]
    assert client.put_content_types == ["image/png"]


def test_jpeg_is_backed_up_but_not_put() -> None:
    client = FakeS3({"clothing-pieces/photo.jpg": _jpeg()})
    _, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 0
    assert client.copies == [
        ("clothing-pieces/photo.jpg", f"{BACKUP_PREFIX}photo.jpg"),
    ]
    assert client.puts == []


def test_outfits_are_not_listed() -> None:
    client = FakeS3(
        {
            "clothing-pieces/a.png": _jpeg(),
            "outfits/look.png": _png_padded(),
        }
    )
    _, post = _recording_purge()
    run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert all(not src.startswith("outfits/") for src, _ in client.copies)
    assert "outfits/look.png" not in client.puts


def test_failed_backup_copy_blocks_puts() -> None:
    client = FakeS3(
        {"clothing-pieces/a.png": _png_padded()},
        fail_copy={"clothing-pieces/a.png"},
    )
    calls, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 1
    assert client.puts == []
    assert calls == []


def test_missing_purge_credentials_block_r2_writes() -> None:
    client = FakeS3({"clothing-pieces/a.png": _png_padded()})
    cfg = _cfg()
    cfg.cloudflare_api_token = ""
    calls, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=cfg,
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 1
    assert client.copies == []
    assert client.puts == []
    assert calls == []


def test_purge_body_and_dry_run_skips_post() -> None:
    client = FakeS3({"clothing-pieces/a.png": _png_padded()})
    calls, post = _recording_purge()
    run(
        _args(dry_run=True),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert calls == []

    calls2, post2 = _recording_purge()
    run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post2,
        connect_r2=False,
    )
    assert calls2[0]["body"] == {"prefixes": ["assets.skydiiv.space/clothing-pieces"]}


def test_purge_only_does_not_copy_or_put() -> None:
    client = FakeS3({"clothing-pieces/a.png": _png_padded()})
    calls, post = _recording_purge()
    code = run(
        _args(purge_only=True),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 0
    assert client.copies == []
    assert client.puts == []
    assert calls[0]["body"] == {"prefixes": ["assets.skydiiv.space/clothing-pieces"]}


def test_trim_error_continues_and_exits_nonzero() -> None:
    bad_png = bytes([0x89, 0x50, 0x4E, 0x47]) + b"not-a-png"
    client = FakeS3(
        {
            "clothing-pieces/bad.png": bad_png,
            "clothing-pieces/ok.jpg": _jpeg(),
        }
    )
    _, post = _recording_purge()
    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=post,
        connect_r2=False,
    )
    assert code == 1
    assert {src for src, _ in client.copies} == {
        "clothing-pieces/bad.png",
        "clothing-pieces/ok.jpg",
    }
    assert client.puts == []


def test_failed_purge_exits_nonzero() -> None:
    client = FakeS3({"clothing-pieces/a.png": _jpeg()})

    def boom(_zone: str, _token: str, _body: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("purge failed")

    code = run(
        _args(),
        _NullLog(),
        config=_cfg(),
        r2_client=client,
        today=TODAY,
        purge_post=boom,
        connect_r2=False,
    )
    assert code == 1
