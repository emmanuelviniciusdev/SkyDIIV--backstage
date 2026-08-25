## Purpose

Operator-run job that snapshots production clothing-piece images in R2, then overwrites each eligible object with a tight cutout so stored assets match SkyDIIV web 1.17.11 upload trimming.

## ADDED Requirements

### Requirement: Backup clothing-pieces before mutation

The script MUST copy every object whose key is under the `clothing-pieces/` prefix to `clothing-pieces--backup--YYYY-MM-DD/`, where `YYYY-MM-DD` is the local calendar date of the run, before it overwrites any live clothing-piece object. The backup MUST live in the same assets bucket. The destination key MUST replace only the `clothing-pieces/` prefix (example: `clothing-pieces/abc.png` → `clothing-pieces--backup--2026-08-25/abc.png`). Folder-marker keys ending in `/` MUST be skipped.

#### Scenario: Full prefix copy before trim

- **GIVEN** the assets bucket contains `clothing-pieces/a.png` and `clothing-pieces/nested/b.webp`
- **WHEN** the script runs for real on 2026-08-25
- **THEN** it copies those objects to `clothing-pieces--backup--2026-08-25/a.png` and `clothing-pieces--backup--2026-08-25/nested/b.webp` before any live key is overwritten

#### Scenario: Backup prefix already occupied

- **GIVEN** at least one object already exists under `clothing-pieces--backup--YYYY-MM-DD/` for today's date
- **WHEN** the script starts without an explicit skip-backup flag
- **THEN** it MUST abort with a non-zero exit code and MUST NOT overwrite any `clothing-pieces/` object

#### Scenario: Incomplete backup blocks trim

- **GIVEN** a live object fails to copy into the backup prefix
- **WHEN** the backup phase finishes
- **THEN** the script MUST exit non-zero and MUST NOT overwrite any live clothing-piece object

### Requirement: Dry-run writes nothing to R2

When invoked with `--dry-run`, the script MUST list planned backup copies and planned trims and MUST NOT copy, put, or delete any R2 object.

#### Scenario: Dry-run preview

- **GIVEN** clothing-piece objects exist in the assets bucket
- **WHEN** the operator runs the script with `--dry-run`
- **THEN** the script logs the backup prefix and each object it would copy or trim
- **AND** no R2 object is created or overwritten

### Requirement: Trim transparent padding using the 1.17.11 opaque-bounds crop

After a successful backup, the script MUST process every non-folder object under `clothing-pieces/` (not under the backup prefix). For PNG and WebP bytes, it MUST decode to RGBA, find the axis-aligned box of pixels whose alpha is strictly greater than 16, expand that box by 2 pixels clamped to the image, and if the padded box is smaller than the canvas, crop to that box and encode PNG. Fully transparent images and images whose padded box already covers the whole canvas MUST be left unchanged. JPEG, GIF, AVIF, and undecodable objects MUST be left unchanged. Cropped objects MUST be written back to the same live key (no key rename, no database URL rewrite). Objects under `outfits/` MUST NOT be listed or modified.

#### Scenario: Padded PNG is cropped in place

- **GIVEN** `clothing-pieces/piece.png` is an 8×8 PNG with a single fully opaque pixel at (3,3) and transparent padding
- **WHEN** the script trims that object after backup
- **THEN** the live key `clothing-pieces/piece.png` is overwritten with a 5×5 PNG (1px subject plus 2px pad)
- **AND** `clothing_items.image_url` is not updated

#### Scenario: Already-tight cutout is skipped

- **GIVEN** a PNG whose opaque pixels plus 2px pad already fill the canvas
- **WHEN** the script processes that object
- **THEN** the live object bytes are left unchanged

#### Scenario: Opaque formats are skipped

- **GIVEN** `clothing-pieces/photo.jpg` is a JPEG
- **WHEN** the script processes that object
- **THEN** the live JPEG is left unchanged after the backup copy

#### Scenario: Outfit assets are out of scope

- **GIVEN** the bucket also contains `outfits/look.png`
- **WHEN** the script runs
- **THEN** `outfits/look.png` is neither copied to the backup prefix nor overwritten

#### Scenario: Fully transparent PNG is left unchanged

- **GIVEN** a PNG whose every pixel has alpha 16 or less
- **WHEN** the script processes that object
- **THEN** the live object bytes are left unchanged

#### Scenario: Per-object trim failure does not roll back the backup

- **GIVEN** backup completed successfully
- **AND** one clothing-piece image cannot be decoded or uploaded after crop
- **WHEN** the trim phase continues
- **THEN** that live key is left as the original bytes
- **AND** remaining objects are still processed
- **AND** the script exits non-zero after the run

### Requirement: Purge CDN after live overwrites

After the trim phase of a non-dry-run, the script MUST purge Cloudflare’s cache for the public clothing-piece prefix derived from `R2_PUBLIC_URL` (default host `assets.skydiiv.space`, prefix `assets.skydiiv.space/clothing-pieces`) so edge nodes stop serving pre-trim bytes for overwritten keys. A real run (including `--purge-only`) MUST abort before any R2 copy or put when `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID` is missing. Dry-run MUST log the intended prefix and MUST NOT call the purge API. If the purge API fails, the script MUST exit non-zero (R2 may already contain trimmed objects). `--purge-only` MUST call the same prefix purge and MUST NOT copy or put R2 objects.

#### Scenario: Missing purge credentials block mutation

- **GIVEN** `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID` is unset
- **WHEN** the operator starts a real run (not `--dry-run`)
- **THEN** the script exits non-zero
- **AND** no R2 object is copied or overwritten

#### Scenario: Prefix purge after apply

- **GIVEN** the trim phase has finished (with or without per-object skip/errors) on a real run
- **WHEN** the script performs CDN invalidation
- **THEN** Cloudflare Cache Purge is invoked for prefix `assets.skydiiv.space/clothing-pieces`
- **AND** subsequent anonymous GETs of a trimmed public URL are allowed to miss cache and fetch the new R2 object

#### Scenario: Dry-run does not purge

- **GIVEN** clothing-piece objects exist
- **WHEN** the operator runs with `--dry-run`
- **THEN** the script logs the purge prefix
- **AND** the Cloudflare purge API is not called

#### Scenario: Failed purge fails the run

- **GIVEN** at least one live object was processed on a real run
- **AND** the Cloudflare purge API returns an error
- **WHEN** the purge phase finishes
- **THEN** the script exits non-zero

#### Scenario: Purge-only retry

- **GIVEN** R2 already holds trimmed objects from a previous run whose purge failed
- **WHEN** the operator runs with `--purge-only`
- **THEN** the script calls the same prefix purge
- **AND** no R2 object is copied or overwritten
