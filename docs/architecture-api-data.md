# Architecture, API, and data design

## Architecture overview

The architecture separates the Persian RTL clients, API/application services, persistent data, and ingestion adapters. Cloudflare Workers hosts API logic; D1 stores normalized listings and ingestion runs; static assets are served through Cloudflare. Demo fixtures and manual import are the default sources. Optional external adapters are isolated behind an authorization gate and must comply with each source's terms and access controls.

### Implementation baseline and client integration status

The current backend exposes `GET /health`, `PUT /api/preferences/:id`, `GET /api/listings`, `POST /api/recommendations/:preferenceId`, `POST /api/ingest/manual`, and `POST /api/ingest/demo`. It stores preferences in `user_preferences`, listings in `listings`, rate-limit buckets in `rate_limit_buckets`, and run summaries in `ingestion_runs`. Preference IDs are client-generated UUIDv4 bearer capabilities. `PUT` is insert-only (`ON CONFLICT(id) DO NOTHING`); a reused ID returns `409`, and there is no preference GET route. Anyone who obtains an ID can request recommendations for that preference, so treat the ID as a bearer secret. Because the ID appears in the URL path, request/error logging must be reviewed and redacted; the current generic error logger records the request path. This provides neither account authentication nor ownership and has no TTL/cleanup policy; use only for non-sensitive search sessions, not private saved profiles. The `sources` and `listing_observations` entities below are target-design recommendations for stronger provenance; they are not represented in the initial migration.

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
- Success responses use resource-specific shapes. Errors use `{ "error": { "code": "...", "message": "...", "requestId": "...", "details": [] } }`; details must not disclose secrets or internal stack traces.
- Use stable error codes, not localized message strings, for client branching. User-facing Persian copy belongs in the client.
- Public read endpoints have rate limits. Import and operator endpoints require authentication/authorization and stricter rate limits.
- CORS should allow only configured production origins. Do not use wildcard origins with credentialed requests.
- Use `Cache-Control` deliberately. Search responses with user-specific criteria should not be stored in shared caches unless the cache key and privacy implications are understood.

## Current endpoint contract

| Method and path | Purpose | Input | Success | Main errors |
|---|---|---|---|---|
| `GET /health` | Minimal liveness check | None | `{ status, service }` | `500` on uncaught error |
| `PUT /api/preferences/{id}` | Create anonymous search preferences | UUIDv4 path ID and validated preferences JSON | `{ id, preferences }` | `400 INVALID_ID` or `VALIDATION_ERROR`; `409 PREFERENCE_ID_ALREADY_USED` |
| `GET /api/listings` | Filter active and fresh listings | `q`, `city`, `transactionType`, `propertyType`, `minPrice`, `maxPrice`, `minAreaM2`, `minBedrooms`, `limit`, `offset` | `{ items, limit, offset, count }` | `400 VALIDATION_ERROR`, `429` |
| `POST /api/recommendations/{id}` | Rank fresh listings for saved preferences | Preference ID in path; preferences must exist | `{ items: [{ listing, score, reasons }] }` | `404 PREFERENCES_NOT_FOUND`, `429` |
| `POST /api/ingest/manual` | Import caller-provided listing records | `{ listings: [...] }`, bearer admin token | Import run counts | `400 VALIDATION_ERROR` / `INGEST_FAILED`, `401 UNAUTHORIZED`, `429` |
| `POST /api/ingest/demo` | Import built-in demo fixtures | Bearer admin token | Import run counts | `401 UNAUTHORIZED`, `429` |

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
3. Return stable reason codes and client-localized labels. Example codes: `WITHIN_BUDGET`, `AREA_MATCH`, `ROOMS_MATCH`, `LOCATION_MATCH`, `PREFERENCE_MATCH`, `MISSING_KEY_FIELDS`, `STALE_LISTING`.
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

### `sources` (target design; not in the initial migration)

- `id`, `name`, `kind` (`demo`, `manual`, or `authorized_adapter`), `base_url` nullable, `enabled`, `permission_status`, `permission_reviewed_at`, `permission_notes_reference`.
- Do not store credentials in this table. Keep secrets in Cloudflare secrets/bindings and reference the binding name in deployment documentation only.
- An adapter with missing, expired, or unapproved permission status must fail closed.

### `listing_observations` (target design; not in the initial migration)

- `id`, `listing_id`, `source_id`, `source_record_id` nullable, `observed_at`, `source_updated_at` nullable, `source_url` nullable, `content_hash`, and sanitized normalized fields needed for audit/dedupe.
- Unique constraint on `(source_id, source_record_id)` when `source_record_id` is present; use a safe application strategy where nullable uniqueness differs by database behavior.
- Retention duration and deletion behavior must be documented before production.

### `ingestion_runs` (current table; field names differ from this target summary)

- Current fields include `id`, `adapter`, `status`, `started_at`, `finished_at`, `received_count`, `inserted_count`, `updated_count`, `skipped_count`, and `message`. A future migration may normalize these into `source_id`, `trigger_kind`, and explicit rejected/duplicate counts.
- Never place access tokens, credentials, complete personal records, or unbounded raw payloads in logs/error summaries.

### `import_errors` (optional if row-level errors need persistence)

- `id`, `run_id`, `row_number`, `error_code`, `safe_message`, and a bounded non-sensitive field name. Avoid copying the full row into this table.

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
