"""Cloudflare Instant Purge for the public clothing-pieces prefix."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse

DEFAULT_PUBLIC_URL = "https://assets.skydiiv.space"
PURGE_API = "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache"

PurgePostFn = Callable[[str, str, dict[str, Any]], dict[str, Any]]


def purge_prefix_from_public_url(public_url: str) -> str:
    host = urlparse(public_url.rstrip("/")).netloc
    if not host:
        raise ValueError(f"R2_PUBLIC_URL has no host: {public_url!r}")
    return f"{host}/clothing-pieces"


def purge_body(prefix: str) -> dict[str, list[str]]:
    return {"prefixes": [prefix]}


def post_purge(
    zone_id: str,
    token: str,
    body: dict[str, Any],
    *,
    timeout_s: float = 60,
) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8")
    url = PURGE_API.format(zone_id=zone_id)
    request = urllib.request.Request(url, data=payload, method="POST")
    request.add_header("Authorization", f"Bearer {token}")
    request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Cloudflare purge HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cloudflare purge request failed: {exc}") from exc

    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Cloudflare purge returned non-JSON") from exc

    if not isinstance(data, dict) or not data.get("success"):
        raise RuntimeError(f"Cloudflare purge unsuccessful: {data!r}")
    return data
