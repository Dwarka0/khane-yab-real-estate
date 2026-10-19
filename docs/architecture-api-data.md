# Architecture, API, and data design

## Architecture overview

The architecture separates the Persian RTL clients, API/application services, persistent data, and ingestion adapters. Cloudflare Workers hosts API logic; D1 stores normalized listings and ingestion runs; static assets are served through Cloudflare. Demo fixtures and manual import are the default sources. Optional external adapters are isolated behind an authorization gate and must comply with each source's terms and access controls.

### Implementation baseline and client integration status

The current backend exposes `GET /health`, `GET /api/sources`, `GET /api/sources/:id/permission`, `PUT /api/preferences/:id`, `GET /api/listings`, `POST /api/recommendations/:preferenceId`, `POST /api/listings/import-link`, `POST /api/ingest/manual`, `POST /api/ingest/demo`, `GET /api/ingest/runs`, `GET /api/ingest/runs/:id`, and `POST /api/maintenance/cleanup`. It stores preferences in `user_preferences`, listings in `listings`, source observations in `listing_observations`, ingestion summaries in `ingestion_runs`, row diagnostics in `import_errors`, the source registry in `sources`, and rate-limit buckets in `rate_limit_buckets`. Preference IDs are client-generated UUIDv4 bearer capabilities. `PUT` is insert-only (`ON CONFLICT(id) DO NOTHING`); a reused ID returns `409`, and there is no preference GET route. Anyone who obtains an ID can request recommendations for that preference, so treat the ID as a bearer secret. Because the ID appears in the URL path, request/error logging must be reviewed and redacted; the current generic error logger records the request path. This provides neither account authentication nor ownership. Preferences now carry an `expires_at` stamp (`PREFERENCE_TTL_HOURS`, default 24) and the maintenance endpoint removes expired rows, but there is still no account model; use only for non-sensitive search sessions, not private saved profiles.

The `sources` registry, `listing_observations`, and `import_errors` tables described below are now implemented by migration `0005_sources_observations.sql`.

The web and mobile clients are now aligned with the backend recommendation flow: save preferences with `PUT /api/preferences/:id`, then call `POST /api/recommendations/:id` using that preference ID. The recommendation response is `{ "items": [{ "listing": ..., "score": ..., "reasons": [...] }] }`. This closes the previously documented client/backend route-shape mismatch. Keep a contract test covering both steps and the response envelope so future client or backend changes do not silently diverge.

## Architecture decisions

| ID | Decision | Rationale | Consequence / revisit when |
|---|---|---|---|
| ADR-001 | Use Cloudflare Workers for the API boundary. | Fits an edge-hosted, modest-operations deployment. | Confirm CPU/runtime limits and bindings with representative load tests. |
| ADR-002 | Use D1 for initial relational storage. | Listings, observations, imports, and runs have relational links and transactional needs. | Reassess if measured volume or query patterns exceed practical D1 limits. |
| ADR-003 | Keep ingestion behind a common adapter interface. | Makes demo/manual import and future authorized sources testable in isolation. | Each new adapter requires source-specific permission and failure-mode review. |
| ADR-004 | Default to demo fixtures and manual import. | Keeps the system usable without external access and reduces source-access risk. | Do not enable external ingestion without written authorization and terms review. |
| ADR-005 | Store source observations separately from canonical listings. | Supports provenance, dedupe, corrections, and auditability. | Additional storage is justified by traceability; define retention and cleanup. |
| ADR-006 | Use deterministic, explainable ranking. | Users can understand and reproduce why a result appears. | Tune weights only with documented criteria and regression fixtures. |
| ADR-007 | Keep secrets and privileged operations on the server. | Prevents browser/mobile clients from exposing credentials or bypassing controls. | Admin authentication mechanism must be selected and reviewed before production. |
| ADR-008 | Make RTL and accessibility acceptance criteria part of the release gate. | Persian is the primary experience and layout errors affect core use. | Automated checks require manual assistive-technology validation as well. |

## Proposed service boundaries

- **Client:** submits criteria, renders cards/details/reasons, and handles loading/error/empty states. It never contains provider secrets.
- **API router:** validates request shape, applies rate limits, returns versioned response envelopes, and maps errors to stable codes.
- **Listing service:** queries canonical listings and source observations, applies visibility/freshness rules, and provides detail views.
- **Recommendation service:** filters hard constraints, computes deterministic soft-match scores, and emits reason codes with each score.
- **Ingestion coordinator:** validates an import, checks adapter authorization, creates a run record, normalizes input, deduplicates, upserts data, and reports counts.
- **Adapter interface:** returns normalized candidate records plus source identifiers and observation metadata. Adapter implementations must obey source permissions and access limits.
- **Repository layer:** owns D1 queries and transaction boundaries; clients/services do not build arbitrary SQL from request values.
- **Operations layer:** records run status, metrics, and sanitized errors; secrets and full raw imported payloads are excluded from logs.

