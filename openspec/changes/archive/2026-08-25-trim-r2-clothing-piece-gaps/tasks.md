## 1. Script package

- [x] 1.1 Create `scripts/202608_trim_r2_clothing_piece_gaps/` with `pyproject.toml` (Python ≥ 3.12, boto3, python-dotenv, Pillow, numpy, pytest), `.env.example` (`R2_ACCOUNT_ID` / `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET=skydiiv--production--assets`, `R2_PUBLIC_URL=https://assets.skydiiv.space`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`), and an empty `__main__.py`, then verify `uv sync` succeeds in that folder
- [x] 1.2 Write `README.md` covering dry-run, apply, `--skip-backup`, `--limit`, `--purge-only`, backup prefix naming, required Cache Purge token permission, prefix `assets.skydiiv.space/clothing-pieces`, and restore by copying `clothing-pieces--backup--YYYY-MM-DD/` back onto `clothing-pieces/`, then verify those flags and the restore mapping are documented

## 2. Opaque-bounds crop

- [x] 2.1 Port `find_opaque_bounds`, `pad_opaque_bounds`, and `is_full_image_bounds` (alpha threshold 16, pad 2px) and verify pytest covers a fully transparent buffer (no bounds), opaque box `{minX:2,minY:1,maxX:3,maxY:3}` on the 6×5 fixture from web `opaque-bounds.test.ts`, ignoring `alpha <= 16`, and pad clamp to image edges
- [x] 2.2 Implement PNG/WebP decode → RGBA crop → PNG encode (magic-byte sniff; skip JPEG/GIF/AVIF) and verify pytest: 8×8 PNG with one opaque pixel at (3,3) becomes 5×5 PNG; already-tight and fully transparent images return the original bytes

## 3. R2 backup and trim runner

- [x] 3.1 Implement listing `clothing-pieces/` (skip folder markers and `outfits/`), backup-prefix occupancy abort, sequential `copy_object` to `clothing-pieces--backup--YYYY-MM-DD/<rest>` before any put, and verify `--dry-run` logs planned copies without calling copy/put (unit-test the key mapping and abort-if-occupied helper)
- [x] 3.2 Implement the trim phase (download, crop, `put_object` same key with `Content-Type: image/png` when cropped; skip unchanged; continue after per-object trim errors with exit 1) plus `--skip-backup` / `--limit`, and verify a mocked client records backup copies before puts, leaves JPEG keys untouched after backup, and does not start puts when a backup copy fails
- [x] 3.3 After trim, POST Cloudflare Instant Purge for prefix `{R2_PUBLIC_URL host}/clothing-pieces` (skip the POST on `--dry-run`; support `--purge-only`; exit 1 on API error; fail fast at startup if token/zone id missing on a real run) and verify unit tests assert the JSON body `{"prefixes": ["assets.skydiiv.space/clothing-pieces"]}`, that dry-run does not POST, and that `--purge-only` does not copy or put

## 4. Verification

- [x] 4.1 Run `uv run pytest` in `scripts/202608_trim_r2_clothing_piece_gaps` and verify all crop, runner, and purge tests pass

No app under `apps/` is touched (no `npm run lint` / Vitest). No skydiiv/web Prisma, outbox, or Redis follow-up.
