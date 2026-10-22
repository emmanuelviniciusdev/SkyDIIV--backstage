## ADDED Requirements

### Requirement: Automatic-thrifting listed fields use envelope encryption

Generate-search-terms, analyze-scraped-products-results, and generate-wardrobe-panorama MUST load listed columns as plaintext after decrypt (panorama markdown, routine description, shopping sizes and gender, feedback summary, feedback reason) and MUST persist listed outputs as ciphertext (panorama content, LLM prompt/response, feedback summary). `json_search` gender and size copies MUST remain plaintext JSON. Application-visible prompt text, term variety rules, Redis notification keys, unsigned `401`, and outbox behavior from the existing requirements are unchanged.

#### Scenario: Search-term prompt uses decrypted sealed inputs

- **GIVEN** panorama `p1` whose `content`, owner routine, shopping gender/sizes, and feedback summary are sealed
- **WHEN** generate-search-terms builds the LLM prompt
- **THEN** the prompt contains the original plaintext panorama, routine, sizes, gender, and summary
- **AND** it does not contain the stored ciphertext of those columns

#### Scenario: Persisted summary is ciphertext while the prompt sees plaintext

- **GIVEN** feedbacks exist and the summary row is missing or outdated
- **WHEN** generate-search-terms refreshes the summary to text `likes blazers`
- **THEN** later prompt construction includes `likes blazers`
- **AND** the stored `summary` column is not `likes blazers`

#### Scenario: Panorama content is sealed without scrape outbox

- **GIVEN** a signed panorama workflow run that produces markdown "# Wardrobe"
- **WHEN** the workflow completes
- **THEN** `wardrobe_panorama.content` is saved as ciphertext
- **AND** no new `scrape-shopping-suggestions` outbox row is inserted
- **AND** a later search-term run for that panorama receives markdown "# Wardrobe"
