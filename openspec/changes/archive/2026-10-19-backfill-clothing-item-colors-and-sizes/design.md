## Context

See proposal.md for why existing pieces still lack structured colors and sizes after SkyDIIV web 1.27.0. Specs live in `specs/scripts/backfill-clothing-item-colors-and-sizes/spec.md`.

Prisma ownership stays in `skydiiv/web`. This repo already talks to the same database from one-off Python scripts (`scripts/202606_backfill_piece_types/`, `scripts/utils/db.py`). Clothing items store free-text tags via `clothing_item_tags` → `tags.name` in the user’s locale. Structured color is `clothing_item_colors` (`color_id` → `domains` type `piece_color`, plus frozen hex). Structured size is `clothing_items.id_size` → `domains` type `piece_size`. Piece-type eligibility uses `domains.source` (`top`, `outerwear`, `dress`, `bottom`, `footwear`, `accessory`), not the English `name`.

Web 1.27.0 catalog (copy into the script; do not import the Next.js repo):

| Domain name | Hex | Order |
|-------------|-----|-------|
| Black | `#1A1A1A` | 1 |
| White | `#F5F5F5` | 2 |
| Gray | `#8A8A8A` | 3 |
| Beige | `#D8C3A5` | 4 |
| Brown | `#6B4226` | 5 |
| Cream | `#F5E6C8` | 6 |
| Navy | `#1B2A4A` | 7 |
| Blue | `#3B6FA0` | 8 |
| Light Blue | `#8BB8D8` | 9 |
| Teal | `#2A9D8F` | 10 |
| Green | `#4A7C59` | 11 |
| Olive | `#6B7C3E` | 12 |
| Yellow | `#E8C547` | 13 |
| Gold | `#D4AF37` | 14 |
| Orange | `#E07A3D` | 15 |
| Red | `#C0392B` | 16 |
| Pink | `#E8A0BF` | 17 |
| Burgundy | `#6D1A2A` | 18 |
| Purple | `#6B4C9A` | 19 |
| Khaki | `#C3B091` | 20 |
| Silver | `#C0C0C0` | 21 |

Size tokens and per-type allow-lists MUST match web `PIECE_SIZE_BY_TYPE` (top/outerwear/dress share the top list; bottom and footwear have their own; accessory is empty).

There is no worker URL, wrangler `[vars]`, or GitHub Environment secret for this change. Env lives in the script `.env` (not `.dev.vars`).

## Goals / Non-Goals

**Goals:**

- Port the 1.27.0 catalog and type-scoped size allow-lists into a deterministic Python matcher plus an image fallback.
- Reuse `scripts/utils/db.py` and `scripts/utils/logger.py`.
- Give operators `--dry-run`, `--force`, `--limit`, and `--env`.
- Unit-test tag folding, alias mapping, size allow-lists, and nearest-catalog hex without a live database.

**Non-Goals:**

- Do not restate proposal non-goals (no custom hex, no Redis, no Prisma migration). Non-color/non-size tags are left unchanged.
- Do not add pytest to older scripts.
- Do not call web HTTP APIs or Clerk. The script talks to the database and public `image_url`s only.

## Decisions

### 1. One-off dated script, not a worker

Copy `scripts/202606_backfill_piece_types/` layout: `scripts/202610_backfill_clothing_item_colors_and_sizes/` with `pyproject.toml` (Python ≥ 3.12, `psycopg[binary]`, `python-dotenv`, `pillow`, `modern-colorthief`, `pytest`), `__main__.py`, `.env.example`, `README.md`, gitignored `output.txt` / `.venv`.

- Alternative considered: Cloudflare Worker or QStash CRON. Rejected — one-shot database backfill, no HTTP contract, no schedule.

`updated_by` / `created_by`: `script:202610_backfill_clothing_item_colors_and_sizes`. Connection string: `DATABASE_URL_UNPOOLED` then `DATABASE_URL`, same as `scripts/utils/db.py`.

### 2. Pure-Python catalogs, resolved against live `domains` ids

