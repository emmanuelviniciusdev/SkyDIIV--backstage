"""PNG/WebP trim round-trip tests (web ``trim-transparent-image.test.ts``)."""

from __future__ import annotations

from io import BytesIO

from PIL import Image

from trim_image import sniff_image_content_type, trim_transparent_image


def _png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _webp(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="WEBP")
    return buffer.getvalue()


def test_sniff_png_jpeg_webp() -> None:
    png = _png(Image.new("RGBA", (1, 1), (255, 0, 0, 255)))
    assert sniff_image_content_type(png) == "image/png"

    jpeg_buf = BytesIO()
    Image.new("RGB", (1, 1), (255, 0, 0)).save(jpeg_buf, format="JPEG")
    assert sniff_image_content_type(jpeg_buf.getvalue()) == "image/jpeg"

    webp = _webp(Image.new("RGBA", (1, 1), (255, 0, 0, 255)))
    assert sniff_image_content_type(webp) == "image/webp"


def test_jpeg_bytes_are_returned_unchanged() -> None:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), (255, 255, 255)).save(buffer, format="JPEG")
    original = buffer.getvalue()
    result = trim_transparent_image(original)
    assert result is original


def test_already_tight_cutout_returns_original_bytes() -> None:
    original = _png(Image.new("RGBA", (4, 4), (255, 255, 255, 255)))
    result = trim_transparent_image(original)
    assert result is original


def test_fully_transparent_png_returns_original_bytes() -> None:
    original = _png(Image.new("RGBA", (4, 4), (0, 0, 0, 0)))
    result = trim_transparent_image(original)
    assert result is original


def test_padded_png_crops_to_5x5() -> None:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    image.putpixel((3, 3), (10, 20, 30, 255))
    original = _png(image)

    result = trim_transparent_image(original)
    assert result is not original
    assert sniff_image_content_type(result) == "image/png"

    cropped = Image.open(BytesIO(result)).convert("RGBA")
    assert cropped.size == (5, 5)
    assert cropped.getpixel((2, 2)) == (10, 20, 30, 255)


def test_webp_with_padding_encodes_png() -> None:
    image = Image.new("RGBA", (8, 8), (0, 0, 0, 0))
    image.putpixel((3, 3), (10, 20, 30, 255))
    original = _webp(image)

    result = trim_transparent_image(original)
    assert sniff_image_content_type(result) == "image/png"
    cropped = Image.open(BytesIO(result)).convert("RGBA")
    assert cropped.size == (5, 5)
