"""Key mapping and backup-prefix helpers."""

from keys import backup_dest_key, backup_prefix_for_date, is_live_clothing_piece_key


def test_backup_dest_key_replaces_only_the_live_prefix() -> None:
    assert (
        backup_dest_key("clothing-pieces/abc.png", "2026-08-25")
        == "clothing-pieces--backup--2026-08-25/abc.png"
    )
    assert (
        backup_dest_key("clothing-pieces/nested/b.webp", "2026-08-25")
        == "clothing-pieces--backup--2026-08-25/nested/b.webp"
    )


def test_live_key_predicate() -> None:
    assert is_live_clothing_piece_key("clothing-pieces/a.png")
    assert not is_live_clothing_piece_key("clothing-pieces/")
    assert not is_live_clothing_piece_key("outfits/look.png")
    assert not is_live_clothing_piece_key("clothing-pieces--backup--2026-08-25/a.png")


def test_backup_prefix_for_date() -> None:
    assert backup_prefix_for_date("2026-08-25") == "clothing-pieces--backup--2026-08-25/"