Hard-code catalog **names** and **hex** (and size allow-lists) in the script. At runtime, load `domains` where `type IN ('piece_color', 'piece_size', 'piece_type')` and `source` is `clothing_items` for color/size rows. Map inferred names → ids. Abort at startup if a required catalog name is missing (for example Gold not seeded).

- Alternative considered: call `GET /api/piece-colors`. Rejected — workers/scripts must not depend on the web origin; ids are environment-specific UUIDs anyway.
- Alternative considered: write custom hex when nearest distance is large. Rejected — 1.27.0 is catalog-only (`color_id` required).

### 3. Longest-phrase tag matcher for colors

Normalize each tag: lowercase, Unicode NFD + strip combining marks, collapse whitespace, treat `_` as space.

Matching order per tag:

1. If the whole folded tag is a generic multi-color word (`colorido`, `colorida`, `colorful`, `multicolor`, `multicoloured`, `varios colores`), treat as **not descriptive**.
2. Else try the whole tag against the alias table (longest keys first).
3. Else split on `/` and, if still unmatched, on `-` / `,` when both sides look like color phrases. Map each part independently. Deduplicate by catalog name. Cap at 8.

The alias table MUST include:

- Domain names (`black`, `navy`, `light blue`).
- Web i18n labels from `pieceColors.*` in pt-BR, es-PE, en-US (`preto`, `negro`, `marinho`, `marino`, `bordô`, `burdeos`, `prata`, `plata`, `verde-agua`, `verde azulado`, `cinza`/`gris`/`gray`/`grey`).
- Gendered forms (`preta`, `branca`, `negra`).
- Documented production tags: `azul marinho` → Navy, `azul escuro` → Navy, `azul claro` → Light Blue, `vermelho escuro` → Red, `vinho` → Burgundy, `chumbo` → Gray, `off-white` → Cream, `jeans claro` → Light Blue, `verde terroso` → Olive, `dourado escuro` → Gold, `cinza desbotado` → Gray, `ocre` → Khaki, `rosa claro` → Pink, `marrom escuro` / `marrom claro` → Brown.

Unmatched fragments are ignored (so `casual` never becomes a color). A piece has a descriptive color tag when at least one fragment maps.

- Alternative considered: LLM classification of tags. Rejected — tags in the wild are short color/size phrases; a table is deterministic and testable.
- Alternative considered: only exact `pieceColors` labels. Rejected — production tags include `tam. m`, `azul marinho / marrom`, `off-white`, which are not the UI labels.

### 4. Size matcher is independent and type-gated

For each tag, strip a leading size prefix (`tam.`, `tam`, `tamanho`, `talla`, `size`) and fold. Map:

- Catalog tokens as-is (`p`, `m`, `g`, `gg`, `46+`, numeric strings).
- Words: `pequeno`/`small`/`chico` → `P`; `medio`/`medium` → `M`; `grande`/`large` → `G`; plus extra-small / extra-large families onto `PP` / `GG` / `XPP` / `GGG` when those words appear.

Keep the first mapped size that `PIECE_SIZE_BY_TYPE[piece_type.source]` allows. If several distinct allowed sizes appear, log a warning and keep the first. No piece type, `accessory`, or empty allow-list → never set `id_size`.

Do not treat a color tag as a size (`p` is a size token; `preto` is not).

- Alternative considered: infer size from shopping preferences. Rejected — that is a user-level default, not the piece’s size.

### 5. `modern_colorthief` on opaque pixels, then nearest catalog hex

When no descriptive color tag exists and `image_url` is set:

1. HTTP GET the URL (timeout, follow redirects) with a SkyDIIV-backstage user agent.
2. Decode with Pillow to RGBA.
3. Ignore pixels with alpha `< 128` (same opaque floor as web `extract.ts`).
4. If no opaque pixels remain, skip colors.
5. Composite opaque pixels onto a tight RGB canvas (transparent padding removed) so the thief does not treat checkerboard/white matte as a color.
6. Call `modern_colorthief.get_color` for the dominant color.
7. Map that RGB to the catalog hex with squared Euclidean distance (port of web `nearestCatalogHex`).
8. Write **one** catalog color (`color_id` + frozen hex).

