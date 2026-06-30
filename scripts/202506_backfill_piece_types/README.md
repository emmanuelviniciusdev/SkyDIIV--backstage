# 202506 — Backfill Piece Types

Populates `piece_type_id` and `piece_subtype_id` for clothing items that were
registered without a type or subtype.

The script reads each item's **title** from the database, runs it through a
rule-based classifier (`scripts/utils/piece_classifier.py`), and writes the
inferred `Domain` IDs back to `clothing_items`.

Tags are intentionally ignored — they describe attributes such as colour, fit,
or occasion and rarely encode the garment category reliably.

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
cd scripts/202506_backfill_piece_types

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
- this folder (`scripts/202506_backfill_piece_types/.env`)
- the current working directory when running the script
- or pass it explicitly via `--env`

---

## Usage

```bash
# from inside the script folder
cd scripts/202506_backfill_piece_types

# preview changes without touching the database
uv run python __main__.py --dry-run

# apply changes (only items missing type/subtype)
uv run python __main__.py

# re-classify ALL items, overwriting existing values
uv run python __main__.py --force

# use a .env file from a different location
uv run python __main__.py --env /path/to/.env
```

Output is written to both **stdout** and **`output.txt`** (gitignored).

---

## Classification Rules

The classifier (`scripts/utils/piece_classifier.py`) matches against the
normalised title (accent-folded, lowercased) using prefix rules in priority
order:

| Priority | Category | Title prefix keywords (pt-BR / en-US / es-PE)              |
|----------|----------|------------------------------------------------------------|
| 1 | Footwear | `tênis`, `sneaker`, `bota`, `boot`, `crocs`, …             |
| 2 | Accessory | `pulseira`, `colar`, `relógio`, `gorro`, `boné`, …         |
| 3 | Outerwear | `casaco`, `jaqueta`, `blazer`, `parka`, …                  |
| 4 | Bottom | `calça`, `shorts`, `bermuda`, `saia`, `jeans`, …           |
| 5 | Top | `camiseta`, `camiseta manga longa`, `camisa`, `moletom`, … |

Additional rules:

- **Compound prefixes before bare ones** — e.g. `camiseta manga longa` is
  checked before `camiseta` so the longest match wins.
- **Bottom → Jeans vs Trousers** — when the title contains `jeans` or `denim`
  (including inside a compound title such as `calça - jeans`), the subtype is
  Jeans; otherwise Trousers.
- **Outerwear before Top** — titles starting with `casaco` map to Coat even
  when the remainder of the title would otherwise suggest Hoodie.

Items that match no rule are logged as **UNCLASSIFIED** and left unchanged.

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
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] backfill-piece-types started  dry_run=False  force=False
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Found 42 item(s) to process.
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] NEW     id=<uuid>  title='<item title>'  type='Top'  subtype='T-Shirt'
YYYY-MM-DD HH:MM:SS (UTC-3): [WARNING] UNCLASSIFIED  id=<uuid>  title='<item title>'
YYYY-MM-DD HH:MM:SS (UTC-3): [INFO] Done.  updated=40  skipped=0  unclassified=2
```

Log levels: `DEBUG`, `INFO`, `WARNING`, `ERROR`.

---

## Database tables affected

| Table | Columns written |
|-------|----------------|
| `clothing_items` | `piece_type_id`, `piece_subtype_id`, `updated_at`, `updated_by` |

No rows are inserted or deleted.

---

## Shared utilities

Reusable helpers live under `scripts/utils/`:

| Module | Purpose |
|--------|---------|
| `db.py` | Database connection via `psycopg` (no ORM) |
| `logger.py` | Structured stdout / file logging |
| `piece_classifier.py` | Title-based type/subtype inference |
