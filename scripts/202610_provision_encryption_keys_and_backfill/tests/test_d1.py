"""D1 HTTP error parsing."""

from __future__ import annotations

import httpx
import pytest

from d1 import D1Error, _parse_json


def test_http_400_includes_cloudflare_permission_message() -> None:
    response = httpx.Response(
        400,
        json={
            "success": False,
            "errors": [
                {
                    "code": 7500,
                    "message": "You do not have permission to perform this operation.",
                }
            ],
        },
    )
    with pytest.raises(D1Error) as exc:
        _parse_json(response)
    text = str(exc.value)
    assert "HTTP 400" in text
    assert "You do not have permission to perform this operation." in text
    assert "worker query token" in text


def test_http_400_without_body_keeps_status_only() -> None:
    response = httpx.Response(400, content=b"")
    with pytest.raises(D1Error, match=r"Cloudflare D1 HTTP 400$"):
        _parse_json(response)
