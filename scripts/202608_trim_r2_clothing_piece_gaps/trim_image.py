"""Crop transparent PNG/WebP padding (SkyDIIV web 1.17.11 ``trimTransparentImage``)."""

from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image

from opaque_bounds import (
    OPAQUE_ALPHA_THRESHOLD,
    OPAQUE_BOUNDS_PADDING_PX,
    find_opaque_bounds,
    is_full_image_bounds,
    pad_opaque_bounds,
)

PNG_MAGIC = bytes([0x89, 0x50, 0x4E, 0x47])
JPEG_MAGIC = bytes([0xFF, 0xD8, 0xFF])
GIF_MAGIC = b"GIF"


def sniff_image_content_type(blob: bytes) -> str | None:
    """Detect MIME type from magic bytes (web ``sniffImageContentType``)."""
    if len(blob) < 4:
        return None
    if blob.startswith(JPEG_MAGIC):
        return "image/jpeg"
    if blob.startswith(PNG_MAGIC):
        return "image/png"
    if blob.startswith(GIF_MAGIC):
        return "image/gif"
    if len(blob) >= 12 and blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    if _looks_like_avif(blob):
        return "image/avif"
    return None


def _looks_like_avif(blob: bytes) -> bool:
    if len(blob) < 12 or blob[4:8] != b"ftyp":
        return False
    brand = blob[8:12]
    return brand in (b"avif", b"avis", b"avio")


class TrimDecodeError(Exception):
    """PNG/WebP magic matched but the payload could not be decoded."""


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def try_trim_piece(blob: bytes) -> bytes | None:
    """
    Crop transparent padding from a PNG/WebP piece.

    Returns cropped PNG bytes, or None when the object should be left unchanged
    (ineligible format, empty canvas, fully transparent, or already tight).
    Raises TrimDecodeError when PNG/WebP bytes cannot be decoded.
    """
    kind = sniff_image_content_type(blob)
    if kind not in ("image/png", "image/webp"):
        return None

    try:
        with Image.open(BytesIO(blob)) as source:
            rgba = source.convert("RGBA")
    except Exception as exc:
        raise TrimDecodeError("failed to decode PNG/WebP") from exc

    width, height = rgba.size
    if width < 1 or height < 1:
        return None

    arr = np.asarray(rgba)
    bounds = find_opaque_bounds(arr, width, height, OPAQUE_ALPHA_THRESHOLD)
    if bounds is None:
        return None

    padded = pad_opaque_bounds(bounds, width, height, OPAQUE_BOUNDS_PADDING_PX)
    if is_full_image_bounds(padded, width, height):
        return None

    cropped = rgba.crop(
        (padded.min_x, padded.min_y, padded.max_x + 1, padded.max_y + 1)
    )
    return _png_bytes(cropped)


def trim_transparent_image(blob: bytes) -> bytes:
    """
    Crop fully-transparent (and near-transparent) padding from a cutout.

    Returns the original bytes when the type has no alpha to crop, there is
    nothing to crop, decoding fails, or the padded box already fills the canvas.
    """
    try:
        cropped = try_trim_piece(blob)
    except TrimDecodeError:
        return blob
    return blob if cropped is None else cropped
