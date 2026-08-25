## Why

SkyDIIV 1.17.11 now crops transparent PNG/WebP padding on every new upload, replace, and edit so pieces sit as tight cutouts on the creative board. Existing objects already in the production assets R2 bucket were stored before that crop, so older piece images still carry large transparent gaps and overlap incorrectly on the board. A one-off backstage script must backfill the same trim onto those assets, after copying the live prefix to a dated backup.

## What Changes

- Add a one-off Python script under `scripts/202608_trim_r2_clothing_piece_gaps/` that:
  - Duplicates every object under `clothing-pieces/` to `clothing-pieces--backup--YYYY-MM-DD/` (date of the run, local calendar date) in the production assets R2 bucket.
  - Then downloads each clothing-piece image, crops transparent / near-transparent padding using the 1.17.11 algorithm (`findOpaqueBounds` + 2px pad + PNG encode), and overwrites the original key in place.
- Support `--dry-run` so operators can preview backup copies, trims, and the CDN purge without writing to R2 or calling Cloudflare Cache Purge.
- After the trim phase of an apply, purge Cloudflare’s edge cache for the public clothing-piece prefix (`assets.skydiiv.space/clothing-pieces`) so overwritten keys are not served as stale bytes. Missing purge credentials abort before any R2 write. `--purge-only` retries that purge without further R2 writes.
- No worker, QStash, outbox, schedule, Prisma, or Redis changes. `skydiiv/web` does not need a follow-up: object keys and `clothing_items.image_url` stay the same.

## Non-goals

- Do not run ML background removal (`@imgly/background-removal` / ISNet). This script only trims leftover transparent padding, matching `trimTransparentImage` / `compressAndTrimImage` from web 1.17.11 — not `removeImageBackground`.
- Do not process `outfits/` or any prefix other than `clothing-pieces/`.
- Do not rewrite database URLs, change object keys, or convert JPEG/GIF/AVIF (no alpha channel to crop).
- Do not delete the backup prefix; operators remove `clothing-pieces--backup--YYYY-MM-DD/` manually after verifying production images.
- Do not add a Cloudflare Worker, CRON, or QStash job. This is a manually run script.

## Capabilities

### New Capabilities

- `scripts/trim-r2-clothing-piece-gaps`: Operator-run R2 job that snapshots `clothing-pieces/` to a dated backup prefix, overwrites each eligible piece image with a tight cutout using the web 1.17.11 opaque-bounds crop, then purges the public CDN prefix so `assets.skydiiv.space` serves the new bytes.

### Modified Capabilities

- (none)

## Impact

- **Affected area:** one-off script under `scripts/` (Python ≥ 3.12 via uv). No app under `apps/`.
- **skydiiv/web follow-up:** none (no Prisma schema, outbox catalog, Redis keys, or env URL changes). New uploads already trim client-side as of 1.17.11.
- **R2:** read/write on `skydiiv--production--assets` (same bucket as `scripts/202608_migrate_r2_production_assets`). Backup is a prefix copy inside that bucket, not a second bucket.
- **Schedule / QStash / outbox:** none.
- **CDN:** same-key overwrites would otherwise keep serving old PNGs at `assets.skydiiv.space` until TTL. The script MUST call Cloudflare Instant Purge (prefix) after apply; a failed purge is a failed run.
