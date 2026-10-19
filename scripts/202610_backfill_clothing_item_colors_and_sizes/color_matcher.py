"""Accent-folding color tag matcher for the 1.27.0 piece_color catalog."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from catalog import MAX_PIECE_COLORS, PIECE_COLOR_CATALOG

GENERIC_MULTI_COLOR: frozenset[str] = frozenset(
    {
        "colorido",
        "colorida",
        "colorful",
        "multicolor",
        "multicoloured",
        "varios colores",
    }
)


def fold_text(text: str) -> str:
    """Lowercase, strip combining marks, treat `_` as space, collapse whitespace."""
    lowered = text.lower().replace("_", " ")
    nfd = unicodedata.normalize("NFD", lowered)
    stripped = "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")
    return " ".join(stripped.split())


def _alias_key(text: str) -> str:
    return " ".join(fold_text(text).replace("-", " ").split())


def _build_aliases() -> dict[str, str]:
    mapping: dict[str, str] = {}

    def add(phrase: str, catalog_name: str) -> None:
        key = _alias_key(phrase)
        if not key:
            return
        mapping[key] = catalog_name

    for name in PIECE_COLOR_CATALOG:
        add(name, name)

    labels_and_aliases: tuple[tuple[str, str], ...] = (
        # en-US labels + spelling variants
        ("black", "Black"),
        ("white", "White"),
        ("gray", "Gray"),
        ("grey", "Gray"),
        ("beige", "Beige"),
        ("brown", "Brown"),
        ("cream", "Cream"),
        ("navy", "Navy"),
        ("navy blue", "Navy"),
        ("blue", "Blue"),
        ("light blue", "Light Blue"),
        ("light-blue", "Light Blue"),
        ("teal", "Teal"),
        ("green", "Green"),
        ("olive", "Olive"),
        ("yellow", "Yellow"),
        ("gold", "Gold"),
        ("orange", "Orange"),
        ("red", "Red"),
        ("pink", "Pink"),
        ("burgundy", "Burgundy"),
        ("purple", "Purple"),
        ("khaki", "Khaki"),
        ("silver", "Silver"),
        # pt-BR pieceColors.* + gendered forms
        ("preto", "Black"),
        ("preta", "Black"),
        ("branco", "White"),
        ("branca", "White"),
        ("cinza", "Gray"),
        ("bege", "Beige"),
        ("marrom", "Brown"),
        ("creme", "Cream"),
        ("marinho", "Navy"),
        ("marinha", "Navy"),
        ("azul", "Blue"),
        ("azul claro", "Light Blue"),
        ("verde-agua", "Teal"),
        ("verde agua", "Teal"),
        ("verde", "Green"),
        ("oliva", "Olive"),
        ("amarelo", "Yellow"),
        ("amarela", "Yellow"),
        ("dourado", "Gold"),
        ("dourada", "Gold"),
        ("laranja", "Orange"),
        ("vermelho", "Red"),
        ("vermelha", "Red"),
        ("rosa", "Pink"),
        ("bordo", "Burgundy"),
        ("roxo", "Purple"),
        ("roxa", "Purple"),
        ("caqui", "Khaki"),
        ("prata", "Silver"),
        # es-PE pieceColors.* + gendered forms
        ("negro", "Black"),
        ("negra", "Black"),
        ("blanco", "White"),
        ("blanca", "White"),
        ("gris", "Gray"),
        ("marron", "Brown"),
        ("crema", "Cream"),
        ("marino", "Navy"),
        ("marina", "Navy"),
        ("verde azulado", "Teal"),
        ("amarillo", "Yellow"),
        ("amarilla", "Yellow"),
        ("dorado", "Gold"),
        ("dorada", "Gold"),
        ("naranja", "Orange"),
        ("rojo", "Red"),
        ("roja", "Red"),
        ("rosado", "Pink"),
        ("rosada", "Pink"),
        ("burdeos", "Burgundy"),
        ("morado", "Purple"),
        ("morada", "Purple"),
        ("plata", "Silver"),
        # documented production tags
        ("azul marinho", "Navy"),
        ("azul escuro", "Navy"),
        ("vermelho escuro", "Red"),
        ("vinho", "Burgundy"),
        ("chumbo", "Gray"),
        ("off-white", "Cream"),
        ("off white", "Cream"),
        ("jeans claro", "Light Blue"),
        ("verde terroso", "Olive"),
        ("dourado escuro", "Gold"),
        ("cinza desbotado", "Gray"),
        ("ocre", "Khaki"),
        ("rosa claro", "Pink"),
        ("marrom escuro", "Brown"),
        ("marrom claro", "Brown"),
    )
    for phrase, catalog_name in labels_and_aliases:
        add(phrase, catalog_name)
    return mapping


COLOR_ALIASES: dict[str, str] = _build_aliases()
_ALIAS_KEYS_LONGEST_FIRST: tuple[str, ...] = tuple(
    sorted(COLOR_ALIASES, key=len, reverse=True)
)


@dataclass(frozen=True)
class ColorTagMatch:
    names: tuple[str, ...]
    related: bool


def _lookup_phrase(folded: str) -> str | None:
    key = _alias_key(folded)
    if not key:
        return None
    direct = COLOR_ALIASES.get(key)
    if direct:
        return direct
    for alias_key in _ALIAS_KEYS_LONGEST_FIRST:
        if key == alias_key:
            return COLOR_ALIASES[alias_key]
    return None


def _looks_like_color_phrase(folded: str) -> bool:
    if _alias_key(folded) in GENERIC_MULTI_COLOR:
        return False
    return _lookup_phrase(folded) is not None


def _split_and_map(folded: str, separators: tuple[str, ...]) -> tuple[str, ...]:
    parts: list[str] = [folded]
    for sep in separators:
        next_parts: list[str] = []
        for part in parts:
            next_parts.extend(p.strip() for p in part.split(sep) if p.strip())
        parts = next_parts
    if len(parts) < 2:
        return ()
    if not all(_looks_like_color_phrase(part) for part in parts):
        return ()
    names: list[str] = []
    for part in parts:
        found = _lookup_phrase(part)
        if found:
            names.append(found)
    return tuple(names)


def match_color_tag(tag: str) -> ColorTagMatch:
    """Map one tag onto catalog color names.

    Generic multi-color words are related but not descriptive. Unmatched
    fragments are ignored.
    """
    folded = fold_text(tag)
    if not folded:
        return ColorTagMatch(names=(), related=False)
    if _alias_key(folded) in GENERIC_MULTI_COLOR:
        return ColorTagMatch(names=(), related=True)

    whole = _lookup_phrase(folded)
    if whole:
        return ColorTagMatch(names=(whole,), related=True)

    slash_names = _split_and_map(folded, ("/",))
    if slash_names:
        return ColorTagMatch(names=slash_names, related=True)

    hyphen_names = _split_and_map(folded, ("-", ","))
    if hyphen_names:
        return ColorTagMatch(names=hyphen_names, related=True)

    return ColorTagMatch(names=(), related=False)


def infer_colors_from_tags(tags: list[str]) -> tuple[tuple[str, ...], tuple[int, ...]]:
    """Return distinct catalog names (cap 8) and indexes of color-related tags."""
    names: list[str] = []
    seen: set[str] = set()
    related: list[int] = []
    for index, tag in enumerate(tags):
        match = match_color_tag(tag)
        if match.related:
            related.append(index)
        for name in match.names:
            if name in seen:
                continue
            seen.add(name)
            names.append(name)
            if len(names) >= MAX_PIECE_COLORS:
                return tuple(names), tuple(related)
    return tuple(names), tuple(related)
