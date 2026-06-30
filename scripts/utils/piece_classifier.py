"""
Rule-based classifier for clothing-item piece types and subtypes.

Given a clothing item's title the classifier returns ``(type_name,
subtype_name)`` where the names correspond to ``Domain.name`` values stored in
the database under types ``piece_type`` and ``piece_subtype``.

Classification strategy
-----------------------
1. Normalise the title to lowercase ASCII (accent-folded) so that pt-BR,
   es-PE and en-US item names are handled uniformly.
2. Walk a priority-ordered rule table.  Each rule matches when the normalised
   title *starts with* one of the rule's prefix keywords.
3. The first matching rule wins; unrecognised titles return ``(None, None)``.

Why title-only
--------------
Tags describe colours, fits, occasions and other attributes — they rarely
encode the garment category in a reliable way.  Using only the title avoids
false positives and keeps the logic deterministic.

Rule priority order
-------------------
1. Footwear  — checked first so footwear titles are not misclassified when a
               brand name also appears in other categories.
2. Accessory
3. Outerwear — outer-layer prefixes (e.g. ``casaco``) are checked before the
               Top section so a coat-style title is not mapped to Hoodie.
4. Bottom
5. Top       — compound prefixes (e.g. ``camisa manga longa``) before bare
               ones (``camisa``) so the longest match wins.
"""
from __future__ import annotations

import unicodedata


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """Lowercase and strip Unicode diacritics for accent-insensitive matching."""
    nfd = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def _starts(text: str, prefixes: list[str]) -> bool:
    """
    Return True if *text* begins with any of *prefixes* as a token boundary.

    A match is accepted when the title equals the prefix exactly, or when the
    character immediately after the prefix is a space or a hyphen — preventing
    partial-word matches (e.g. "polo" matching "polotop").
    """
    for prefix in prefixes:
        if text == prefix:
            return True
        if text.startswith(prefix) and len(text) > len(prefix) and text[len(prefix)] in (" ", "-"):
            return True
    return False


def _contains(text: str, keywords: list[str]) -> bool:
    return any(kw in text for kw in keywords)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_piece(title: str) -> tuple[str | None, str | None]:
    """
    Infer ``(type_name, subtype_name)`` from a clothing item's title.

    Parameters
    ----------
    title:
        The clothing item title as stored in the database.

    Returns
    -------
    tuple[str | None, str | None]
        ``(type_name, subtype_name)`` matching ``Domain.name`` values, or
        ``(None, None)`` when no rule fires.
    """
    t = _normalize(title)

    # ------------------------------------------------------------------
    # FOOTWEAR
    # ------------------------------------------------------------------
    if _starts(t, ["tenis", "sneaker", "sapatenis"]):
        return "Footwear", "Sneakers"
    if _starts(t, ["bota", "boot", "botinha", "coturno"]):
        return "Footwear", "Boots"
    if _starts(t, ["sandalia", "sandal", "rasteira"]):
        return "Footwear", "Sandals"
    if _starts(t, ["sapatilha", "flat", "bailarina"]):
        return "Footwear", "Flats"
    if _starts(t, ["salto", "scarpin", "heel", "plataforma"]):
        return "Footwear", "Heels"
    if _starts(t, ["loafer", "mocassim", "mule"]):
        return "Footwear", "Loafers"
    if _starts(t, ["crocs", "chinelo", "flip flop", "tamanco"]):
        return "Footwear", "Other"

    # ------------------------------------------------------------------
    # ACCESSORY
    # ------------------------------------------------------------------
    if _starts(t, ["pulseira", "bracelet"]):
        return "Accessory", "Bracelet"
    if _starts(t, ["colar", "necklace", "collar"]):
        return "Accessory", "Jewelry"
    if _starts(t, ["anel", "ring"]):
        return "Accessory", "Jewelry"
    if _starts(t, ["brinco", "earring"]):
        return "Accessory", "Jewelry"
    if _starts(t, ["relogio", "watch", "smartwatch"]):
        return "Accessory", "Watch"
    if _starts(t, ["bolsa", "bag", "mochila", "pochete", "carteira", "wallet"]):
        return "Accessory", "Bag"
    if _starts(t, ["cinto", "belt"]):
        return "Accessory", "Belt"
    if _starts(t, ["oculos", "sunglass", "glasses"]):
        return "Accessory", "Sunglasses"
    if _starts(t, ["cachecol", "scarf", "lenco"]):
        return "Accessory", "Scarf"
    if _starts(t, ["bone", "cap", "chapeu", "hat", "viseira", "visor"]):
        return "Accessory", "Hat"
    if _starts(t, ["gorro", "beanie", "touca"]):
        return "Accessory", "Beanie"

    # ------------------------------------------------------------------
    # OUTERWEAR
    # "casaco" must precede the Top section — a "casaco moletom" is
    # outerwear even though a bare "moletom" maps to Top > Hoodie.
    # ------------------------------------------------------------------
    if _starts(t, ["casaco", "coat", "sobretudo", "trench"]):
        return "Outerwear", "Coat"
    if _starts(t, ["jaqueta", "jacket"]):
        if _contains(t, ["corta vento", "windbreaker", "wind breaker", "capa de chuva", "raincoat"]):
            return "Outerwear", "Raincoat"
        return "Outerwear", "Jacket"
    if _starts(t, ["blazer"]):
        return "Outerwear", "Blazer"
    if _starts(t, ["colete", "vest"]):
        return "Outerwear", "Vest"
    if _starts(t, ["parka"]):
        return "Outerwear", "Jacket"
    if _starts(t, ["corta vento", "windbreaker", "capa de chuva", "impermeavel", "anorak"]):
        return "Outerwear", "Raincoat"

    # ------------------------------------------------------------------
    # BOTTOM
    # ------------------------------------------------------------------
    if _starts(t, ["calca", "pants", "trouser", "pantalon"]):
        if _contains(t, ["jeans", "denim"]):
            return "Bottom", "Jeans"
        return "Bottom", "Trousers"
    if _starts(t, ["shorts", "bermuda", "short"]):
        return "Bottom", "Shorts"
    if _starts(t, ["saia", "skirt"]):
        return "Bottom", "Skirt"
    if _starts(t, ["legging"]):
        return "Bottom", "Leggings"
    # Titles that begin with "jeans" outright (e.g. "Jeans Skinny …")
    if _starts(t, ["jeans", "denim"]):
        return "Bottom", "Jeans"

    # ------------------------------------------------------------------
    # TOP
    # Compound prefixes are checked before their bare counterparts so
    # that "camisa manga longa" does not fall into the bare "camisa" rule.
    # ------------------------------------------------------------------
    if _starts(t, ["camisa manga longa", "shirt long sleeve"]):
        return "Top", "Shirt"
    if _starts(t, ["camiseta manga longa", "long sleeve t-shirt"]):
        return "Top", "T-Shirt"
    if _starts(t, ["camiseta", "t-shirt", "tee"]):
        return "Top", "T-Shirt"
    if _starts(t, ["camisa", "shirt"]):
        return "Top", "Shirt"
    if _starts(t, ["moletom", "hoodie", "sweatshirt", "blusao"]):
        return "Top", "Hoodie"
    if _starts(t, ["blusa", "blouse"]):
        return "Top", "Blouse"
    if _starts(t, ["sueter", "sweater", "malha", "tricot"]):
        return "Top", "Sweater"
    if _starts(t, ["regata", "tank top", "alcinha"]):
        return "Top", "Tank Top"
    if _starts(t, ["polo"]):
        return "Top", "Polo"
    if _starts(t, ["cardigan"]):
        return "Top", "Cardigan"

    return None, None
