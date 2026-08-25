"""Purge prefix helper tests."""

from purge import purge_body, purge_prefix_from_public_url


def test_purge_prefix_from_default_public_url() -> None:
    assert (
        purge_prefix_from_public_url("https://assets.skydiiv.space")
        == "assets.skydiiv.space/clothing-pieces"
    )


def test_purge_body_shape() -> None:
    assert purge_body("assets.skydiiv.space/clothing-pieces") == {
        "prefixes": ["assets.skydiiv.space/clothing-pieces"]
    }
