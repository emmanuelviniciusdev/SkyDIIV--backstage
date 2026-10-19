"""Type-scoped size tag matching tests."""

from __future__ import annotations

from size_matcher import infer_size_from_tags, match_size_token


def test_prefixed_letter_size_on_a_top() -> None:
    match = infer_size_from_tags(["tam. m"], "top")
    assert match.name == "M"
    assert match.related_indexes == (0,)


def test_portuguese_word_size_on_a_top() -> None:
    match = infer_size_from_tags(["médio"], "top")
    assert match.name == "M"


def test_english_medium_on_a_top() -> None:
    assert infer_size_from_tags(["medium"], "top").name == "M"
    assert infer_size_from_tags(["size m"], "top").name == "M"
    assert infer_size_from_tags(["talla 40"], "top").name == "40"


def test_tam_xpp_on_footwear_is_skipped() -> None:
    match = infer_size_from_tags(["tam. XPP"], "footwear")
    assert match.name is None
    assert match.related_indexes == (0,)


def test_accessory_never_receives_a_size() -> None:
    match = infer_size_from_tags(["tam. m"], "accessory")
    assert match.name is None


def test_missing_piece_type_never_receives_a_size() -> None:
    match = infer_size_from_tags(["tam. m"], None)
    assert match.name is None


def test_preto_is_not_a_size_token() -> None:
    assert match_size_token("preto") is None
    assert infer_size_from_tags(["preto"], "top").name is None


def test_first_allowed_size_wins_on_conflict() -> None:
    match = infer_size_from_tags(["tam. m", "42"], "top")
    assert match.name == "M"
    assert match.conflict is True
