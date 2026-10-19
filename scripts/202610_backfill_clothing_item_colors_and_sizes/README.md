# 202610 — Backfill clothing-item colors and sizes

Fills `clothing_item_colors` and `clothing_items.id_size` for pieces that still
keep those attributes only as free-text tags (or not at all) after SkyDIIV web
**1.27.0**.

The script infers **catalog-only** colors from  
tags in pt-BR, es-PE, and en-US. When no descriptive color tag exists, it  
downloads `image_url` and maps the dominant opaque pixel onto the nearest
1.27.0 catalog color with Color Thief (`modern_colorthief`). Size comes from
tags only, and only when that size is allowed for the piece-type source
(`top` / `outerwear` / `dress` / `bottom` / `footwear`). Accessories are never
sized.

After a **successful** color write, related color tags (including generic
`colorido`) are unlinked; after a **successful** size write, related size tags
are unlinked. Orphaned `tags` rows with no remaining clothing-item or outfit
links are deleted. Non-color / non-size tags (`casual`, `algodão`, …) stay.

No worker, QStash, outbox, Prisma migration, or Redis invalidation.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |
| PostgreSQL | accessible via connection string |

---

## Setup

```bash
cd scripts/202610_backfill_clothing_item_colors_and_sizes
uv sync
cp .env.example .env
# fill DATABASE_URL_UNPOOLED (or DATABASE_URL)
```

---

## Configuration

The script reads the database connection string from the environment (same
resolution as `scripts/utils/db.py`): `DATABASE_URL_UNPOOLED`, then
`DATABASE_URL`.

```dotenv
DATABASE_URL_UNPOOLED="postgresql://user:pass@host:5432/dbname"
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

Place `.env` in this folder, in the current working directory, or pass it with
`--env`.

---

## Usage

```bash
cd scripts/202610_backfill_clothing_item_colors_and_sizes

# preview mappings and intended tag deletions without writing
uv run python __main__.py --dry-run

# apply: fill missing colors and/or size only
uv run python __main__.py

# overwrite existing structured colors (delete then insert) and size when inferred
uv run python __main__.py --force

# cap Color Thief image downloads after tag matching (tag-only items still run)
uv run python __main__.py --limit 20

# point at a specific .env
uv run python __main__.py --env /path/to/.env
```

`--dry-run` can be combined with `--force`, `--limit`, and `--env`. Output is
written to stdout and `output.txt` (gitignored).

Default selection: items **missing colors** and/or **missing size**. `--force`
loads every item. When `--force` is set and no size can be inferred, the
existing `id_size` is left unchanged.

`created_by` / `updated_by` on written rows is
`script:202610_backfill_clothing_item_colors_and_sizes`.

---

## Color catalog (SkyDIIV web 1.27.0)

Every written color is a `piece_color` domain plus its **frozen catalog hex**.
The script never inserts a custom hex (`color_id` NULL). Startup aborts if a
catalog name is missing from `domains`.

| Name | Hex |
|------|-----|
| Black | `#1A1A1A` |
| White | `#F5F5F5` |
| Gray | `#8A8A8A` |
| Beige | `#D8C3A5` |
| Brown | `#6B4226` |
| Cream | `#F5E6C8` |
| Navy | `#1B2A4A` |
| Blue | `#3B6FA0` |
| Light Blue | `#8BB8D8` |
| Teal | `#2A9D8F` |
| Green | `#4A7C59` |
| Olive | `#6B7C3E` |
| Yellow | `#E8C547` |
| Gold | `#D4AF37` |
| Orange | `#E07A3D` |
| Red | `#C0392B` |
| Pink | `#E8A0BF` |
| Burgundy | `#6D1A2A` |
| Purple | `#6B4C9A` |
| Khaki | `#C3B091` |
| Silver | `#C0C0C0` |

---

## Rollback

SQL undo can delete `clothing_item_colors` rows with
`created_by = 'script:202610_backfill_clothing_item_colors_and_sizes'` and set
`id_size = NULL` where `updated_by` is that identifier **and** the previous
size is unknown. Deleted color/size tags cannot be reconstructed from SQL
alone.

Prefer restoring a **database snapshot** (the scheduler already takes them)
if you need to roll the run back.

---

## Database tables affected

| Table | Change |
|-------|--------|
| `clothing_item_colors` | insert catalog rows; `--force` deletes existing rows for the item first |
| `clothing_items` | `id_size`, `updated_at`, `updated_by` when a size is inferred |
| `clothing_item_tags` | delete links for color-related tags after a color write; size-related tags after a size write |
| `tags` | delete rows that have no remaining clothing-item or outfit links |

---

## Shared utilities

| Module | Purpose |
|--------|---------|
| `scripts/utils/db.py` | Database connection via `psycopg` (no ORM) |
| `scripts/utils/logger.py` | Structured stdout / file logging |
