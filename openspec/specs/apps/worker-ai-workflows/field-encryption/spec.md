# apps/worker-ai-workflows/field-encryption Specification

## Purpose

Protect listed Neon columns this worker reads and writes with the same envelope encryption as SkyDIIV web v2.0.0, so workflows still see plaintext while at-rest values stay ciphertext.

## Requirements

### Requirement: Listed columns are ciphertext at rest

`worker-ai-workflows` MUST encrypt listed columns before they are stored and MUST decrypt them before workflow code uses them. A successful read MUST return the original plaintext. A successful write MUST NOT leave plaintext of a non-null listed column in the database.

Sealed columns this worker reads or writes:

- `clothing_items.image_url` (read)
- `feedbacks_automatic_thrifting.reason` (read)
- `summaries_feedbacks_automatic_thrifting.summary` (read and write, including empty string)
- `llm_interactions.prompt`, `client_prompt`, `response` (write)
- `outfits.image_url` (write)
- `shopping_suggestions_preferences.top_size`, `bottom_size`, `foot_size`, `gender` (read)
- `users.first_name`, `last_name`, `preferred_name` (read)
- `wardrobe_panorama.content` (read and write)
- `weekly_outfit_preferences.location`, `routine_description` (read)

`clothing_items.title`, `outfits.title`, `tags.name`, `outbox_events.payload`, `json_search`, `json_result`, `json_listed_product`, and `weekly_outfits.weather_summary` MUST stay plaintext.

Each write of a listed column MUST persist `dek`, `kek_version`, and `encrypted_columns` on that row. `encrypted_columns` MUST name exactly the sealed columns on that row that currently hold ciphertext. Null sealed values MUST stay null and MUST be omitted from `encrypted_columns`. The key-encryption key MUST be read from the key database `skydiiv--production`, table `encryption_keys`. The worker MAY cache `kek`, `kek_version`, `lookup_key`, and `lookup_key_version` in Redis under `encryption:database-keys` with a 1-hour TTL. Those keys MUST NOT be stored in the application database.

The envelope MUST match SkyDIIV web: AES-256-GCM, per-row DEK, standard base64 of 12-byte nonce || ciphertext || 16-byte tag, field AAD of table + NUL + column + NUL + row id, DEK wrap with no AAD. The row id MUST be known before encrypting.

#### Scenario: Panorama write stores ciphertext and later read returns markdown

- **GIVEN** a signed panorama workflow that produces markdown "# Wardrobe"
- **WHEN** the worker persists `wardrobe_panorama.content`
- **THEN** the stored `content` is not "# Wardrobe"
- **AND** the row has a `dek`, a `kek_version`, and `encrypted_columns` including `content`
- **AND** a later read used to build search-term prompts returns "# Wardrobe"

#### Scenario: Outfit thumbnail write seals only image_url

- **GIVEN** an AI-generated outfit row whose title is "Monday look" and whose `image_url` is null
- **WHEN** the worker saves thumbnail URL "https://r2.example/outfit.png"
- **THEN** the stored `image_url` is not "https://r2.example/outfit.png"
- **AND** the stored `title` is still "Monday look"
- **AND** `encrypted_columns` includes `image_url` and not `title`

#### Scenario: Empty feedback summary is sealed

- **GIVEN** an outdated summary row for a user with zero feedbacks
- **WHEN** the worker clears that summary to an empty string
- **THEN** the stored `summary` is not the empty string
- **AND** `encrypted_columns` includes `summary`
- **AND** a later application read of that row returns ""

#### Scenario: LLM audit row is sealed

- **GIVEN** a successful Gemini call whose prompt contains a user display name
- **WHEN** the worker inserts `llm_interactions`
- **THEN** the stored `prompt` is not the plaintext prompt
- **AND** when `response` is non-null the stored `response` is not the plaintext response
- **AND** the row has `encrypted_columns` including `prompt`

### Requirement: Workflows receive plaintext listed inputs

Reads of listed columns MUST decrypt when `dek` is a non-null string. Display names, location, routine, shopping sizes and gender, clothing image URLs, panorama markdown, feedback reasons, and feedback summaries MUST be plaintext in prompts, geocoding queries, and image fetches. QStash workflow payloads MUST stay plaintext JSON.

#### Scenario: Weekly outfits geocodes plaintext location

- **GIVEN** a sealed `weekly_outfit_preferences` row whose plaintext location is "São Paulo, São Paulo, Brasil"
- **WHEN** generate-weekly-outfits builds the weather query
- **THEN** the geocoding input contains "São Paulo"
- **AND** it does not use the stored ciphertext as the city name

