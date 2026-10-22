# apps/worker-scheduler/field-encryption Specification

## Purpose

Keep Sunday weekly-outfit dispatch correct when preference location and routine are ciphertext, without decrypting those rows in the scheduler.

## Requirements

### Requirement: Weekly-outfit eligibility ignores ciphertext emptiness

`worker-scheduler` MUST select users for weekly-outfit generation without treating a sealed `location` or `routine_description` value as opted-in merely because the stored string is not empty. A legacy row (`dek` IS NULL) MUST still qualify only when both `location` and `routine_description` are non-null and not the empty string. A sealed row MUST qualify only when both `location` and `routine_description` are present in `encrypted_columns` (null listed values are omitted from that array, so an unset location cannot qualify). The scheduler MUST NOT decrypt preference rows for this query.

#### Scenario: Sealed complete preferences still dispatch

- **GIVEN** a `weekly_outfit_preferences` row whose `dek` is set and whose `encrypted_columns` includes `location` and `routine_description`
- **WHEN** the Sunday weekly-outfits flow runs
- **THEN** that user is included in the dispatch set

#### Scenario: Sealed row missing routine does not dispatch

- **GIVEN** a `weekly_outfit_preferences` row whose `dek` is set
- **AND** `encrypted_columns` includes `location` but not `routine_description`
- **WHEN** the Sunday weekly-outfits flow runs
- **THEN** that user is not included in the dispatch set

#### Scenario: Legacy empty-string location still excluded

- **GIVEN** a `weekly_outfit_preferences` row whose `dek` is null, `location` is "", and `routine_description` is "office"
- **WHEN** the Sunday weekly-outfits flow runs
- **THEN** that user is not included in the dispatch set

#### Scenario: Ciphertext is not compared to empty string as the only filter

- **GIVEN** a sealed row whose stored `location` is ciphertext (never equal to "")
- **AND** `encrypted_columns` does not include both `location` and `routine_description`
- **WHEN** the Sunday weekly-outfits flow runs
- **THEN** that user is not included in the dispatch set

### Requirement: Schedule HTTP contracts stay the same

Field encryption MUST NOT change schedule paths, QStash payload shapes (`{ userId }`), or HTTP status codes. Unsigned or invalid signatures on `POST /schedule/every-sunday` MUST return `401` and MUST NOT query preference rows or publish generate-weekly-outfits messages.

#### Scenario: Unsigned Sunday request is rejected

- **GIVEN** a POST to `/schedule/every-sunday` with no valid `upstash-signature`
- **WHEN** the scheduler handles the request
- **THEN** the response status is `401`
- **AND** no QStash message is published to `/generate-weekly-outfits`
