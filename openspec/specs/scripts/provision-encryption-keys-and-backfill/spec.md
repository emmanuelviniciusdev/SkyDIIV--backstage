# scripts/provision-encryption-keys-and-backfill Specification

## Purpose

Operator-run provisioning and backfill that creates the Cloudflare D1 key database and `encryption_keys` table, inserts the first KEK and lookup-key version, and seals existing listed Neon columns with the same envelope SkyDIIV web v2.0.0 uses on write.

## Requirements

### Requirement: Dry-run writes nothing

When invoked with `--dry-run`, the script MUST log the D1 and Neon actions it would take and MUST NOT create a Cloudflare D1 database, MUST NOT insert into `encryption_keys`, and MUST NOT update any Neon row.

#### Scenario: Dry-run provision preview

- **GIVEN** no D1 database named `skydiiv--production` exists
- **WHEN** the operator runs provision with `--dry-run`
- **THEN** the script logs that it would create that database, create `encryption_keys`, and insert version-1 keys
- **AND** no D1 database is created
- **AND** `encryption_keys` is unchanged

#### Scenario: Dry-run backfill preview

- **GIVEN** a `users` row with `dek` null and plaintext `email` `ada@example.com`
- **WHEN** the operator runs backfill with `--dry-run`
- **THEN** the script logs that it would seal that row
- **AND** the stored `email` is still `ada@example.com`
- **AND** `dek` stays null

### Requirement: Provision creates the key database and table

The provision command MUST create a Cloudflare D1 database named `skydiiv--production` when none with that name exists. It MUST create table `encryption_keys` with columns `kek`, `kek_version`, `lookup_key`, `lookup_key_version`, `created_at`, and `created_by`, matching SkyDIIV web `scripts/database-encryption-keys.sql`. If a D1 database with that name already exists, the script MUST reuse it and MUST NOT create a second database. After provision, the script MUST print the D1 database UUID so operators can set `CLOUDFLARE_D1_ENCRYPTION_DATABASE_ID`.

#### Scenario: First-time database create

- **GIVEN** the Cloudflare account has no D1 database named `skydiiv--production`
- **WHEN** the operator runs provision without `--dry-run`
- **THEN** a D1 database named `skydiiv--production` exists
- **AND** it contains table `encryption_keys`
- **AND** the script prints that database’s UUID

#### Scenario: Existing database is reused

- **GIVEN** a D1 database named `skydiiv--production` already exists
- **WHEN** the operator runs provision
- **THEN** no additional D1 database is created
- **AND** the script prints the existing database UUID
- **AND** `encryption_keys` is created if it is missing

### Requirement: First key version is generated only when the table is empty

When `encryption_keys` has no rows, provision MUST generate a cryptographically random 32-byte KEK and a cryptographically random 32-byte lookup key, encode each as standard base64, and insert one row with `kek_version` `1` and `lookup_key_version` `1`. Those bytes MUST NOT be the local test vectors (`32×0x11` KEK, `32×0x22` lookup). When the table already has any row, provision MUST NOT insert another version-1 row and MUST NOT rotate or replace existing keys. Logs MUST NOT print KEK, lookup-key, or wrapped-DEK material.

#### Scenario: Empty table receives version 1

- **GIVEN** `encryption_keys` exists and has zero rows
- **WHEN** the operator runs provision without `--dry-run`
- **THEN** the table has one row with `kek_version` 1 and `lookup_key_version` 1
- **AND** `kek` and `lookup_key` are standard base64 of 32-byte values
- **AND** those values are not the local test vectors
- **AND** the log does not contain the key bytes or their base64

#### Scenario: Existing keys are left unchanged

- **GIVEN** `encryption_keys` already has a row with `kek_version` 1
- **WHEN** the operator runs provision
- **THEN** no additional row is inserted
- **AND** the existing `kek` and `lookup_key` values are unchanged

### Requirement: Backfill seals listed plaintext rows

