## Why

SkyDIIV web 1.27.0 stores clothing-piece colors from a fixed catalog and a type-scoped size. Existing pieces still keep those attributes only as free-text tags (or not at all), so wardrobe filters, classify defaults, and board labels stay empty until someone re-edits each item. A one-off backstage script must backfill `clothing_item_colors` and `clothing_items.id_size` from tags, falling back to image palette extraction when no descriptive color tag exists.

## What Changes

- Add a one-off Python script under `scripts/202610_backfill_clothing_item_colors_and_sizes/` that:
  - Reads each clothing item with its tags, piece type, image URL, existing colors, and size.
  - Infers catalog colors from tags in pt-BR, es-PE, and en-US (including compound tags such as `azul claro / branco`).
  - When no descriptive color tag is present, downloads the piece image and uses `modern_colorthief` to map the dominant opaque color to the nearest 1.27.0 catalog color.
  - Infers at most one catalog size from tags, only when that size is allowed for the item’s piece type.
  - Writes `clothing_item_colors` (`color_id` + frozen catalog hex) and `clothing_items.id_size`.
  - After a successful color write, deletes that item’s related color tags; after a successful size write, deletes that item’s related size tags. Orphaned `tags` rows (no remaining clothing-item or outfit links) are deleted.
- Support `--dry-run` so operators can preview mappings without writing to the database.
- Default to filling only missing colors and/or size; `--force` overwrites existing structured values.
- No worker, QStash, outbox, schedule, Prisma, or Redis changes. `skydiiv/web` does not need a follow-up: the catalogs and tables already exist as of 1.27.0.

## Non-goals

- Do not rename tags. Do not delete tags that are not color or size tags (`casual`, `algodão`, and other non-matching tags stay).
- Do not insert custom hex colors (`color_id` NULL). 1.27.0 is catalog-only; every written color MUST be a `piece_color` domain with its frozen catalog hex.
- Do not guess size from the image, title, or shopping preferences. Size comes from tags only.
- Do not assign a size to accessories (or any piece type whose catalog has no sizes).
- Do not run as a Worker, CRON, or QStash job. This is a manually run script.
- Do not migrate Prisma schema or seed domains; the 1.27.0 catalogs and tables already exist in `skydiiv/web`.
- Do not invalidate Redis (`has-pieces`, panorama, or domain catalogs). Piece list APIs read colors/sizes from the database; domain catalogs are unchanged.

## Capabilities

### New Capabilities

- `scripts/backfill-clothing-item-colors-and-sizes`: Operator-run database backfill that populates clothing-item catalog colors and type-scoped sizes from existing tags, with `modern_colorthief` nearest-catalog fallback when a piece has no descriptive color tag, then deletes the related color and size tags after a successful write.

### Modified Capabilities

- (none)

## Impact

- **Affected area:** one-off script under `scripts/` (Python ≥ 3.12 via uv). No app under `apps/`.
- **skydiiv/web follow-up:** none (Prisma tables `clothing_item_colors` and `clothing_items.id_size`, plus `piece_color` / `piece_size` domains, already exist).
- **Database:** insert into `clothing_item_colors`; update `clothing_items.id_size`, `updated_at`, `updated_by`; delete related `clothing_item_tags` (and unused `tags` rows). No schema migrations from this repo.
- **R2 / HTTP:** read piece images from existing `clothing_items.image_url` (public CDN). No object writes.
- **Schedule / QStash / outbox:** none.
- **Redis:** none.
