"""Tests for the 1.17.11 opaque-bounds port."""

from __future__ import annotations

import numpy as np

from opaque_bounds import (
    OpaqueBounds,
    find_opaque_bounds,
    is_full_image_bounds,
    pad_opaque_bounds,
)


def _rgba_buffer(
    width: int,
    height: int,
    opaque: list[tuple[int, int]],
) -> np.ndarray:
    data = np.zeros(width * height * 4, dtype=np.uint8)
    for x, y in opaque:
        i = (y * width + x) * 4
        data[i] = 255
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = 255
    return data


def test_fully_transparent_buffer_returns_none() -> None:
    assert find_opaque_bounds(np.zeros(4 * 4 * 4, dtype=np.uint8), 4, 4) is None


def test_tight_box_of_opaque_pixels() -> None:
    data = _rgba_buffer(6, 5, [(2, 1), (3, 1), (2, 3)])
    assert find_opaque_bounds(data, 6, 5) == OpaqueBounds(
        min_x=2,
        min_y=1,
        max_x=3,
        max_y=3,
        width=2,
        height=3,
    )


def test_ignores_pixels_at_or_below_alpha_threshold() -> None:
    data = np.zeros(2 * 2 * 4, dtype=np.uint8)
    data[3] = 16
    data[7] = 17
    assert find_opaque_bounds(data, 2, 2, 16) == OpaqueBounds(
        min_x=1,
        min_y=0,
        max_x=1,
        max_y=0,
        width=1,
        height=1,
    )


def test_pad_expands_inward_from_edges() -> None:
    padded = pad_opaque_bounds(
        OpaqueBounds(min_x=2, min_y=2, max_x=3, max_y=3, width=2, height=2),
        8,
        8,
        2,
    )
    assert padded == OpaqueBounds(
        min_x=0,
        min_y=0,
        max_x=5,
        max_y=5,
        width=6,
        height=6,
    )


def test_pad_does_not_expand_past_the_image() -> None:
    padded = pad_opaque_bounds(
        OpaqueBounds(min_x=0, min_y=0, max_x=1, max_y=1, width=2, height=2),
        4,
        4,
        8,
    )
    assert padded == OpaqueBounds(
        min_x=0,
        min_y=0,
        max_x=3,
        max_y=3,
        width=4,
        height=4,
    )


def test_is_full_image_bounds() -> None:
    assert is_full_image_bounds(
        OpaqueBounds(min_x=0, min_y=0, max_x=3, max_y=3, width=4, height=4),
        4,
        4,
    )
    assert not is_full_image_bounds(
        OpaqueBounds(min_x=1, min_y=0, max_x=3, max_y=3, width=3, height=4),
        4,
        4,
    )