Per-item download/decode errors log and continue. `--limit N` caps items that need an image download after tag matching, so operators can sample Color Thief before a full apply.

- Alternative considered: web `colorthief` palette of up to 5 colors. Rejected — the request is a single nearest catalog color when tags are missing; tags already cover multi-color pieces.
- Alternative considered: R2 S3 GET with credentials. Rejected — `image_url` is already the public CDN URL used by the app; HTTP GET avoids new secrets.

### 6. Transactional writes per item, sequential loop

Process items sequentially. For each item that will change: in one transaction, optionally `DELETE FROM clothing_item_colors WHERE clothing_item_id = …` when `--force` and colors are inferred; `INSERT` new color rows; `UPDATE clothing_items SET id_size, updated_at, updated_by` when a size is inferred; after those writes succeed, `DELETE` that item’s `clothing_item_tags` for color-related tags (when colors were written) and size-related tags (when a size was written); then delete any of those `tags` rows that have no remaining clothing-item or outfit links. Commit per item so a later failure does not roll back earlier successful backfills. `--dry-run` skips the writes and still logs the intended rows and tag deletions.

Default selection: items missing colors **or** missing size (the other field can still be filled). `--force` loads all items.

- Alternative considered: one giant transaction. Rejected — a mid-run network blip would undo hours of Color Thief work.

### 7. Unit-test matchers; dry-run for the database

Add `pytest` in the script package (same idea as `scripts/202608_trim_r2_clothing_piece_gaps/`). Cover: folding + aliases (including the examples in the user request), compound split, generic `colorido` fallback flag, size prefix/word mapping, type allow-list, nearest-hex (e.g. RGB `(255,0,0)` → `#C0392B`). Mock HTTP for the image path. Do not add Vitest or worker lint.

## Risks / Trade-offs

- **[Risk] Ambiguous tags map to the wrong catalog color** (`jeans claro` → Light Blue is a heuristic; `marrom claro` could have been Beige) → Mitigation: keep aliases in one table with tests; `--dry-run` plus logs of tag → catalog name; `--force` can re-run after alias fixes.
- **[Risk] Color Thief on busy prints picks a background speckle** → Mitigation: drop low-alpha pixels and crop to the opaque box before `get_color`; still one color only, which can be wrong on true color-block garments — operators can `--force` after users edit.
- **[Risk] Public CDN GET rate or timeouts on thousands of images** → Mitigation: sequential downloads, timeout, `--limit`, continue on failure.
- **[Risk] Catalog constants drift from web** → Mitigation: README cites 1.27.0 hex table and Gold; startup abort if a name is missing from `domains`.
- **[Risk] Conflicting size tags** (`tam. m` and `42` on the same piece) → Mitigation: first allowed match + warning log.
- **[Risk] Deleting a shared tag too early** → Mitigation: unlink the item first; delete the `tags` row only when no `clothing_item_tags` or `outfit_tags` remain.

## Migration Plan

1. `uv sync` in the script folder; `--dry-run --env` against staging; inspect `output.txt` for alias misses.
2. Apply on staging without `--force`; spot-check a few pieces in the web wardrobe filters.
3. `--dry-run` on production, then apply. Use `--limit` first if Color Thief volume is unclear.
4. Re-run is safe without `--force` (already-filled rows are skipped). Alias fixes use `--force` on a sampled set, then full `--force` only if needed.

Rollback: delete `clothing_item_colors` rows with `created_by = 'script:202610_backfill_clothing_item_colors_and_sizes'` and set `id_size = NULL` where `updated_by` is that identifier **and** the previous size is unknown. Deleted color/size tags cannot be reconstructed from SQL undo alone. Prefer restoring a database snapshot (scheduler already takes them).

## Open Questions

None. Color Thief returns one nearest catalog color (not a palette) and size is tags-only; both are fixed in the spec.