#### Scenario: Panorama prompt uses plaintext names and image URLs

- **GIVEN** a sealed user row with preferred name "Ana" and a sealed clothing item whose image URL is "https://r2.example/shirt.jpg"
- **WHEN** generate-wardrobe-panorama builds the LLM prompt
- **THEN** the prompt contains "Ana"
- **AND** the image fetch uses "https://r2.example/shirt.jpg"

#### Scenario: Search terms use decrypted routine, sizes, and summary

- **GIVEN** sealed routine "escritório", sealed gender "Female", sealed top size "M", and a sealed non-empty feedback summary "likes blazers"
- **WHEN** generate-search-terms-products-scraping builds the prompt
- **THEN** that prompt contains those plaintext values
- **AND** `json_search` written for scrape terms still stores plaintext gender and sizes

### Requirement: Legacy plaintext rows stay readable

A row whose `dek` is null MUST be treated as legacy plaintext. Reads of its listed columns MUST return the stored values unchanged. The next successful write of a listed column on that row MUST encrypt every non-null listed column on that row, leave null listed columns null, set `dek` and `kek_version`, and record those ciphertext columns in `encrypted_columns`.

#### Scenario: Read a panorama that has not been encrypted yet

- **GIVEN** a `wardrobe_panorama` row with a null `dek` and plaintext content "# Old"
- **WHEN** generate-search-terms loads that panorama
- **THEN** the prompt markdown is "# Old"

#### Scenario: Later thumbnail write encrypts the outfit image

- **GIVEN** an outfit row with a null `dek`, plaintext title, and null `image_url`
- **WHEN** the worker writes the thumbnail URL
- **THEN** the title stays plaintext
- **AND** the image URL is stored as ciphertext
- **AND** a later read of that image URL returns the original URL

### Requirement: Key source follows the worker environment

The worker MUST choose the key store from `DEPLOYMENT_ENVIRONMENT`. When that value is `production` or `staging`, it MUST load keys from Cloudflare D1 (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`, `CLOUDFLARE_D1_API_TOKEN`) and MAY cache them in Redis. When the value is `local` or unset, it MUST use the web local test vectors and MUST NOT call D1. The worker MUST NOT introduce a separate `ENCRYPTION_KEY_SOURCE` switch.

#### Scenario: Production loads keys from D1

- **GIVEN** `DEPLOYMENT_ENVIRONMENT` is `production`
- **WHEN** the worker seals or opens a listed column
- **THEN** keys are read from `encryption_keys` (or the Redis cache of that table)
- **AND** the local test vectors are not used

#### Scenario: Local development uses fixed test vectors

- **GIVEN** `DEPLOYMENT_ENVIRONMENT` is `local` or unset
- **WHEN** the worker seals or opens a listed column
- **THEN** it uses the local test vectors
- **AND** it does not call the D1 HTTP API

### Requirement: Encryption failures fail closed

If the key store cannot provide the key version a write needs, the worker MUST NOT persist plaintext for a listed column and MUST fail the operation. If a row's `kek_version` is missing from the key store, a read MUST fail rather than return ciphertext as the field value. Logs, traces, and QStash payloads MUST NOT include key material, `dek`, lookup hashes, or listed-column plaintext beyond what that workflow already sends to Gemini, geocoding, or R2.

#### Scenario: Key store unavailable on panorama write

- **GIVEN** the key store cannot be read
- **WHEN** the worker would save `wardrobe_panorama.content`
- **THEN** the content is not persisted as plaintext
- **AND** the workflow step fails

#### Scenario: Unknown key version on preference read

- **GIVEN** a preferences row whose `kek_version` is not in the key store
- **WHEN** generate-weekly-outfits reads `location`
- **THEN** the read fails
- **AND** the ciphertext is not used as the city name

### Requirement: HTTP and workflow contracts stay the same

Field encryption MUST NOT change workflow paths, workflow keys, QStash payload shapes, or HTTP status codes. Unsigned requests that are not valid Upstash Workflow/QStash callbacks MUST return `401` and MUST NOT read or write listed columns. `GET /` MUST remain unsigned.

#### Scenario: Unsigned workflow POST is rejected without DB writes

- **GIVEN** a POST to `/generate-wardrobe-panorama` without a valid QStash/Workflow signature
- **WHEN** the worker handles the request
- **THEN** the response status is `401`
- **AND** no `wardrobe_panorama` or `llm_interactions` row is inserted or updated
