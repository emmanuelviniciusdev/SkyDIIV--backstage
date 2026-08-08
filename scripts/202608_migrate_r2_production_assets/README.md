# 202608 — Copy R2 production assets

Copies every object from ``skydiiv-clothing-pieces`` into
``skydiiv--production--assets``, placing former root (piece) keys under
``clothing-pieces/``, and rewrites ``clothing_items.image_url`` so those paths
match. The source bucket is left untouched — delete it manually after cutover.

Outfit keys under ``outfits/`` are copied with the same path (no DB change for
``outfits.image_url``).

---

## Prerequisites

| Tool | Version |
|------|---------|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.4 |
| Python | ≥ 3.12 (managed by uv) |
| Cloudflare R2 API token | read/write on source + dest buckets |
| PostgreSQL | accessible via connection string |

Create the destination bucket and attach the public custom domain / CORS **before**
running the script. Point app env ``R2_BUCKET`` at the new bucket only after a
successful migration (or after cutover planning).

---

## Setup

```bash
cd scripts/202608_migrate_r2_production_assets
uv sync
cp .env.example .env
# fill in DATABASE_URL_UNPOOLED, R2_* credentials, R2_PUBLIC_URL
```

---

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL_UNPOOLED` / `DATABASE_URL` | — | Postgres connection |
| `R2_ACCOUNT_ID` or `R2_ENDPOINT` | — | S3 API endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | R2 credentials |
| `R2_SOURCE_BUCKET` | `skydiiv-clothing-pieces` | Old bucket |
| `R2_DEST_BUCKET` | `skydiiv--production--assets` | New bucket |
| `R2_PUBLIC_URL` | — | Public base used to strip/rebuild piece URLs (e.g. `https://assets.skydiiv.space`) |

---

## Usage

```bash
cd scripts/202608_migrate_r2_production_assets

# preview R2 copies + SQL updates
uv run python __main__.py --dry-run

# apply
uv run python __main__.py

# only one phase
uv run python __main__.py --skip-db
uv run python __main__.py --skip-r2

uv run python __main__.py --env /path/to/.env
```

Logs go to **stdout** and **`output.txt`** (gitignored).

---

## Object key rules

| Source key | Destination key |
|------------|-----------------|
| `abc.jpg` | `clothing-pieces/abc.jpg` |
| `clothing-pieces/abc.jpg` | `clothing-pieces/abc.jpg` (unchanged) |
| `outfits/look.png` | `outfits/look.png` (unchanged) |

Each object is **copied** to the destination. Source keys are **not** deleted.
If any R2 copy fails, the script aborts before writing database changes.

---

## Database rules

Only ``clothing_items.image_url`` is updated.

| Before | After |
|--------|-------|
| `https://assets.skydiiv.space/abc.jpg` | `https://assets.skydiiv.space/clothing-pieces/abc.jpg` |
| `https://assets.skydiiv.space/clothing-pieces/abc.jpg` | unchanged |
| `https://assets.skydiiv.space/outfits/look.png` | unchanged (and not selected as a piece rewrite when already prefixed) |

Rows whose path already has ``clothing-pieces/`` or ``outfits/`` are skipped.
``updated_by`` is set to ``script:202608_migrate_r2_production_assets``.

---

## Suggested cutover

1. Create ``skydiiv--production--assets``, CORS, public domain.
2. Deploy SkyDIIV with ``generateUploadKey`` writing ``clothing-pieces/…`` (and keep
   reading existing URLs).
3. ``--dry-run`` this script, then run for real.
4. Set ``R2_BUCKET=skydiiv--production--assets`` (and matching ``R2_PUBLIC_URL``) on
   SkyDIIV + backstage worker; redeploy.
5. After verifying images, delete ``skydiiv-clothing-pieces`` manually.
