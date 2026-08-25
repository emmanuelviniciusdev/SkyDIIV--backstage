# 202608 — Trim transparent padding on R2 clothing pieces

Backs up every object under ``clothing-pieces/`` in ``skydiiv--production--assets``
to ``clothing-pieces--backup--YYYY-MM-DD/`` (local calendar date of the run), then
crops leftover transparent padding on PNG/WebP piece images using the same
opaque-bounds algorithm as SkyDIIV web 1.17.11 (alpha ``> 16``, +2px pad, PNG
encode). Live object keys are not renamed, so ``clothing_items.image_url`` stays
valid. After the trim phase, Cloudflare Instant Purge is called for prefix
``assets.skydiiv.space/clothing-pieces`` so the public CDN does not keep serving
pre-trim bytes.

This does **not** run ML background removal. JPEG/GIF/AVIF are copied into the
backup and then left unchanged. ``outfits/`` is never listed.

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |
| Cloudflare R2 API token | read/write on the assets bucket |
| Cloudflare API token | **Zone → Cache Purge** on zone ``skydiiv.space`` |

The Cache Purge token is not the same permission set as the Wrangler deploy
token unless that token already includes Cache Purge.

---

## Setup

```bash
cd scripts/202608_trim_r2_clothing_piece_gaps
uv sync
cp .env.example .env
# fill in R2_* credentials, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID
```

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `R2_ACCOUNT_ID` or `R2_ENDPOINT` | — | S3 API endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | R2 credentials |
| `R2_BUCKET` | `skydiiv--production--assets` | Assets bucket |
| `R2_PUBLIC_URL` | `https://assets.skydiiv.space` | Public origin used to build the purge prefix |
| `CLOUDFLARE_API_TOKEN` | — | API token with Zone Cache Purge |
| `CLOUDFLARE_ZONE_ID` | — | Zone id for `skydiiv.space` (parent of `assets.`) |

Required on a real apply: R2 credentials **and** Cache Purge token + zone id
(missing purge credentials abort **before** any R2 copy or put). `--dry-run`
needs R2 credentials to list objects; it does not call Cache Purge.
`--purge-only` needs only the Cloudflare token + zone id.

---

## Usage

```bash
cd scripts/202608_trim_r2_clothing_piece_gaps

# preview backup copies, trims, and the purge prefix (no R2 writes, no purge POST)
uv run python __main__.py --dry-run

# apply: backup → trim → Instant Purge
uv run python __main__.py

# resume after a completed backup the same day (prefix already occupied)
uv run python __main__.py --skip-backup

# process only the first N listed live keys (those keys are the ones backed up)
uv run python __main__.py --limit 5

# retry CDN purge only (no R2 copy or put) after a trim whose purge failed
uv run python __main__.py --purge-only

uv run python __main__.py --env /path/to/.env
```

Logs go to **stdout** and **`output.txt`** (gitignored).

---

## Object key rules

| Live key | Backup key (run date 2026-08-25) |
|----------|----------------------------------|
| `clothing-pieces/abc.png` | `clothing-pieces--backup--2026-08-25/abc.png` |
| `clothing-pieces/nested/b.webp` | `clothing-pieces--backup--2026-08-25/nested/b.webp` |
| `outfits/look.png` | not copied, not trimmed |

If today's backup prefix already contains any object, the script aborts unless
``--skip-backup``. A failed backup copy aborts before any live overwrite.

Cropped PNG/WebP objects are written back to the **same** live key with
``Content-Type: image/png``. Already-tight cutouts, fully transparent images,
and JPEG/GIF/AVIF are not overwritten after backup.

---

## CDN purge

After the trim phase (even when some objects are skipped or fail to trim), the
script POSTs Cloudflare Instant Purge:

```json
{ "prefixes": ["assets.skydiiv.space/clothing-pieces"] }
```

The prefix is ``{R2_PUBLIC_URL host}/clothing-pieces`` (no scheme). A failed
purge is a failed run (exit 1) even if R2 writes succeeded — retry with
``--purge-only``. ``--dry-run`` logs this body and does not POST. ``outfits/``
and the whole ``assets.skydiiv.space`` hostname are not purged.

---

## Restore (manual)

The script does not delete the backup prefix. After verifying production images,
delete ``clothing-pieces--backup--YYYY-MM-DD/`` yourself.

To restore live keys from a backup, copy each backup object back onto the live
prefix (replace only the backup prefix):

| Backup key | Restore onto |
|------------|----------------|
| `clothing-pieces--backup--2026-08-25/abc.png` | `clothing-pieces/abc.png` |
| `clothing-pieces--backup--2026-08-25/nested/b.webp` | `clothing-pieces/nested/b.webp` |

Example (one object) with the [AWS CLI](https://aws.amazon.com/cli/) pointed at R2:

```bash
aws s3 cp \
  s3://skydiiv--production--assets/clothing-pieces--backup--2026-08-25/abc.png \
  s3://skydiiv--production--assets/clothing-pieces/abc.png
```

Then run this script with ``--purge-only`` so ``assets.skydiiv.space`` drops the
trimmed (or restored) cache.

---

## Tests

```bash
cd scripts/202608_trim_r2_clothing_piece_gaps
uv run pytest
```
