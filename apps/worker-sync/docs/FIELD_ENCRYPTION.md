# Field encryption

Language sync decrypts `wardrobe_panorama.content` before the translation LLM and encrypts the translated content before writing it back. `llm_interactions.prompt` and `response` are sealed on insert. `weekly_outfits.weather_summary` and `weekly_outfits.description_temperature` stay plaintext.

The envelope matches SkyDIIV web app. Workflow payloads stay plaintext.

## Byte layout

- AES-256-GCM.
- Per-row data key (DEK), wrapped by the key-encryption key (KEK).
- Standard base64 of `12-byte nonce || ciphertext || 16-byte tag`.
- Field additional authenticated data is UTF-8 `table + NUL + column + NUL + row id`.
- The wrapped DEK has no additional authenticated data.
- The row id is chosen before encrypting.

Each sealed row stores `dek`, `kek_version`, and `encrypted_columns`. `encrypted_columns` names the columns that currently hold ciphertext. Null listed values stay null and are omitted from that array. `llm_interactions.client_prompt` is stored null and is omitted.

A panorama row with `dek` null is legacy plaintext. The next successful content write seals that content.

If the key store cannot supply the KEK version a write needs, the worker does not persist plaintext for that listed column and the operation fails. If a row's `kek_version` is missing from the key store, the read fails and the ciphertext is not sent to the translation LLM.

## Keys

KEK and lookup material live in a Clouflare D1 database. They are not stored in the application database.

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
