## Context

See proposal.md for why existing R2 piece images still have transparent padding after SkyDIIV web 1.17.11.

Web 1.17.11 (`00ef851`) always crops PNG/WebP on upload via `compressAndTrimImage` → `toTightCutoutFile` → `trimTransparentImage`. The crop is `lib/upload/opaque-bounds.ts`:

- Scan RGBA; a pixel is opaque when `alpha > 16` (`OPAQUE_ALPHA_THRESHOLD`).
- Axis-aligned min/max of those pixels; fully transparent buffers return no bounds (leave source unchanged).
- Expand by 2px (`OPAQUE_BOUNDS_PADDING_PX`), clamped to the image.
- If the padded box already covers the canvas, skip encode.
- Otherwise crop and encode PNG.

This script is a Python port of that crop for objects already in R2. It follows `scripts/202608_migrate_r2_production_assets/`: `uv` + Python ≥ 3.12, boto3 against the R2 S3 API, `python-dotenv`, shared `scripts/utils/logger.py`. No worker, QStash, Workflow, outbox, Redis, or `serveMany` path. Env lives in the script `.env` (not wrangler.toml / GitHub Environment secrets). There is no worker URL.

Default bucket: `skydiiv--production--assets` (same destination as the 202608 assets migration). Source prefix: `clothing-pieces/`.

## Goals / Non-Goals

**Goals:**

- Port the 1.17.11 opaque-bounds crop so production piece PNGs/WebPs match new uploads.
- Snapshot the entire live prefix to a dated backup prefix in the same bucket before any overwrite.
- Keep `clothing_items.image_url` valid by never renaming keys.
- Give operators dry-run and a safe abort when today's backup prefix already exists.
- Invalidate `assets.skydiiv.space` clothing-piece cache as part of the same run so stale edge bytes are not left as an operator afterthought.

**Non-Goals:**

- Do not restate proposal non-goals (no ISNet, no outfits, no DB rewrites).
- Do not add pytest to older scripts. Tests here cover the crop port and the purge request shape.
- Do not purge `outfits/` or the whole `assets.skydiiv.space` hostname.
- Do not implement a full restore CLI; README still documents reverse `copy_object`.

## Decisions

### 1. One-off dated script, not a worker

Copy the layout of `scripts/202608_migrate_r2_production_assets/` (`__main__.py`, `pyproject.toml`, `.env.example`, `README.md`, gitignored `output.txt` / `.venv`).

- Alternative considered: Cloudflare Worker or QStash CRON. Rejected — one-shot mutation of production media, no schedule, no HTTP contract.

### 2. Same-bucket prefix backup, then in-place overwrite

1. `list_objects_v2` with `Prefix=clothing-pieces/` (exclude keys that already start with `clothing-pieces--backup-`).
2. Server-side `copy_object` to `clothing-pieces--backup--YYYY-MM-DD/<rest>` with `MetadataDirective=COPY`.
3. Abort if that backup prefix already has any object, unless `--skip-backup` (resume after a completed backup).
4. Abort the trim phase if any backup copy fails.
5. Download each live key, maybe crop, `put_object` to the **same** key.

Date is the host's local calendar date (`datetime.now().strftime("%Y-%m-%d")`), matching the operator's "current date".

- Alternative considered: second bucket. Rejected — operators asked for a folder duplicate; prefix copy is cheaper and matches the request.
- Alternative considered: overwrite first. Rejected — the backup MUST complete first (see spec).

### 3. Port opaque-bounds in Python (Pillow + NumPy), encode PNG, keep the key

Implement `find_opaque_bounds` / `pad_opaque_bounds` / `is_full_image_bounds` with the same constants (threshold 16, pad 2). Decode with Pillow to RGBA. Use NumPy `np.where(alpha > 16)` so large 2048px images stay acceptable in a sequential loop.

Cropped output is PNG bytes (`image/png`), matching `canvas.toBlob(..., 'image/png')`. The R2 **key does not change**, so stored URLs keep working even when the source was `.webp`. Set `Content-Type: image/png` on put. Sniff magic bytes (PNG `89 50 4E 47`, WebP `RIFF….WEBP`) rather than trusting the extension, same idea as web `sniffImageContentType`. JPEG/GIF/AVIF: skip after backup.

- Alternative considered: rename `.webp` → `.png` and update `clothing_items.image_url`. Rejected — extra DB blast radius; URLs must stay stable.
- Alternative considered: Pillow `Image.getbbox()`. Rejected — it treats any non-zero alpha as opaque; 1.17.11 ignores `alpha <= 16`.

### 4. Sequential R2 I/O, continue on trim errors

Process objects one at a time (list → copy/get/put). Trim failures log and leave the live object untouched (backup still holds the original); remaining keys continue; exit code 1 if any trim error. Backup-phase errors stop the run.

Flags: `--dry-run`, `--env`, `--skip-backup`, `--limit N` (cap processed live keys after listing, for a sampled apply), `--purge-only`. `--limit` still requires a successful backup of the **listed** keys it will touch, or `--skip-backup`.

