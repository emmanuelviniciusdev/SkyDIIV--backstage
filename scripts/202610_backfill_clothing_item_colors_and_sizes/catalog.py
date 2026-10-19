"""Frozen SkyDIIV web 1.27.0 piece-color hex catalog and type-scoped sizes."""

from __future__ import annotations

PIECE_COLOR_CATALOG: dict[str, str] = {
    "Black": "#1A1A1A",
    "White": "#F5F5F5",
    "Gray": "#8A8A8A",
    "Beige": "#D8C3A5",
    "Brown": "#6B4226",
    "Cream": "#F5E6C8",
    "Navy": "#1B2A4A",
    "Blue": "#3B6FA0",
    "Light Blue": "#8BB8D8",
    "Teal": "#2A9D8F",
    "Green": "#4A7C59",
    "Olive": "#6B7C3E",
    "Yellow": "#E8C547",
    "Gold": "#D4AF37",
    "Orange": "#E07A3D",
    "Red": "#C0392B",
    "Pink": "#E8A0BF",
    "Burgundy": "#6D1A2A",
    "Purple": "#6B4C9A",
    "Khaki": "#C3B091",
    "Silver": "#C0C0C0",
}

PIECE_COLOR_NAMES: tuple[str, ...] = tuple(PIECE_COLOR_CATALOG.keys())

_TOP_SIZES: tuple[str, ...] = (
    "XPP",
    "PP",
    "P",
    "M",
    "G",
    "GG",
    "GGG",
    "XG",
    "XGG",
    "XGG+",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "12",
    "14",
    "16",
    "32",
    "34",
    "36",
    "38",
    "39",
    "40",
    "41",
    "42",
    "44",
    "46",
    "48",
    "50",
    "52",
    "54",
    "56",
    "58",
    "60",
    "62",
    "64",
    "66",
    "68",
    "68+",
)

_BOTTOM_SIZES: tuple[str, ...] = (
    "XPP",
    "PP",
    "P",
    "M",
    "G",
    "GG",
    "GGG",
    "XGG",
    "16",
    "32",
    "34",
    "36",
    "37",
    "38",
    "39",
    "40",
    "41",
    "42",
    "43",
    "44",
    "46",
    "48",
    "50",
    "52",
    "54",
    "56",
    "58",
    "60",
    "62",
    "64",
    "66",
    "68",
    "68+",
)

_FOOTWEAR_SIZES: tuple[str, ...] = (
    "P",
    "M",
    "G",
    "GG",
    "19",
    "28",
    "31",
    "33",
    "34",
    "35",
    "36",
    "37",
    "38",
    "39",
    "40",
    "41",
    "42",
    "43",
    "44",
    "45",
    "46",
    "46+",
)

PIECE_SIZE_BY_TYPE: dict[str, tuple[str, ...]] = {
    "top": _TOP_SIZES,
    "outerwear": _TOP_SIZES,
    "dress": _TOP_SIZES,
    "accessory": (),
    "bottom": _BOTTOM_SIZES,
    "footwear": _FOOTWEAR_SIZES,
}

MAX_PIECE_COLORS = 8
OPAQUE_ALPHA_MIN = 128
SCRIPT_ACTOR = "script:202610_backfill_clothing_item_colors_and_sizes"
DOMAIN_SOURCE_CLOTHING_ITEMS = "clothing_items"


def hex_to_rgb(hex_value: str) -> tuple[int, int, int]:
    value = hex_value.removeprefix("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
    )


_CATALOG_RGB: tuple[tuple[str, str, tuple[int, int, int]], ...] = tuple(
    (name, hex_value, hex_to_rgb(hex_value))
    for name, hex_value in PIECE_COLOR_CATALOG.items()
)


def nearest_catalog_hex(rgb: tuple[int, int, int]) -> str:
    """Squared Euclidean RGB distance onto the frozen 1.27.0 catalog."""
    best_hex = _CATALOG_RGB[0][1]
    best_distance = float("inf")
    for _name, hex_value, catalog_rgb in _CATALOG_RGB:
        dr = rgb[0] - catalog_rgb[0]
        dg = rgb[1] - catalog_rgb[1]
        db = rgb[2] - catalog_rgb[2]
        distance = dr * dr + dg * dg + db * db
        if distance < best_distance:
            best_distance = distance
            best_hex = hex_value
    return best_hex


def catalog_name_for_hex(hex_value: str) -> str | None:
    needle = hex_value.upper()
    for name, catalog_hex in PIECE_COLOR_CATALOG.items():
        if catalog_hex.upper() == needle:
            return name
    return None


def unique_piece_size_names() -> tuple[str, ...]:
    seen: set[str] = set()
    names: list[str] = []
    for sizes in PIECE_SIZE_BY_TYPE.values():
        for name in sizes:
            if name in seen:
                continue
            seen.add(name)
            names.append(name)
    return tuple(names)
