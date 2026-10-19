## Purpose

Operator-run database backfill that fills clothing-item catalog colors and type-scoped sizes from existing tags, maps an image’s dominant opaque color onto the SkyDIIV 1.27.0 color catalog when no descriptive color tag is present, and deletes the related color and size tags after a successful write.

## ADDED Requirements

### Requirement: Dry-run writes nothing to the database

When invoked with `--dry-run`, the script MUST log the colors and size it would assign for each processed clothing item and MUST NOT insert, update, or delete any database row.

#### Scenario: Dry-run preview

- **GIVEN** a clothing item with tag `preto` and no rows in `clothing_item_colors`
- **WHEN** the operator runs the script with `--dry-run`
- **THEN** the script logs that it would attach catalog color Black
- **AND** `clothing_item_colors`, `clothing_items.id_size`, `clothing_item_tags`, and `tags` are unchanged

### Requirement: Fill only missing structured values unless forced

Without `--force`, the script MUST attach colors only when the item has no `clothing_item_colors` rows, and MUST set `id_size` only when it is NULL. With `--force`, the script MUST replace existing colors (delete then insert) and overwrite `id_size` when a size is inferred. When `--force` is set and no size can be inferred, the script MUST leave the existing `id_size` unchanged.

#### Scenario: Skip item that already has colors and size

- **GIVEN** a clothing item that already has a Black `clothing_item_colors` row and `id_size` pointing at catalog size `M`
- **AND** the item also has tags `vermelho` and `tam. g`
- **WHEN** the script runs without `--force`
- **THEN** the existing colors and size are left unchanged
- **AND** the tags are left unchanged

#### Scenario: Force replaces existing colors

- **GIVEN** a clothing item with an existing White color row and tag `preto`
- **WHEN** the script runs with `--force`
- **THEN** the White row is removed
- **AND** a Black catalog color row is inserted

### Requirement: Infer catalog colors from tags in all app locales

The script MUST treat a tag as a descriptive color tag when, after Unicode accent-folding and case-folding, it matches a catalog color name, a locale label (pt-BR, es-PE, en-US), or a documented alias. Compound tags that list several colors separated by `/` or `-` MUST contribute each distinct catalog color, up to 8. Longer phrases MUST win over shorter ones so `azul marinho` maps to Navy, not Blue. Gendered and spaced variants (`preta`, `branca`, `cinza / preto`, `cinza/preto`) MUST map to the same catalog colors. Non-color tags MUST be ignored for color inference.

#### Scenario: Single locale color tag

- **GIVEN** a clothing item with tag `vermelho escuro` and no color rows
- **WHEN** the script runs
- **THEN** it inserts one `clothing_item_colors` row for catalog Red with hex `#C0392B`

#### Scenario: Compound tag yields multiple catalog colors

- **GIVEN** a clothing item with tag `azul escuro / preto / branco` and no color rows
- **WHEN** the script runs
- **THEN** it inserts catalog colors Navy, Black, and White
- **AND** it does not insert duplicate hex values

#### Scenario: Spanish and English tags map to the same catalog

- **GIVEN** one item with tag `negro` and another with tag `black`
- **WHEN** the script runs
- **THEN** both items receive catalog color Black with hex `#1A1A1A`

#### Scenario: Phrase beats a shorter color word

- **GIVEN** a clothing item with tag `azul marinho / marrom`
- **WHEN** the script runs
- **THEN** it inserts Navy and Brown
- **AND** it does not insert generic Blue

#### Scenario: Non-color tags are ignored for color

- **GIVEN** a clothing item whose only tags are `casual` and `algodão`
- **AND** the item has a usable piece image
- **WHEN** the script runs
- **THEN** color inference does not treat those tags as catalog colors
- **AND** the script uses the image fallback instead

### Requirement: Non-descriptive color words do not count as color tags

Tags whose folded form is only a generic multi-color word (`colorido`, `colorida`, `colorful`, `multicolor`, `multicoloured`, `varios colores`) MUST NOT count as descriptive color tags. The script MUST use the image fallback for those items when an image is available.

#### Scenario: Colorido falls through to the image

- **GIVEN** a clothing item whose only color-like tag is `colorido`
- **AND** the item has a piece image whose dominant opaque color is nearest catalog Red
- **WHEN** the script runs
- **THEN** it inserts catalog Red
- **AND** it does not skip the image fallback because of the `colorido` tag

### Requirement: Image fallback maps the dominant opaque color onto the catalog

When a clothing item has no descriptive color tag, the script MUST download `clothing_items.image_url` when present, ignore near-transparent pixels, extract the dominant remaining color, and attach exactly one catalog color whose frozen hex is nearest in RGB Euclidean distance. The written row MUST include that domain’s `color_id` and catalog hex. The script MUST NOT write a custom hex (`color_id` NULL). If the image is missing, cannot be decoded, or has no opaque pixels, the script MUST leave colors empty and continue with the next item.

#### Scenario: Dominant image color becomes nearest catalog color

- **GIVEN** a clothing item with no descriptive color tag
- **AND** `image_url` points at a cutout whose dominant opaque RGB is nearest catalog Navy (`#1B2A4A`)
- **WHEN** the script runs
- **THEN** it inserts one `clothing_item_colors` row with Navy’s `color_id` and hex `#1B2A4A`

