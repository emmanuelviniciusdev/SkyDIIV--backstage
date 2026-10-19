## 1. Script package

- [x] 1.1 Create `scripts/202610_backfill_clothing_item_colors_and_sizes/` with `pyproject.toml` (Python ≥ 3.12, `psycopg[binary]`, `python-dotenv`, `pillow`, `modern-colorthief`, `pytest`), `.env.example` (`DATABASE_URL_UNPOOLED` / `DATABASE_URL`), empty `__main__.py`, and `tests/`, then verify `uv sync` succeeds in that folder
- [x] 1.2 Write `README.md` covering `--dry-run`, apply, `--force`, `--limit`, `--env`, 1.27.0 catalog-only colors (including Gold), tag-first then Color Thief fallback, type-scoped sizes, deletion of related color/size tags after a successful write, `updated_by` identifier, and database snapshot rollback, then verify those flags and the rollback note are documented

## 2. Catalogs and tag matchers

- [x] 2.1 Add frozen 1.27.0 `piece_color` names/hex (including Gold `#D4AF37`) and `PIECE_SIZE_BY_TYPE` allow-lists, plus nearest-catalog hex by squared Euclidean RGB, then verify pytest maps `(255, 0, 0)` to `#C0392B` and lists all 21 catalog names
- [x] 2.2 Implement accent-folding color tag matching (longest phrase first, `/` and `-` splits, pt-BR / es-PE / en-US labels, gendered forms, documented aliases such as `azul marinho`, `vinho`, `off-white`, `colorido` as non-descriptive) and verify pytest covers the spec examples including `azul escuro / preto / branco` → Navy+Black+White and `negro`/`black` → Black
- [x] 2.3 Implement size tag matching (prefixes `tam.` / `talla` / `size`, word forms `médio` / `medium`, catalog tokens) gated by piece-type source and verify pytest: `tam. m` on a top → `M`; `médio` on a top → `M`; `tam. XPP` on footwear skipped; accessory never sized

## 3. Image fallback

- [x] 3.1 Download `image_url` over HTTP, decode RGBA with Pillow, drop pixels with alpha `< 128`, crop to the opaque box, run `modern_colorthief.get_color`, map to one catalog color, then verify pytest with a mocked fetch: a red opaque cutout becomes Red `#C0392B`; missing URL / failed download / no opaque pixels return no colors without raising

## 4. Runner

- [x] 4.1 Load `piece_color` / `piece_size` / `piece_type` domains from the database, abort if a catalog name is missing, select items missing colors and/or size (or all items with `--force`), and verify a mocked connection raises at startup when Gold is absent
- [x] 4.2 Implement per-item apply (`--dry-run` logs only; `--force` deletes then inserts colors; size update only when inferred; after a successful color/size write, delete that item’s related color/size `clothing_item_tags` and unused `tags` rows; `created_by`/`updated_by` = `script:202610_backfill_clothing_item_colors_and_sizes`; continue after per-item failures) and verify unit tests: dry-run issues no INSERT/UPDATE/DELETE; force replaces existing colors; color/size tags are deleted only after a successful write; non-matching tags stay; `--limit` caps image downloads

## 5. Verification

- [x] 5.1 Run `uv run pytest` in `scripts/202610_backfill_clothing_item_colors_and_sizes` and verify matcher, nearest-hex, image-fallback, and runner tests pass

No app under `apps/` is touched (no `npm run lint` / Vitest). No skydiiv/web Prisma, outbox, or Redis follow-up.
