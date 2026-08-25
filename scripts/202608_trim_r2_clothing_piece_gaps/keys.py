"""Live vs backup object-key mapping for the clothing-pieces prefix."""

from __future__ import annotations

LIVE_PREFIX = "clothing-pieces/"
BACKUP_PREFIX_ROOT = "clothing-pieces--backup--"


def is_folder_marker(key: str) -> bool:
    return not key or key.endswith("/")


def is_live_clothing_piece_key(key: str) -> bool:
    return (not is_folder_marker(key)) and key.startswith(LIVE_PREFIX)


def backup_prefix_for_date(date_str: str) -> str:
    return f"{BACKUP_PREFIX_ROOT}{date_str}/"


def backup_dest_key(source_key: str, date_str: str) -> str:
    if not is_live_clothing_piece_key(source_key):
        raise ValueError(f"not a live clothing-piece key: {source_key!r}")
    return f"{backup_prefix_for_date(date_str)}{source_key[len(LIVE_PREFIX) :]}"
