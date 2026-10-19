# Test plan

## Objectives

Verify functional requirements, data quality, security boundaries, source authorization, recommendation explainability, accessibility, and deployment readiness. Tests should use deterministic demo fixtures and never depend on a live third-party listing source.

## Test levels

- **Unit:** validators, normalization, freshness policy, ranking functions, reason-code generation, dedupe candidate scoring, and error mapping.
- **Integration:** Worker routes, D1 repositories/migrations, import transactions, rate limits, authorization, and API response schemas.
- **End-to-end:** search-to-results flow, detail/provenance, import review, RTL behavior, keyboard operation, and mobile viewports.
- **Operational:** Cloudflare preview/deployment configuration, secrets, logs, migration process, rate limits, and recovery from failed ingestion.
- **Manual accessibility review:** keyboard-only operation, screen reader labels/announcements, zoom/reflow, contrast, and RTL reading order.

## Fixtures

Maintain versioned, synthetic fixtures under the application's test fixture location (the actual implementation path is to be confirmed). Do not use real addresses, personal names, phone numbers, or scraped data without authorization.

| Fixture | Contents | Purpose |
|---|---|---|
| `rec-basic` | Several synthetic apartments with distinct intent, city, price, area, and room counts | Happy-path filtering and ranking |
| `rec-tie` | Equal-score listings with different `lastSeenAt` and IDs | Deterministic tie-breaker |
| `rec-missing` | Missing price, area, room count, or district | Unknown-field behavior; no fabricated match |
| `rec-boundaries` | Minimum/maximum values, zero rooms where schema permits, numeric extremes | Boundary validation |
| `ing-valid` | Valid CSV/JSON rows with required and optional fields | Manual import success |
| `ing-malformed` | Bad encoding, invalid enum, negative area, invalid price, missing required columns, oversized fields | Parser/schema rejection |
| `ing-duplicates` | Same source ID repeated; normalized duplicate; near-match with different area/address | Idempotency and conservative cross-source dedupe |
| `ing-stale` | Old observation, recently observed record, and a withdrawn record | Freshness labels and lifecycle transitions |
| `ing-unsafe` | HTML/script-like descriptions, unexpected columns, oversized row count | Sanitization, allowlist, and limits |
| `auth-permission` | Demo/manual sources and adapter with missing/unapproved permission | Fail-closed authorization gate |
| `privacy-log` | Inputs containing synthetic secret-like tokens and unnecessary personal fields | Redaction and data minimization |

## Test cases

### Recommendation and listing data

| ID | Test | Expected result |
|---|---|---|
| TC-REC-01 | Search with valid intent, city, and budget using `rec-basic`. | Only hard-filter matches are returned; response is schema-valid and paginated. |
| TC-REC-02 | Re-run `rec-tie` repeatedly. | Ordering remains deterministic for equal scores. |
| TC-REC-03 | Rank `rec-missing`. | Missing fields remain unknown and do not earn positive match points. |
| TC-REC-04 | Check each returned score and reason list. | Score is bounded; each reason maps to a documented factor and no unsupported claim appears. **Current:** the API returns stable reason codes (`TRANSACTION_MATCH`, `LOCATION_MATCH`, `NEIGHBORHOOD_MATCH`, `PROPERTY_TYPE_MATCH`, `WITHIN_BUDGET`, `ROOMS_MATCH`, `AREA_MATCH`, `FEATURES_MATCH`, `PREFERENCE_MATCH`, `MISSING_KEY_FIELDS`, `STALE_LISTING`) together with a Persian label for each code. |
| TC-REC-05 | Change one criterion at a time. | Result changes can be explained by that criterion; hard constraints remain enforced. |
| TC-DATA-01 | Read a listing with source observations. | Source attribution and `lastSeenAt` are present where known. |
| TC-DATA-02 | Query a listing older than the configured threshold. | Response marks it stale and client copy avoids claiming current availability. **Current:** stale records are returned with `stale: true`, `freshnessScore` 0, the `STALE_LISTING` reason, and a «قدیمی» badge in both clients. |
| TC-DATA-03 | Import a record with unknown numeric fields. | Unknown stays null/unknown rather than zero. |
| TC-DATA-04 | Withdraw a listing, then import a new authorized observation. | State transition follows the documented lifecycle and retains observation history. |