## API conventions

- Current API paths are unversioned (`/api/...`); introduce `/api/v1` only as a deliberate migration rather than assuming it already exists.
- JSON UTF-8; use ISO 8601 timestamps in UTC with a `Z` suffix.
- Validate all inputs on the server. Apply explicit maximum lengths, enum allowlists, numeric bounds, and bounded pagination.
- Success responses use resource-specific shapes. Errors use `{ "error": { "code": "...", "message": "...", "requestId": "...", "details": [] } }`; details must not disclose secrets or internal stack traces. Every response also carries an `X-Request-Id` header with the same value, so a user report can be correlated with the server log.
- Use stable error codes, not localized message strings, for client branching. User-facing Persian copy belongs in the client.
- Public read endpoints have rate limits. Import and operator endpoints require authentication/authorization and stricter rate limits.
- CORS should allow only configured production origins. Do not use wildcard origins with credentialed requests.
- Use `Cache-Control` deliberately. Search responses with user-specific criteria should not be stored in shared caches unless the cache key and privacy implications are understood.

## Current endpoint contract

| Method and path | Purpose | Input | Success | Main errors |
|---|---|---|---|---|
| `GET /health` | Minimal liveness check | None | `{ status, service }` | `500` on uncaught error |
| `GET /api/sources` | Approved and enabled data sources | None | `{ items: [{ id, name, kind }] }` | `429` |
| `GET /api/sources/:id/permission` | Authorization state of one source | Source id in path | `{ allowed, source }` | `429` |
| `PUT /api/preferences/{id}` | Create anonymous search preferences | UUIDv4 path ID and validated preferences JSON | `{ id, preferences, expiresAt }` | `400 INVALID_ID` or `VALIDATION_ERROR`; `409 PREFERENCE_ID_ALREADY_USED` |
| `GET /api/listings` | Filter active listings | `q`, `city`, `transactionType`, `propertyType`, `minPrice`, `maxPrice`, `minAreaM2`, `minBedrooms`, `limit`, `offset` | `{ items, limit, offset, count, staleCount, total, hasMore }` | `400 VALIDATION_ERROR`, `429` |
| `POST /api/recommendations/{id}` | Rank listings for saved preferences | Preference ID in path; preferences must exist | `{ items: [{ listing, score, reasons, reasonLabels, freshness }], total, limit, offset, hasMore }` | `404 PREFERENCES_NOT_FOUND`, `429` |
| `DELETE /api/listings/{id}` | Withdraw or purge a listing | Admin token; `?purge=true` deletes the record and its observations | `{ id, action, reason, runId }` | `401 UNAUTHORIZED`, `404 LISTING_NOT_FOUND` |
| `POST /api/listings/import-link` | Import one listing page the user submitted | `{ url }` | `201` created / `200` updated with `{ listing, created, source }` | `400 VALIDATION_ERROR` or `INVALID_SOURCE_URL`; `403` permission gate; `413` body limit; `422 LISTING_EXTRACT_FAILED`; `429`; `502 SOURCE_FETCH_FAILED` |
| `POST /api/ingest/manual` | Import caller-provided listing records | `{ listings: [...] }`, bearer admin token | Import run counts | `400 VALIDATION_ERROR` / `INGEST_FAILED`, `401 UNAUTHORIZED`, `403` permission gate, `429` |
| `POST /api/ingest/demo` | Import built-in demo fixtures | Bearer admin token | Import run counts | `401 UNAUTHORIZED`, `403` permission gate, `429` |
| `GET /api/ingest/runs` | Recent ingestion runs | Admin token | `{ items: [...] }` | `401 UNAUTHORIZED`, `429` |
| `GET /api/ingest/runs/{id}` | One run with row-level diagnostics | Admin token, run id | `{ run, errors: [{ rowNumber, code, message }] }` | `401 UNAUTHORIZED`, `404 RUN_NOT_FOUND` |
| `POST /api/maintenance/cleanup` | Remove expired preferences, old observations, stale buckets | Admin token | `{ deletedPreferences, deletedObservations, deletedRateLimitBuckets }` | `401 UNAUTHORIZED` |

