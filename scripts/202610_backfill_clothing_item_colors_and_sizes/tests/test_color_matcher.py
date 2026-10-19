"""Color tag folding, aliases, and compound-split tests."""

from __future__ import annotations

from color_matcher import infer_colors_from_tags, match_color_tag


def test_vermelho_escuro_maps_to_red() -> None:
    assert match_color_tag("vermelho escuro").names == ("Red",)


def test_compound_slash_tag_yields_navy_black_white() -> None:
    names, related = infer_colors_from_tags(["azul escuro / preto / branco"])
    assert names == ("Navy", "Black", "White")
    assert related == (0,)


def test_cinza_slash_preto_with_and_without_spaces() -> None:
    spaced, _ = infer_colors_from_tags(["cinza / preto"])
    compact, _ = infer_colors_from_tags(["cinza/preto"])
    assert spaced == ("Gray", "Black")
    assert compact == ("Gray", "Black")


def test_negro_and_black_map_to_black() -> None:
    assert match_color_tag("negro").names == ("Black",)
    assert match_color_tag("black").names == ("Black",)
    assert match_color_tag("preta").names == ("Black",)


def test_azul_marinho_beats_generic_blue() -> None:
    names, _ = infer_colors_from_tags(["azul marinho / marrom"])
    assert names == ("Navy", "Brown")
    assert "Blue" not in names


def test_documented_aliases() -> None:
    assert match_color_tag("azul marinho").names == ("Navy",)
    assert match_color_tag("vinho").names == ("Burgundy",)
    assert match_color_tag("off-white").names == ("Cream",)
    assert match_color_tag("chumbo").names == ("Gray",)
    assert match_color_tag("jeans claro").names == ("Light Blue",)
    assert match_color_tag("verde terroso").names == ("Olive",)
    assert match_color_tag("dourado escuro").names == ("Gold",)
    assert match_color_tag("ocre").names == ("Khaki",)
    assert match_color_tag("rosa claro").names == ("Pink",)
    assert match_color_tag("marrom escuro").names == ("Brown",)
    assert match_color_tag("marrom claro").names == ("Brown",)


def test_locale_labels_teal_burgundy_silver() -> None:
    assert match_color_tag("verde-água").names == ("Teal",)
    assert match_color_tag("verde azulado").names == ("Teal",)
    assert match_color_tag("bordô").names == ("Burgundy",)
    assert match_color_tag("burdeos").names == ("Burgundy",)
    assert match_color_tag("prata").names == ("Silver",)
    assert match_color_tag("plata").names == ("Silver",)
    assert match_color_tag("grey").names == ("Gray",)
    assert match_color_tag("gris").names == ("Gray",)


def test_colorido_is_related_but_not_descriptive() -> None:
    match = match_color_tag("colorido")
    assert match.names == ()
    assert match.related is True
    names, related = infer_colors_from_tags(["colorido"])
    assert names == ()
    assert related == (0,)


def test_non_color_tags_are_ignored() -> None:
    names, related = infer_colors_from_tags(["casual", "algodão"])
    assert names == ()
    assert related == ()


def test_gendered_white_and_compound_dedupes() -> None:
    names, _ = infer_colors_from_tags(["branca", "branco", "white"])
    assert names == ("White",)
