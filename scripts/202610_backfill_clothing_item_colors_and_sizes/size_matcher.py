"""Type-gated size tag matcher for the 1.27.0 piece_size catalog."""

from __future__ import annotations

from dataclasses import dataclass

from catalog import PIECE_SIZE_BY_TYPE, unique_piece_size_names
from color_matcher import fold_text

_SIZE_PREFIXES: tuple[str, ...] = ("tamanho", "talla", "tam.", "tam", "size")

_SIZE_TOKEN_BY_FOLDED: dict[str, str] = {
    name.lower(): name for name in unique_piece_size_names()
}

_SIZE_WORD_TO_TOKEN: dict[str, str] = {
    "pequeno": "P",
    "pequena": "P",
    "small": "P",
    "chico": "P",
    "chica": "P",
    "medio": "M",
    "media": "M",
    "medium": "M",
    "grande": "G",
    "large": "G",
    "extra pequeno": "PP",
    "extra pequena": "PP",
    "extra small": "PP",
    "extrasmall": "PP",
    "extra chico": "PP",
    "extra chica": "PP",
    "extra extra pequeno": "XPP",
    "extra extra pequena": "XPP",
    "extra extra small": "XPP",
    "extra small small": "XPP",
    "extra grande": "GG",
    "extra large": "GG",
    "extralarge": "GG",
    "extra extra grande": "GGG",
    "extra extra large": "GGG",
    "extra large large": "GGG",
}
_SIZE_WORDS_LONGEST_FIRST: tuple[str, ...] = tuple(
    sorted(_SIZE_WORD_TO_TOKEN, key=len, reverse=True)
)


def _strip_size_prefix(folded: str) -> str:
    for prefix in _SIZE_PREFIXES:
        if folded.startswith(prefix):
            rest = folded[len(prefix) :].lstrip(" .")
            if rest:
                return rest
    return folded


def match_size_token(tag: str) -> str | None:
    """Return a catalog size name when the tag is a size phrase; else None."""
    folded = fold_text(tag)
    if not folded:
        return None
    remainder = _strip_size_prefix(folded)
    token = _SIZE_TOKEN_BY_FOLDED.get(remainder)
    if token:
        return token
    word_key = " ".join(remainder.replace("-", " ").split())
    for phrase in _SIZE_WORDS_LONGEST_FIRST:
        if word_key == phrase:
            return _SIZE_WORD_TO_TOKEN[phrase]
    return None


@dataclass(frozen=True)
class SizeTagMatch:
    name: str | None
    related_indexes: tuple[int, ...]
    conflict: bool


def infer_size_from_tags(
    tags: list[str],
    piece_type_source: str | None,
) -> SizeTagMatch:
    """First allowed size in tag order; warn when several distinct allowed sizes appear."""
    allowed = PIECE_SIZE_BY_TYPE.get(piece_type_source or "", ())
    related: list[int] = []
    found: list[str] = []
    for index, tag in enumerate(tags):
        token = match_size_token(tag)
        if token is None:
            continue
        related.append(index)
        if allowed and token in allowed:
            found.append(token)

    if not found:
        return SizeTagMatch(name=None, related_indexes=tuple(related), conflict=False)

    first = found[0]
    conflict = any(name != first for name in found[1:])
    return SizeTagMatch(
        name=first,
        related_indexes=tuple(related),
        conflict=conflict,
    )