The current import endpoints are privileged operations protected by `ADMIN_INGEST_TOKEN` using a bearer header. Request bodies have route-specific limits and rate-limit buckets are incremented atomically, but stricter admin-specific rate limits and a sanitized audit policy remain future work. Preference IDs are UUIDv4 capabilities, inserts are immutable, and the direct preference-read route is absent. This is not user authentication: use the capability flow only for non-sensitive, short-lived search sessions. Add authenticated identity/ownership enforcement before introducing accounts or private saved profiles.

### Recommendation response example

```json
{
  "items": [
    {
      "listing": { "id": "lst_demo_001" },
      "score": 91,
      "reasons": ["AREA_MATCH", "ROOMS_MATCH", "WITHIN_BUDGET"]
    }
  ]
}
```

The listing object above is abbreviated for illustration. `score` and `reasons` belong to the recommendation result wrapper; listing-specific fields belong inside `listing`.

## Search request example

```http
GET /api/listings?transactionType=rent&city=تهران&minPrice=80000000&maxPrice=180000000&limit=20&offset=0
```

The current search response is `{ "items": [...], "limit": 20, "offset": 0, "count": 1 }`. The following item is an illustrative target shape, not a byte-for-byte description of the current SQL row mapping:

```json
{
  "items": [
    {
      "id": "lst_demo_001",
      "transactionType": "rent",
      "propertyType": "apartment",
      "city": "tehran",
      "areaSqm": 78,
      "rooms": 2,
      "price": { "rent": 120000000, "deposit": 500000000, "currency": "TOMAN" },
      "score": 91,
      "reasons": ["AREA_MATCH", "ROOMS_MATCH", "WITHIN_BUDGET"],
      "freshness": "current",
      "lastSeenAt": "2026-10-18T09:00:00Z",
      "source": { "name": "Demo fixture", "url": null, "kind": "demo" },
      "provenance": "demo"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "hasMore": false
}
```

The API retains the legacy integer `price` field for compatibility and now also exposes nullable `salePrice`, `monthlyRent`, and `deposit` fields. Migration `0004_separate_rental_prices.sql` backfills existing sale rows into `sale_price` and rent rows into `monthly_rent`; it cannot infer historical deposits, so those remain unknown. For new imports, provide `salePrice` for sales and `monthlyRent` plus `deposit` when known for rentals. All amounts are integer tomans; never silently convert currencies or infer a missing deposit.

## Ranking contract

1. Apply hard filters first: intent, allowed property type, city/area constraints, and explicit minimum/maximum limits.
2. Compute a bounded score from only fields available for that listing. Missing values contribute no positive match and are labelled unknown; they must not be treated as a match.
3. Return stable reason codes and client-localized labels. The implemented codes are `TRANSACTION_MATCH`, `LOCATION_MATCH`, `NEIGHBORHOOD_MATCH`, `PROPERTY_TYPE_MATCH`, `WITHIN_BUDGET`, `ROOMS_MATCH`, `AREA_MATCH`, `FEATURES_MATCH`, `PREFERENCE_MATCH`, `MISSING_KEY_FIELDS`, and `STALE_LISTING`. The API returns the codes together with a Persian label for each, and the clients keep their own map so the wording can change without a backend release.
4. Apply a deterministic tie-breaker such as `score DESC`, `lastSeenAt DESC`, then canonical `id ASC`.
5. Never present score as a probability of suitability or a guarantee. Expose the main matching factors and allow users to revise criteria.
6. Keep ranking weights in one documented configuration and cover them with fixed fixtures. Changes to weights require regression tests and a review note.

## Data model

### `listings` — canonical current view

- `id` text primary key; opaque and stable.
- `intent` enum: `buy` or `rent`.
- `property_type` enum, `city` and optional `district`/`address_public`.
- `area_sqm` nullable numeric; `rooms` nullable integer; `floor` nullable integer.
- `sale_price` nullable integer; `rent_price` nullable integer; `deposit_price` nullable integer; `currency` enum/configured code.
- `description` nullable sanitized text; `availability_status` enum such as `unknown`, `listed`, `withdrawn` (not a guarantee of real-world availability).
- `first_seen_at`, `last_seen_at`, `updated_at`, `freshness_status`.
- `canonical_fingerprint` indexed for candidate duplicate lookup; not a sole identity proof.
- `created_at`, `updated_at`, `deleted_at` for controlled lifecycle management.

