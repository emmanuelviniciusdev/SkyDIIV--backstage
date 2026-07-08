# 202607 — Migrate Asset Domain

Updates stored R2 asset URLs from the old bare domain (`skydiiv.space`) to the
new assets subdomain (`assets.skydiiv.space`).

The script scans every row in `clothing_items` and `outfits` whose `image_url`
still points at the old domain, rewrites the host, and writes the result back
to the database.

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
# from inside this folder
cd scripts/202607_migrate_asset_domain

# install dependencies into an isolated .venv
uv sync
```

---

## Configuration

The script reads the database connection string from the environment.
Create a `.env` file (or copy it from the web project):

```dotenv
# preferred — bypasses the connection pooler
DATABASE_URL_UNPOOLED="postgresql://user:pass@host:5432/dbname"

# fallback if the above is not set
DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

You can place `.env` in:
- this folder (`scripts/202607_migrate_asset_domain/.env`)
- the current working directory when running the script
- or pass it explicitly via `--env`

---

## Usage

```bash
# from inside the script folder
cd scripts/202607_migrate_asset_domain

# preview changes without touching the database
uv run python __main__.py --dry-run

# apply changes
uv run python __main__.py

# use a .env file from a different location
uv run python __main__.py --env /path/to/.env
```

Output is written to both **stdout** and **`output.txt`** (gitignored).

---

## Migration rules

Only URLs whose host is exactly `skydiiv.space` are rewritten:

| Before | After |
|--------|-------|
| `https://skydiiv.space/items/<id>.jpg` | `https://assets.skydiiv.space/items/<id>.jpg` |
| `https://skydiiv.space/outfits/<id>.jpg` | `https://assets.skydiiv.space/outfits/<id>.jpg` |
| `http://skydiiv.space/items/<id>.jpg` | `http://assets.skydiiv.space/items/<id>.jpg` |

The following are **not** changed:

- URLs already on `assets.skydiiv.space`
- URLs on other subdomains (e.g. `www.skydiiv.space`)
- URLs on unrelated hosts (e.g. Cloudflare R2 direct endpoints)
- Rows where `image_url` is `NULL`

---

## Output format

Each line follows this pattern:

```
YYYY-MM-DD HH:MM:SS (UTC-3): [LEVEL] message
```

The timezone label reflects the local UTC offset at runtime (`UTC`, `UTC+1`,
`UTC-3`, etc.).

Example lines:

```
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] 202607_migrate_asset_domain started  dry_run=False
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Scanning clothing_items (clothing piece images)…
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Found 128 clothing piece row(s) with the old domain.
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] UPDATE  table=clothing_items  id=<uuid>
          old=https://skydiiv.space/items/<uuid>.jpg
          new=https://assets.skydiiv.space/items/<uuid>.jpg
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Scanning outfits (outfit images)…
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Found 42 outfit row(s) with the old domain.
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Done.  updated=170  skipped=0
```

Log levels: `DEBUG`, `INFO`, `WARNING`, `ERROR`.

---

## Database tables affected

| Table | Columns written |
|-------|----------------|
| `clothing_items` | `image_url`, `updated_at`, `updated_by` |
| `outfits` | `image_url`, `updated_at`, `updated_by` |

No rows are inserted or deleted.

---

## Shared utilities

Reusable helpers live under `scripts/utils/`:

| Module | Purpose |
|--------|---------|
| `db.py` | Database connection via `psycopg` (no ORM) |
| `logger.py` | Structured stdout / file logging |