### Ingestion and deduplication

| ID | Test | Expected result |
|---|---|---|
| TC-ING-01 | Import a valid manual fixture. | Run completes; accepted/rejected/duplicate counts reconcile with input rows. |
| TC-ING-02 | Import malformed, oversized, or unsupported content. | Request is rejected safely; bounded error details identify the row/field without echoing full payloads. |
| TC-ING-03 | Import the same source record twice. | Second run is idempotent; no duplicate canonical record is created. |
| TC-ING-04 | Import cross-source near-matches and a clearly distinct near-match. | Strong matches are linked or queued according to policy; ambiguous records are not silently merged. |
| TC-ING-05 | Cause a failure during persistence. | Transaction/rollback policy prevents a silently partial or inconsistent import; run ends in a visible failure state. |
| TC-ING-06 | Attempt to run an adapter with no approved permission record. | Adapter does not access the source; run fails closed with a sanitized permission error. |
| TC-ING-07 | Retry a failed transient run. | Retry has a distinct run ID and remains safe to repeat. |
| TC-ING-08 | Import `ing-unsafe`. | Unexpected fields are rejected/ignored per schema; rendered text cannot execute HTML/script. |
| TC-ING-09 | Submit a listing URL the user found, then submit it again. | The page is read once, the extracted facts are stored with the source link, the second submission updates the same record instead of creating a duplicate, and a source observation is recorded. |
| TC-ING-10 | Submit a URL on a host outside the allowlist, a non-HTTPS URL, a URL with credentials, and a URL that redirects to another host. | Each attempt is refused with a stable error code and nothing is stored. |
| TC-ING-11 | Withdraw a listing as an operator, then purge it. | The record leaves the active set, an audit row records the action, and a purge removes the record and its observations. |

### API validation, security, and privacy

| ID | Test | Expected result |
|---|---|---|
| TC-API-01 | Send invalid enums, negative ranges, reversed min/max, malformed IDs, huge page size, and unknown sort fields. | Structured `400 VALIDATION_ERROR`; no SQL error or stack trace leaks. |
| TC-API-02 | Request page boundaries and empty results. | Stable schema with correct totals/hasMore and a useful empty state. **Current:** `GET /api/listings` returns `items`, `limit`, `offset`, `count`, `total`, `hasMore`, and `staleCount`; the recommendations response returns `items`, `total`, `limit`, `offset`, and `hasMore`. |
| TC-API-03 | Call unknown routes and missing IDs. | Correct `404` envelope; no internal details. |
| TC-API-04 | Submit invalid JSON/content type and excessive body size. | Structured 4xx response; request is not partially processed. |
| TC-API-05 | Inspect any response and any error envelope. | Every response carries an `X-Request-Id` header and every error envelope carries the same `requestId`, so a user report can be correlated with the server log. |
| TC-SEC-01 | Access admin/import routes without credentials and with insufficient permissions. | `401`/`403`; no protected data or side effect. |
| TC-SEC-02 | Exceed public and admin rate limits. | `429 RATE_LIMITED` with sensible retry guidance; valid traffic recovers after the window. |
| TC-SEC-03 | Submit SQL-like strings and HTML/script payloads in all text fields. | Parameterized queries and output sanitization prevent injection. |
| TC-SEC-04 | Search repository, build output, test logs, and fixtures for secret patterns. | No live credentials or tokens are present. |
| TC-SEC-05 | Inspect logs after failed imports and API errors. | Secrets, full raw rows, and unnecessary personal data are absent. |
| TC-SEC-06 | Exercise retention/deletion workflow. | Applicable listing/observation/import data is deleted or anonymized according to documented policy, with required audit data minimized. **Current:** anonymous preferences expire after 24 hours, the maintenance endpoint removes expired preferences, observations older than 180 days, and stale rate-limit buckets, and an operator can withdraw or purge a single listing. |
| TC-SEC-07 | Test CORS, cookie flags, CSRF (if cookie sessions), and authorization on every write route. | Only configured origins are allowed; browser session controls meet the selected auth design. **Current:** only the two configured Pages origins receive `Access-Control-Allow-Origin`; the import, run-review, maintenance, and listing-removal routes require the admin bearer token; no cookie session exists yet. |