### `sources` (implemented in migration 0005)

- `id`, `name`, `kind` (`demo`, `manual`, `user_link`, `authorized_adapter`), `base_url` nullable, `allowed_host` nullable, `enabled`, `permission_status` (`unreviewed`, `approved`, `rejected`, `expired`), `permission_reviewed_at`, `permission_notes`.
- No credentials are stored in this table. Secrets stay in Cloudflare secrets/bindings and the binding name appears only in deployment documentation.
- The permission gate fails closed: a source that is missing, disabled, or not `approved` refuses every ingestion path with `403`.

### `listing_observations` (implemented in migration 0005)

- `id`, `listing_id` (foreign key to `listings`, cascade delete), `source_id` (foreign key to `sources`), `source_record_id` nullable, `source_url` nullable, `content_hash`, `observed_at`.
- Unique constraint on `(source_id, source_record_id)`; every sighting of a listing is recorded so provenance survives reconciliation.
- Retention and deletion behaviour is implemented through `POST /api/maintenance/cleanup`, which removes observations older than 180 days.

### `ingestion_runs` (current table; field names differ from this target summary)

- Current fields include `id`, `adapter`, `status`, `started_at`, `finished_at`, `received_count`, `inserted_count`, `updated_count`, `skipped_count`, and `message`. A future migration may normalize these into `source_id`, `trigger_kind`, and explicit rejected/duplicate counts.
- Never place access tokens, credentials, complete personal records, or unbounded raw payloads in logs/error summaries.

### `import_errors` (implemented in migration 0005)

- `id`, `run_id` (foreign key to `ingestion_runs`, cascade delete), `row_number` nullable, `error_code`, `safe_message`.
- Only field names and a bounded message are stored; the full imported row is never copied into this table.

## User-submitted listing links

The platform never crawls a source. The user pastes one public listing URL, and the worker reads that single page:

1. The `sources` registry is consulted; the source must be enabled and approved, and the host must be inside its allowlist.
2. The URL must use `https`, carry no credentials, use port 443, and must not be an IP literal.
3. Redirects are followed manually for at most three hops and any redirect to a host outside the allowlist is refused.
4. The response must be `text/html`; the body is read with a 512 KiB cap and an 8 second timeout, without cookies.
5. Structured data is read first (`schema.org` JSON-LD `Offer`), then OpenGraph metadata, then plain-text heuristics for price, area, and rooms. Rentals publish the monthly rent and the refundable deposit as separate price components.
6. The extracted facts are validated against the listing schema, normalized, hashed, upserted, and recorded as a `listing_observation` together with an `ingestion_run`.
7. Fields that could not be established stay unknown; the original URL is always stored so the user reaches the source listing.

The route has its own hourly budget (`LINK_IMPORT_PER_HOUR`, default 20) on top of the per-minute limit.

## Deduplication and freshness rules

- Normalize safe comparison fields (whitespace, known enum forms, area and price units) before calculating candidate fingerprints.
- Use source identity first when available. For cross-source matching, combine several independent signals such as normalized location, area, room count, and price. Do not merge solely because descriptions or prices match.
- Ambiguous candidates remain separate or enter an operator review queue; record the reason for the decision.
- Preserve source observations even when canonical listing fields are updated. Track the source and timestamp for field changes where practical.
- `lastSeenAt` is the last successful observation by an enabled source, not proof that the listing is still available.
- The implemented backend currently defaults to a configurable 90-day freshness threshold. The target design suggests evaluating a shorter threshold (for example, 7 days) against each source's observation cadence before production. The UI must state the active threshold policy and distinguish stale from withdrawn.
- Retried ingestion must be idempotent for the same source record and content hash.

## Security and privacy controls

- Use Cloudflare secret bindings for credentials; never include secret values in `.env` examples, source, screenshots, or test fixtures.
- Validate file type by content and schema, enforce upload/row limits, and reject unexpected fields. Sanitize rendered imported text against script/HTML injection.
- Authenticate and authorize every privileged route; enforce CSRF defenses for cookie-based sessions and safe cookie flags.
- Use prepared/parameterized database statements; constrain sort/filter names to allowlists.
- Add per-IP and, where appropriate, per-account rate limits; do not rely on client-side throttling.
- Keep logs structured and redacted. Define retention and deletion rules for imports, observations, audit records, and user-submitted criteria.
- Restrict CORS to configured origins; use HTTPS; review dependency updates and Cloudflare binding permissions.