The backfill command MUST load the current KEK and lookup key from `encryption_keys` (highest `kek_version`, then highest `lookup_key_version`). For each Neon table listed below, it MUST update every row whose `dek` is null and that has at least one non-null listed column. After a successful update, listed non-null values MUST be ciphertext, `dek` and `kek_version` MUST be set, and `encrypted_columns` MUST name exactly those sealed columns. Null listed values MUST stay null and MUST be omitted from `encrypted_columns`. Rows whose `dek` is already set MUST be left unchanged. Rows whose listed columns are all null MUST keep `dek` null.

Listed columns (SkyDIIV web v2.0.0 `ENCRYPTED_MODELS`, plus actor columns):

- `users`: `first_name`, `last_name`, `preferred_name`, `email`, `birth_date`, `profile_picture_url`, `created_by`, `updated_by`
- `weekly_outfit_preferences`: `location`, `routine_description`, `created_by`, `updated_by`
- `shopping_suggestions_preferences`: `top_size`, `bottom_size`, `foot_size`, `gender`, `created_by`, `updated_by`
- `clothing_items`: `image_url`, `created_by`, `updated_by`
- `feedbacks_automatic_thrifting`: `reason`, `created_by`, `updated_by`
- `summaries_feedbacks_automatic_thrifting`: `summary` (including the empty string), `created_by`, `updated_by`
- `llm_interactions`: `prompt`, `client_prompt`, `response`, `created_by`, `updated_by`
- `outfits`: `image_url`, `created_by`, `updated_by`
- `wardrobe_panorama`: `content`, `created_by`, `updated_by`
- `tags`: `created_by`, `updated_by`

`clothing_items.title`, `outfits.title`, `tags.name`, `outbox_events.payload`, `json_search`, `json_result`, `json_listed_product`, `weekly_outfits.weather_summary`, and `weekly_outfits.description_temperature` MUST stay plaintext. `created_by` / `updated_by` on `access_keys`, `domains`, `events`, and `outbox_events` MUST stay plaintext.

The envelope MUST match SkyDIIV web: AES-256-GCM, per-row DEK wrapped by the KEK, standard base64 of 12-byte nonce || ciphertext || 16-byte tag, field AAD of table + NUL + column + NUL + row id, DEK wrap with no AAD. Email MUST be trimmed and lowercased before it is sealed. Birth date MUST be stored as `YYYY-MM-DD` before it is sealed.

#### Scenario: User names and email become ciphertext

- **GIVEN** a `users` row with `dek` null, `first_name` `Ada`, `email` `Ada@Example.com`, and null `preferred_name`
- **AND** D1 holds version-1 keys
- **WHEN** the operator runs backfill without `--dry-run`
- **THEN** the stored `first_name` is not `Ada`
- **AND** the stored `email` is not `ada@example.com` and not `Ada@Example.com`
- **AND** `preferred_name` stays null
- **AND** `dek` and `kek_version` are set
- **AND** `encrypted_columns` includes `first_name` and `email` and does not include `preferred_name`

#### Scenario: Empty feedback summary is sealed

- **GIVEN** a `summaries_feedbacks_automatic_thrifting` row with `dek` null and `summary` equal to the empty string
- **WHEN** the operator runs backfill
- **THEN** the stored `summary` is not the empty string
- **AND** `encrypted_columns` includes `summary`

#### Scenario: Outfit with only a title and no actor fields is not sealed

- **GIVEN** an `outfits` row with `dek` null, plaintext `title` `Monday look`, null `image_url`, and null `created_by` / `updated_by`
- **WHEN** the operator runs backfill
- **THEN** `dek` stays null
- **AND** `title` stays `Monday look`
- **AND** `image_url` stays null

#### Scenario: Already sealed rows are skipped

- **GIVEN** a `wardrobe_panorama` row whose `dek` is set and whose `content` is already ciphertext
- **WHEN** the operator runs backfill
- **THEN** `content`, `dek`, `kek_version`, and `encrypted_columns` are unchanged

