"""Frozen 1.27.0 catalog and nearest-hex tests."""

from __future__ import annotations

from catalog import (
    PIECE_COLOR_CATALOG,
    PIECE_COLOR_NAMES,
    nearest_catalog_hex,
)


def test_catalog_lists_all_21_names_including_gold() -> None:
    assert len(PIECE_COLOR_NAMES) == 21
    assert PIECE_COLOR_NAMES == tuple(PIECE_COLOR_CATALOG.keys())
    assert "Gold" in PIECE_COLOR_NAMES
    assert PIECE_COLOR_CATALOG["Gold"] == "#D4AF37"
    assert PIECE_COLOR_CATALOG["Red"] == "#C0392B"


def test_nearest_catalog_hex_maps_pure_red_to_catalog_red() -> None:
    assert nearest_catalog_hex((255, 0, 0)) == "#C0392B"