### RTL, accessibility, mobile, and operations

| ID | Test | Expected result |
|---|---|---|
| TC-UI-01 | Open search, result, detail, import, and error states in Persian RTL. | Reading order and alignment are correct; mixed-direction IDs/URLs remain readable. |
| TC-UI-02 | Complete core seeker flows using keyboard only. | All controls are reachable; focus is visible and ordered logically. |
| TC-UI-03 | Review labels, validation feedback, dynamic result counts, and loading changes with a screen reader. | Controls have accessible names; important state changes are announced appropriately. |
| TC-UI-04 | Test zoom/reflow, contrast, touch target size, and long Persian text. | No essential content is clipped; controls remain usable and meet agreed WCAG 2.2 AA checks. |
| TC-UI-05 | Test narrow Android/iOS viewports and tablet/desktop breakpoints. | No horizontal overflow in core flows; forms and listing cards remain usable. |
| TC-UI-06 | Test empty, offline/network failure, timeout, 429, and 500 states. | Persian recovery guidance is shown without exposing technical details. |
| TC-OPS-01 | Run migrations against a clean test D1 and verify schema/indexes/constraints. | Migrations apply in order and can be reproduced. |
| TC-OPS-02 | Build/preview with no production secrets configured. | Build and demo mode work; protected features fail safely when configuration is missing. |
| TC-OPS-03 | Verify Worker routes, bindings, CORS, asset paths, and environment separation. | Preview and production configuration are explicit and consistent. |
| TC-OPS-04 | Simulate D1/API failure and an ingestion timeout. | User-facing errors are bounded; run state and logs make failure diagnosable. |
| TC-OPS-05 | Load-test the representative search fixture and document measured p50/p95/error rate. | Performance target is measured and any gap has a remediation issue before release. **Current:** measured with `backend/scripts/load-test.mjs`; the deployed edge path returned p50 227 ms, p95 655 ms, and a 0 % error rate over 40 requests (concurrency 4), and the local Worker returned p50 51 ms and p95 58 ms over 300 requests. The public rate limit caps a larger deployed sample, so a run against a representative listing volume is still open. |
| TC-OPS-06 | Verify GitHub workflow from a clean checkout. | Lockfile, scripts, migrations, docs, and checks are reproducible; no secret is needed to run CI. |

## Exit criteria

- All Must requirements have passing linked tests or an explicitly approved, documented exception.
- No open critical/high security finding and no unauthorized source adapter enabled.
- Dedupe, staleness, provenance, and import failure cases pass with deterministic fixtures.
- Core RTL/mobile flows and keyboard accessibility pass; manual screen-reader review is recorded.
- Type checks, lint, unit/integration tests, and production build pass using the repository's documented commands.
- Cloudflare preview checks and secret/configuration review pass before any production deployment.
- GitHub readiness review is complete; release/deploy and repository publication require the appropriate explicit authorization and credentials.

## Test reporting template

Record commit/ref, environment, command, pass/fail/skip counts, fixture version, p50/p95 latency where measured, and linked defects. Redact secrets and user data from all attached output. Do not report a test as passed if it was not run.