#### Scenario: Titles and tag names stay plaintext

- **GIVEN** a `clothing_items` row with plaintext `title` `Linen shirt` and plaintext `image_url`
- **AND** a `tags` row with `name` `casual`
- **WHEN** the operator runs backfill
- **THEN** `clothing_items.title` is still `Linen shirt`
- **AND** `tags.name` is still `casual`
- **AND** `clothing_items.image_url` is ciphertext

### Requirement: Actor columns store the email lookup hash then ciphertext

Before sealing `created_by` or `updated_by` on a listed table, the backfill MUST replace a value that contains `@` with the standard base64 HMAC-SHA256 `email_lookup` of the trimmed, lowercased email (UTF-8 `users` + NUL + `email` + NUL + normalized email, same bytes as `users.email_lookup`). It MUST NOT consult the `users` table for this rewrite. Values that are not emails (worker or script identifiers) MUST be left unchanged and then sealed. This rewrite MUST NOT change worker writes: workers keep storing their app names. `access_keys`, `domains`, `events`, and `outbox_events` MUST NOT have those columns rewritten or sealed.

#### Scenario: Email actor becomes email_lookup ciphertext

- **GIVEN** a `users` row with `dek` null, `email` `Ada@Example.com`, and `created_by` `Ada@Example.com`
- **WHEN** the operator runs backfill
- **THEN** the stored `created_by` is not `Ada@Example.com` and not `ada@example.com`
- **AND** decrypting `created_by` equals that row’s `email_lookup`
- **AND** `encrypted_columns` includes `created_by`

#### Scenario: Clothing-item actor uses the same lookup hash

- **GIVEN** a `clothing_items` row with `dek` null and `created_by` `Ada@Example.com`
- **WHEN** the operator runs backfill
- **THEN** decrypting `created_by` equals the HMAC `email_lookup` for `ada@example.com`

#### Scenario: Service identifier is sealed as-is

- **GIVEN** a `wardrobe_panorama` row with `dek` null, `content` plaintext, and `created_by` `worker-ai-workflows`
- **WHEN** the operator runs backfill
- **THEN** decrypting `created_by` yields `worker-ai-workflows`

### Requirement: User email lookup hash is populated

For each `users` row the backfill seals that has a non-null email, the script MUST set `email_lookup` to the standard base64 HMAC-SHA256 of the lookup key over UTF-8 `users` + NUL + `email` + NUL + normalized email (trimmed, lowercased), MUST record `email` in `lookup_columns`, and MUST set `lookup_key_version` to the current lookup-key version. Rows with null email MUST keep `email_lookup` null and MUST omit `email` from `lookup_columns`. Tables without lookup columns MUST NOT receive `lookup_key_version`.

#### Scenario: Email lookup is written with the sealed email

- **GIVEN** a `users` row with `dek` null and `email` `Ada@Example.com`
- **WHEN** the operator runs backfill
- **THEN** `email_lookup` is not null
- **AND** `email_lookup` is not `ada@example.com`
- **AND** `lookup_columns` includes `email`
- **AND** `lookup_key_version` is set

### Requirement: Backfill fails closed without keys and continues after per-row errors

If `encryption_keys` cannot supply a current KEK, backfill MUST NOT update any Neon listed column and MUST exit non-zero. A per-row seal or unique-constraint failure MUST be logged without key material or listed plaintext beyond the row id, MUST leave that row’s listed columns unchanged, and MUST continue with remaining rows. A fatal connection error MUST exit non-zero.

#### Scenario: Missing keys abort before Neon writes

- **GIVEN** `encryption_keys` has zero rows
- **WHEN** the operator runs backfill
- **THEN** no Neon listed column is updated
- **AND** the process exits non-zero

#### Scenario: One bad row does not stop the run

- **GIVEN** two `users` rows with `dek` null and non-null email
- **AND** sealing the first row fails
- **WHEN** the operator runs backfill
- **THEN** the first row is left plaintext with `dek` null
- **AND** the second row is sealed