#### Scenario: Missing image leaves colors empty

- **GIVEN** a clothing item with no descriptive color tag and `image_url` NULL
- **WHEN** the script runs
- **THEN** no `clothing_item_colors` row is inserted for that item
- **AND** the script continues processing remaining items

#### Scenario: Download failure does not abort the run

- **GIVEN** a clothing item with no descriptive color tag
- **AND** downloading `image_url` fails
- **WHEN** the script processes that item
- **THEN** it logs a warning
- **AND** it does not insert colors for that item
- **AND** it continues with the next item

### Requirement: Infer at most one type-scoped size from tags

The script MUST infer size only from tags. After folding, it MUST recognise catalog size tokens (`P`, `M`, `G`, `46+`, …), prefixed forms (`tam. m`, `tam. P`, `talla 40`, `size m`), and word forms in pt-BR, es-PE, and en-US (`médio`, `medio`, `medium`). It MUST set `clothing_items.id_size` to the matching `piece_size` domain only when that size is allowed for the item’s piece-type source (`top`, `outerwear`, `dress`, `bottom`, `footwear`). Accessories and items with no piece type MUST keep `id_size` NULL. When several distinct allowed sizes appear, the script MUST log a warning and use the first match in tag order. When no allowed size is found, `id_size` MUST stay NULL.

#### Scenario: Prefixed letter size on a top

- **GIVEN** a top clothing item with tag `tam. m` and `id_size` NULL
- **WHEN** the script runs
- **THEN** it sets `id_size` to catalog size `M`

#### Scenario: Word size in Portuguese

- **GIVEN** a top clothing item with tag `médio` and `id_size` NULL
- **WHEN** the script runs
- **THEN** it sets `id_size` to catalog size `M`

#### Scenario: Size not allowed for the piece type is skipped

- **GIVEN** a footwear item with tag `tam. XPP` and `id_size` NULL
- **WHEN** the script runs
- **THEN** `id_size` stays NULL

#### Scenario: Accessory never receives a size

- **GIVEN** an accessory clothing item with tag `tam. m` and `id_size` NULL
- **WHEN** the script runs
- **THEN** `id_size` stays NULL

### Requirement: Delete related color and size tags after a successful write

After a successful color write for an item, the script MUST delete that item’s `clothing_item_tags` rows whose tags the matcher treated as color-related (catalog matches, compound color tags, and generic multi-color words such as `colorido`). After a successful size write, it MUST delete that item’s `clothing_item_tags` rows whose tags the matcher treated as size-related. If a `tags` row then has no remaining `clothing_item_tags` and no `outfit_tags`, the script MUST delete that `tags` row. Non-color/non-size tags MUST stay. Color tags MUST stay when this run does not write colors; size tags MUST stay when this run does not write a size. Dry-run MUST NOT delete tags.

#### Scenario: Color and size tags are removed after a successful backfill

- **GIVEN** a clothing item with tags `preto`, `tam. P`, and `casual`
- **WHEN** the script writes Black and size `P`
- **THEN** the `preto` and `tam. P` links on that item are deleted
- **AND** the `casual` tag remains on the item

#### Scenario: Orphaned tag row is deleted

- **GIVEN** a color tag `preto` linked only to this clothing item (no other pieces or outfits)
- **WHEN** the script writes Black for that item
- **THEN** the `tags` row named `preto` is deleted

#### Scenario: Shared tag is unlinked but not deleted

- **GIVEN** a color tag `preto` linked to two clothing items of the same user
- **WHEN** the script writes Black for only the first item
- **THEN** the first item no longer has the `preto` tag
- **AND** the `tags` row named `preto` still exists for the second item

#### Scenario: Generic colorido is removed after image fallback

- **GIVEN** a clothing item whose only color-like tag is `colorido`
- **WHEN** the script writes catalog Red from the image
- **THEN** the `colorido` link on that item is deleted

#### Scenario: Tags stay when this run does not write colors or size

- **GIVEN** a clothing item with tags `casual` and `algodão`, no descriptive color tag, and `image_url` NULL
- **WHEN** the script does not insert colors and does not set `id_size`
- **THEN** the item’s tags are left unchanged

### Requirement: Audit fields and operator logging

Every inserted `clothing_item_colors` row and every `clothing_items` size update MUST set `updated_at` to the current timestamp and `updated_by` to a stable script identifier. Color inserts MUST also set `created_by` to that identifier. The script MUST log each assignment and a final count of updated, skipped, and failed items. A fatal connection error MUST exit non-zero. Per-item mapping failures MUST not abort the run.

#### Scenario: Successful apply logs and stamps the writer

- **GIVEN** a clothing item that receives Black and size `M`
- **WHEN** the script runs without `--dry-run`
- **THEN** the color row and the clothing item have `updated_by` equal to the script identifier
- **AND** the log includes that item’s id, inferred colors, and inferred size

#### Scenario: Per-item failure continues

- **GIVEN** two clothing items, the first of which has an undecodable image and no color tags
- **WHEN** the script runs
- **THEN** the first item is logged as a warning and left without colors
- **AND** the second item is still processed
