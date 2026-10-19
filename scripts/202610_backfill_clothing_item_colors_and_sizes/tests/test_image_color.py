"""Image fallback tests with a mocked HTTP fetch."""

from __future__ import annotations

from io import BytesIO
from urllib.error import URLError

from PIL import Image

from image_color import infer_color_from_image_url


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _red_opaque_cutout() -> bytes:
    image = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    for x in range(4, 12):
        for y in range(4, 12):
            image.putpixel((x, y), (255, 0, 0, 255))
    return _png_bytes(image)


def test_red_opaque_cutout_maps_to_catalog_red() -> None:
    result = infer_color_from_image_url(
        "https://assets.example/red.png",
        fetch_bytes=lambda _url: _red_opaque_cutout(),
    )
    assert result == ("Red", "#C0392B")


def test_missing_url_returns_no_colors() -> None:
    assert infer_color_from_image_url(None, fetch_bytes=lambda _url: b"") is None
    assert infer_color_from_image_url("", fetch_bytes=lambda _url: b"") is None


def test_failed_download_returns_no_colors() -> None:
    def fail(_url: str) -> bytes:
        raise URLError("timed out")

    assert (
        infer_color_from_image_url("https://assets.example/missing.png", fetch_bytes=fail)
        is None
    )


def test_no_opaque_pixels_returns_no_colors() -> None:
    transparent = _png_bytes(Image.new("RGBA", (8, 8), (255, 0, 0, 0)))
    result = infer_color_from_image_url(
        "https://assets.example/clear.png",
        fetch_bytes=lambda _url: transparent,
    )
    assert result is None
