## Purpose

Keep language sync translating plaintext panorama markdown while storing sealed `wardrobe_panorama.content` and `llm_interactions` text with the same envelope as SkyDIIV web v2.0.0.

## ADDED Requirements

### Requirement: Language sync listed columns are ciphertext at rest

`worker-sync` MUST decrypt `wardrobe_panorama.content` before sending it to the translation LLM and MUST encrypt the translated content before writing it back. Prompt and response text written to `llm_interactions` MUST be sealed. A successful read MUST return the original plaintext. A successful write MUST NOT leave plaintext of a non-null listed column in the database.

`weekly_outfits.weather_summary` and `weekly_outfits.description_temperature` MUST stay plaintext.

Each write of a listed column MUST persist `dek`, `kek_version`, and `encrypted_columns` on that row. `encrypted_columns` MUST name exactly the sealed columns on that row that currently hold ciphertext. Null sealed values MUST stay null and MUST be omitted from `encrypted_columns`. The key-encryption key MUST be read from the key database `skydiiv--production`, table `encryption_keys`. The worker MAY cache keys in Redis under `encryption:database-keys` with a 1-hour TTL.

The envelope MUST match SkyDIIV web: AES-256-GCM, per-row DEK, standard base64 of 12-byte nonce || ciphertext || 16-byte tag, field AAD of table + NUL + column + NUL + row id, DEK wrap with no AAD. The row id MUST be known before encrypting.

#### Scenario: Translated panorama is stored as ciphertext

- **GIVEN** a sealed panorama whose plaintext content is "Análise do guarda-roupa"
- **WHEN** `POST /sync/language` translates it to "Wardrobe analysis" and saves
- **THEN** the stored `content` is not "Wardrobe analysis"
- **AND** the row has a `dek`, a `kek_version`, and `encrypted_columns` including `content`
- **AND** a later read returns "Wardrobe analysis"

#### Scenario: Sync LLM audit row is sealed

- **GIVEN** a successful translation LLM call
- **WHEN** the worker inserts `llm_interactions`
- **THEN** the stored `prompt` is not the plaintext prompt
- **AND** when `response` is non-null the stored `response` is not the plaintext response

#### Scenario: Weekly outfit weather strings stay plaintext

- **GIVEN** a weekly outfit whose `weather_summary` is "Céu limpo"
- **WHEN** language sync translates and writes that field
- **THEN** the stored `weather_summary` is the translated plaintext
- **AND** that write does not require a `dek` on `weekly_outfits`

### Requirement: Legacy panorama rows stay readable

A `wardrobe_panorama` row whose `dek` is null MUST be treated as legacy plaintext. Reads MUST return the stored content unchanged. The next successful content write MUST encrypt that content, set `dek` and `kek_version`, and record `content` in `encrypted_columns`.

#### Scenario: Sync reads a panorama that has not been encrypted yet

- **GIVEN** a panorama row with a null `dek` and plaintext content "Análise"
- **WHEN** language sync loads that row
- **THEN** the translation input is "Análise"

#### Scenario: Sync write encrypts a legacy panorama

- **GIVEN** a panorama row with a null `dek` and plaintext content "Análise"
- **WHEN** language sync writes the translated content
- **THEN** the stored `content` is ciphertext
- **AND** a later read returns the translated plaintext

### Requirement: Key source follows the worker environment

The worker MUST choose the key store from `DEPLOYMENT_ENVIRONMENT`. When that value is `production` or `staging`, it MUST load keys from Cloudflare D1 (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`, `CLOUDFLARE_D1_API_TOKEN`) and MAY cache them in Redis. When the value is `local` or unset, it MUST use the web local test vectors and MUST NOT call D1. The worker MUST NOT introduce a separate `ENCRYPTION_KEY_SOURCE` switch.

#### Scenario: Production loads keys from D1

- **GIVEN** `DEPLOYMENT_ENVIRONMENT` is `production`
- **WHEN** language sync seals or opens `wardrobe_panorama.content`
- **THEN** keys are read from `encryption_keys` (or the Redis cache of that table)
- **AND** the local test vectors are not used

#### Scenario: Local development uses fixed test vectors

- **GIVEN** `DEPLOYMENT_ENVIRONMENT` is `local` or unset
- **WHEN** language sync seals or opens `wardrobe_panorama.content`
- **THEN** it uses the local test vectors
- **AND** it does not call the D1 HTTP API

### Requirement: Encryption failures fail closed

If the key store cannot provide the key version a write needs, the worker MUST NOT persist plaintext for a listed column and MUST fail the operation. If a row's `kek_version` is missing from the key store, a read MUST fail rather than return ciphertext as the field value. Logs and traces MUST NOT include key material, `dek`, or listed-column plaintext beyond the translation prompt already sent to Gemini.

#### Scenario: Key store unavailable on panorama update

- **GIVEN** the key store cannot be read
- **WHEN** language sync would write translated `wardrobe_panorama.content`
- **THEN** the content is not persisted as plaintext
- **AND** the workflow step fails

#### Scenario: Unknown key version on panorama read

- **GIVEN** a panorama row whose `kek_version` is not in the key store
- **WHEN** language sync reads `content`
- **THEN** the read fails
- **AND** the ciphertext is not sent to the translation LLM

### Requirement: Language sync HTTP contracts stay the same

Field encryption MUST NOT change `POST /sync/language`, the workflow key `language`, the payload `{ userid, old_language, new_language }`, or HTTP status codes. Unsigned requests MUST return `401` and MUST NOT read or write listed columns. `GET /` MUST remain unsigned.

#### Scenario: Unsigned language sync is rejected without DB writes

- **GIVEN** a POST to `/sync/language` without a valid QStash/Workflow signature
- **WHEN** the worker handles the request
- **THEN** the response status is `401`
- **AND** no `wardrobe_panorama` or `llm_interactions` row is updated or inserted
