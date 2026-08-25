"""Opaque-bounds crop constants and helpers (SkyDIIV web 1.17.11 port)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

OPAQUE_ALPHA_THRESHOLD = 16
OPAQUE_BOUNDS_PADDING_PX = 2


@dataclass(frozen=True)
class OpaqueBounds:
    min_x: int
    min_y: int
    max_x: int
    max_y: int
    width: int
    height: int


def find_opaque_bounds(
    data: np.ndarray | bytes | bytearray,
    width: int,
    height: int,
    alpha_threshold: int = OPAQUE_ALPHA_THRESHOLD,
) -> OpaqueBounds | None:
    """
    Tight axis-aligned box of pixels whose alpha is strictly greater than
    ``alpha_threshold``. Returns None when the buffer is fully transparent.
    """
    arr = np.asarray(data, dtype=np.uint8)
    if arr.ndim == 1:
        arr = arr.reshape((height, width, 4))
    elif arr.ndim == 3 and arr.shape[2] == 4:
        if arr.shape[0] != height or arr.shape[1] != width:
            raise ValueError("RGBA array shape does not match width/height")
    else:
        raise ValueError("Expected a flat RGBA buffer or an (H, W, 4) array")

    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > alpha_threshold)
    if xs.size == 0:
        return None

    min_x = int(xs.min())
    max_x = int(xs.max())
    min_y = int(ys.min())
    max_y = int(ys.max())
    return OpaqueBounds(
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
        width=max_x - min_x + 1,
        height=max_y - min_y + 1,
    )


def pad_opaque_bounds(
    bounds: OpaqueBounds,
    image_width: int,
    image_height: int,
    padding: int = OPAQUE_BOUNDS_PADDING_PX,
) -> OpaqueBounds:
    """Expands bounds by ``padding`` pixels, clamped to the image."""
    min_x = max(0, bounds.min_x - padding)
    min_y = max(0, bounds.min_y - padding)
    max_x = min(image_width - 1, bounds.max_x + padding)
    max_y = min(image_height - 1, bounds.max_y + padding)
    return OpaqueBounds(
        min_x=min_x,
        min_y=min_y,
        max_x=max_x,
        max_y=max_y,
        width=max_x - min_x + 1,
        height=max_y - min_y + 1,
    )


def is_full_image_bounds(
    bounds: OpaqueBounds,
    image_width: int,
    image_height: int,
) -> bool:
    return (
        bounds.min_x == 0
        and bounds.min_y == 0
        and bounds.width == image_width
        and bounds.height == image_height
    )