- Alternative considered: thread pool. Rejected — R2 rate limits and simpler failure logs; piece count is hundreds-to-low-thousands, not millions.

### 5. Unit-test the crop; dry-run for R2

Existing dated scripts have no tests. This crop is a pixel-level port of web unit tests (`opaque-bounds.test.ts`, 5×5 crop from an 8×8 canvas with one opaque pixel at (3,3)). Add `pytest` in the script package for bounds + PNG round-trip. Do not add Vitest, Playwright, or worker lint — there is no app under `apps/`.

### 6. Cloudflare Instant Purge by prefix after apply

R2 custom domains cache overwritten objects until TTL ([R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)). Setting `Cache-Control` on `put_object` does not evict bytes already at the edge.

After the trim phase (non-dry-run), `POST /zones/{zone_id}/purge_cache` with:

```json
{ "prefixes": ["assets.skydiiv.space/clothing-pieces"] }
```

Prefix is `urlparse(R2_PUBLIC_URL).netloc + "/clothing-pieces"` (no scheme; Cloudflare prefix syntax). Default public URL: `https://assets.skydiiv.space`. This is available on all Cloudflare plans (up to 100 prefixes per request). Do **not** purge by hostname (would drop `outfits/` cache) and do **not** purge-everything.

Use `urllib` (stdlib) so the package does not add `httpx`/`requests`. Auth: `Authorization: Bearer $CLOUDFLARE_API_TOKEN` with **Zone → Cache Purge**. That is not the same permission set as GitHub `CLOUDFLARE_API_TOKEN` used for Wrangler deploys — operators put a purge-capable token in this script’s `.env`.

`--purge-only` skips list/copy/put and only runs this call (retry after a trim that succeeded but whose purge failed). Dry-run logs the JSON body and does not POST. Missing `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ZONE_ID` aborts at startup on a real run **before** backup or trim. Purge API error → exit 1 even if R2 writes succeeded.

- Alternative considered: purge each overwritten URL (single-file). Rejected as the primary path — thousands of keys vs one prefix; keep URL batching only if prefix purge is rejected by the zone.
- Alternative considered: README-only manual purge. Rejected — the user required this risk to be mitigated in the job.

Env vars (script `.env`, never committed):

| Variable | Default | Purpose |
|---|---|---|
| `R2_ACCOUNT_ID` or `R2_ENDPOINT` | — | S3 API endpoint |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | R2 credentials |
| `R2_BUCKET` | `skydiiv--production--assets` | Assets bucket |
| `R2_PUBLIC_URL` | `https://assets.skydiiv.space` | Public origin used to build the purge prefix |
| `CLOUDFLARE_API_TOKEN` | — | API token with Zone Cache Purge |
| `CLOUDFLARE_ZONE_ID` | — | Zone id for `skydiiv.space` (parent of `assets.`) |

No `DATABASE_URL`. No wrangler `[vars]`. Script secrets stay in `.env`; do not wire GitHub Environment deploy tokens unless they actually have Cache Purge.

```text
list clothing-pieces/*
        │
        ▼
copy → clothing-pieces--backup--YYYY-MM-DD/*
        │  (abort on existing prefix or copy error)
        ▼
for each live PNG/WebP:
  download → RGBA → opaque bounds → crop? → put same key
        │
        ▼
POST zones/{id}/purge_cache  prefixes=[assets.skydiiv.space/clothing-pieces]
```

## Risks / Trade-offs

- [Stale CDN bytes at `assets.skydiiv.space`] → After trim, Instant Purge the `clothing-pieces` prefix. Failed purge fails the run; `--purge-only` retries without touching R2.
- [Deploy token lacks Cache Purge] → Script `.env` uses a dedicated token; README lists the required permission. Missing token/zone id fails before R2 writes on a real run (validate config at startup).
- [WebP URL serving PNG bytes] → Browsers honor `Content-Type`. Accept the mismatch rather than rewrite keys.
- [JPEG letterbox / white padding] → 1.17.11 does not crop opaque pixels. Those files stay as-is; only alpha gaps are removed.
- [Re-run on a new calendar day] → Creates a new backup of already-trimmed images. Operators should `--skip-backup` only to resume the same day after a finished snapshot.
- [Partial backup left behind on abort] → Next run that day aborts because the prefix is occupied. Operator deletes the incomplete backup prefix or uses `--skip-backup` only if they verified the snapshot is complete.

## Migration Plan

1. `uv sync` in `scripts/202608_trim_r2_clothing_piece_gaps`, fill `.env` from `.env.example`.
2. `--dry-run` and confirm backup prefix, trim counts, and the logged purge prefix.
3. Apply (no `--dry-run`). Confirm exit 0, log summary (copied / trimmed / skipped / errors), and a successful Cache Purge response.
4. Spot-check a few public piece URLs without relying on a hard refresh; if purge failed, `--purge-only`.
5. Leave `clothing-pieces--backup--YYYY-MM-DD/` in place until satisfied; delete that prefix manually later.

Rollback: `copy_object` each backup key back onto `clothing-pieces/<rest>` (document the reverse mapping in the README). The script itself does not implement restore in this change.
