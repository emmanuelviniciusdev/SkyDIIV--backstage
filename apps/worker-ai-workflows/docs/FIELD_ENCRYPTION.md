# Field encryption

Listed database columns this worker reads or writes use the same envelope as SkyDIIV web app. Workflow steps, prompts, geocoding, object storage, and signed workflow payloads stay plaintext. Repositories encrypt on write and decrypt on read.

## Byte layout

- AES-256-GCM.
- Per-row data key (DEK), wrapped by the key-encryption key (KEK).
- Standard base64 of `12-byte nonce || ciphertext || 16-byte tag`.
- Field additional authenticated data is UTF-8 `table + NUL + column + NUL + row id`.
- The wrapped DEK has no additional authenticated data.
- The row id is chosen before encrypting.

Each sealed row stores `dek`, `kek_version`, and `encrypted_columns`. `encrypted_columns` names the columns that currently hold ciphertext. Null listed values stay null and are omitted from that array.

A row with `dek` null is legacy plaintext. The next successful write of a listed column seals every non-null listed column on that row.

If the key store cannot supply the KEK version a write needs, the worker does not persist plaintext for that listed column and the operation fails. If a row's `kek_version` is missing from the key store, the read fails.

## Columns this worker touches

| Table | Columns | This worker |
|---|---|---|
| `users` | `first_name`, `last_name`, `preferred_name` | Read |
| `weekly_outfit_preferences` | `location`, `routine_description` | Read |
| `shopping_suggestions_preferences` | `top_size`, `bottom_size`, `foot_size`, `gender` | Read |
| `clothing_items` | `image_url` | Read |
| `feedbacks_automatic_thrifting` | `reason` | Read |
| `summaries_feedbacks_automatic_thrifting` | `summary` (including empty string) | Read and write |
| `llm_interactions` | `prompt`, `client_prompt`, `response` | Write |
| `outfits` | `image_url` | Write |
| `wardrobe_panorama` | `content` | Read and write |

`clothing_items.title`, `outfits.title`, `tags.name`, `outbox_events.payload`, `json_search`, `json_result`, `json_listed_product`, and `weekly_outfits.weather_summary` stay plaintext. `llm_interactions.client_prompt` is stored null here and is omitted from `encrypted_columns`.

Summary writes load the current row, seal the new text (a new DEK for the listed set), then `UPDATE`. The `outdated` / `updated_at` compare-and-swap stays in that `UPDATE`. Outfit inserts still leave `image_url` and `dek` null; `updateOutfitImageUrl` seals `image_url` and leaves `title` plaintext.

## Keys

KEK and lookup material live in a Clouflare D1 database. They are not stored in the application database (~durrrr).

| `DEPLOYMENT_ENVIRONMENT` | Key source                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `production`             | Clouflare D1 HTTP API                                                                                      |
| `staging`                | Clouflare D1 HTTP API (same table, so staging can open rows web staging sealed)                            |
| `local` or unset         | Fixed local test vectors (KEK `32×0x11`, lookup `32×0x22`, version `1`). Not secret. No key-database call. |

There is no `ENCRYPTION_KEY_SOURCE` switch.

Key-database query: `SELECT kek, kek_version, lookup_key, lookup_key_version FROM encryption_keys`. Current keys are the highest `kek_version`, then the highest `lookup_key_version`. Reads use `kek_version` on the row.

The worker may cache those JSON rows in the cache at `encryption:database-keys` for 3600 seconds, using `src/lib/cache/redis.ts`. That key is not a product-cache key. A removed KEK can stay cached for up to one hour.

Worker secrets (GitHub Environments `staging` and `production`, `wrangler secret bulk`, never `[vars]`):

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`
- `CLOUDFLARE_D1_API_TOKEN`
