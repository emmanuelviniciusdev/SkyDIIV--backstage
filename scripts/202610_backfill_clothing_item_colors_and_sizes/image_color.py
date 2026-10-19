"""Download a piece image and map its dominant opaque color onto the catalog."""

from __future__ import annotations

import io
from collections.abc import Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

from PIL import Image
from modern_colorthief import get_color

from catalog import (
    OPAQUE_ALPHA_MIN,
    catalog_name_for_hex,
    nearest_catalog_hex,
)

USER_AGENT = "SkyDIIV-backstage/202610_backfill_clothing_item_colors_and_sizes"
DOWNLOAD_TIMEOUT_SECONDS = 30

FetchImageFn = Callable[[str], bytes]


class ImageColorError(Exception):
    """Raised when the image cannot be used for Color Thief (logged by the runner)."""


def fetch_image_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        return response.read()


def _opaque_crop_to_rgb(image: Image.Image) -> Image.Image | None:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    xs: list[int] = []
    ys: list[int] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] >= OPAQUE_ALPHA_MIN:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
    cropped = rgba.crop(box)
    rgb = Image.new("RGB", cropped.size, (0, 0, 0))
    rgb.paste(cropped, mask=cropped.getchannel("A"))
    return rgb


def dominant_catalog_from_image_bytes(data: bytes) -> tuple[str, str] | None:
    """Return ``(catalog_name, hex)`` or None when there are no opaque pixels."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            rgb = _opaque_crop_to_rgb(image)
    except OSError as exc:
        raise ImageColorError(f"failed to decode image: {exc}") from exc
    if rgb is None:
        return None
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG")
    try:
        dominant = get_color(buffer.getvalue(), quality=1)
    except (ValueError, TypeError) as exc:
        raise ImageColorError(f"failed to extract dominant color: {exc}") from exc
    hex_value = nearest_catalog_hex((int(dominant[0]), int(dominant[1]), int(dominant[2])))
    name = catalog_name_for_hex(hex_value)
    if name is None:
        return None
    return name, hex_value


def infer_color_from_image_url(
    image_url: str | None,
    *,
    fetch_bytes: FetchImageFn = fetch_image_bytes,
) -> tuple[str, str] | None:
    """Download and map one catalog color. Returns None on skip or failure."""
    if not image_url:
        return None
    try:
        data = fetch_bytes(image_url)
        return dominant_catalog_from_image_bytes(data)
    except (URLError, TimeoutError, OSError, ValueError, ImageColorError):
        return None
