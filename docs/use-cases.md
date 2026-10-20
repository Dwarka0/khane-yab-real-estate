# Use-case descriptions

Each use case follows the Pressman format: actors, trigger, preconditions, a main success flow with numbered steps, alternate and exception flows, postconditions, business rules, and the acceptance criteria that verify it. The IDs are referenced from the test plan.

## UC-1 — Search and rank listings for a need

- **Primary actor:** property seeker · **Supporting actors:** none · **Stakeholders:** seeker, operator
- **Trigger:** the seeker submits the search form.
- **Preconditions:** the API is reachable; the client holds an unused UUIDv4 capability.
- **Priority:** high · **Frequency:** per search

**Main success flow**

1. The client generates a UUIDv4 capability and sends `PUT /api/preferences/:id` with the validated criteria.
2. The API inserts the preference (insert-only) and returns the stored criteria and the expiry stamp.
3. The client sends `POST /api/recommendations/:id`.
4. The API loads the preference, selects active listings of the requested transaction type, and drops records that are not fresh.
5. The API removes every listing that violates a hard constraint (transaction type, city, budget range, property type, minimum bedrooms, minimum area, neighborhood, required features, avoided terms).
6. The API scores the remaining listings over the dimensions the seeker actually supplied and attaches the matching reasons.
7. The API sorts by score, then freshness, then listing id, and returns the page with `total` and `hasMore`.
8. The client renders each card with the match percentage, the reasons, the source, and a link to the original listing.

**Alternate flows**

- 4a. The capability was already used → the API answers `409 PREFERENCE_ID_ALREADY_USED` and the client starts a new search.
- 4b. The capability is not a UUIDv4 → `400 INVALID_ID`.
- 5a. A listing has an unknown field (price, area, or rooms) → it does not earn positive match points and is not treated as a match.
- 7a. No listing satisfies the criteria → the client shows the empty state with a suggestion to broaden the filters.

**Postconditions:** a preference row exists that expires after `PREFERENCE_TTL_HOURS`; no listing is modified.

**Business rules:** the score is normalized to 0–100 over the supplied dimensions only; a score is never a probability of suitability; unknown is never rendered as zero.

**Acceptance criteria:** TC-REC-01, TC-REC-02, TC-REC-03, TC-REC-04, TC-REC-05, TC-API-01, TC-API-02, TC-API-03.

## UC-2 — Submit a listing link

- **Primary actor:** property seeker · **Supporting actors:** the public listing site · **Stakeholders:** seeker, operator, source owner
- **Trigger:** the seeker pastes a listing URL into the link panel.
- **Preconditions:** the source is registered, enabled, and approved; the host is inside the source allowlist.
- **Priority:** high · **Frequency:** per shared listing

**Main success flow**

1. The client sends `POST /api/listings/import-link` with the URL.
2. The API checks the permission gate; a source that is missing, disabled, or unapproved is refused with `403`.
3. The API validates the URL: `https` only, no credentials, port 443 only, no literal IP host, and the host must be inside the allowlist.
4. The API fetches the single page without cookies, with an 8 second timeout and a 512 KiB body cap, following at most three redirects that must stay inside the allowlist.
5. The API reads the structured data (`schema.org` JSON-LD `Offer`), then OpenGraph metadata, then plain-text heuristics.
6. The API normalizes the facts, computes the content hash, upserts the listing, records a `listing_observation`, and closes an `ingestion_run`.
7. The client refreshes the search results and shows the imported listing with its source and its original link.

**Alternate flows**

- 2a. Permission is missing → `403` with a stable code, nothing is stored.
- 3a. The URL is invalid or the host is not allowed → `400 INVALID_SOURCE_URL`.
- 4a. The page redirects to a host outside the allowlist → `502 SOURCE_FETCH_FAILED`.
- 4b. The page is larger than the cap or times out → `502 SOURCE_FETCH_FAILED`.
- 5a. No title can be established → `422 LISTING_EXTRACT_FAILED`.
- 5b. The listing was already imported → the existing record is updated, no duplicate is created.

**Postconditions:** one listing and one observation exist; the run shows the accepted count.

**Business rules:** the platform reads only a page the user pointed at and never crawls a source; the original URL is always kept so the seeker reaches the source listing; every stored field must be justified by the source page; the source owner is credited on the card.

**Acceptance criteria:** TC-ING-02, TC-ING-03, TC-ING-04, TC-SEC-02, TC-SEC-03, TC-SEC-07.

## UC-3 — Import listings manually

- **Primary actor:** operator · **Supporting actors:** none
- **Trigger:** the operator posts a validated JSON payload.
- **Preconditions:** `ADMIN_INGEST_TOKEN` is configured; the manual source is enabled and approved.
- **Priority:** medium · **Frequency:** occasional

**Main success flow**

1. The operator sends `POST /api/ingest/manual` with the bearer token and up to 100 listings.
2. The API validates the body size, the record count, and every field against the listing schema.
3. The API rejects in-batch duplicates before writing, so one bad row cannot roll back the whole import.
4. The API writes the accepted rows and the row-level diagnostics in one transactional batch and closes the run as `completed`.

**Alternate flows**

- 1a. The token is missing or wrong → `401 UNAUTHORIZED`.
- 2a. The body exceeds 1 MiB or 100 rows → `413` or `400`.
- 2b. A row fails validation → the row is skipped, an `import_errors` entry records the field names only, and the count is reported.
- 4a. The batch fails → the run is marked `failed` with a sanitized message and no listing change survives.

**Postconditions:** the run row and its diagnostics are readable through `GET /api/ingest/runs/:id`.

**Business rules:** the operator confirms the right to use each record; a full row is never copied into the diagnostics.

**Acceptance criteria:** TC-ING-01, TC-ING-02, TC-ING-05, TC-ING-07, TC-SEC-01, TC-SEC-05.

## UC-4 — Review ingestion runs

- **Primary actor:** operator
- **Trigger:** the operator opens the run list or a run detail.
- **Preconditions:** `ADMIN_INGEST_TOKEN` is configured.
- **Priority:** medium · **Frequency:** after every import

**Main success flow**

1. The operator sends `GET /api/ingest/runs` with the bearer token.
2. The API returns the recent runs with adapter, timestamps, counts, status, and the sanitized message.
3. The operator opens `GET /api/ingest/runs/:id`.
4. The API returns the run and its row-level diagnostics (row number, error code, safe message).

**Alternate flows:** 1a. The token is missing → `401`; 3a. The run does not exist → `404 RUN_NOT_FOUND`.

**Acceptance criteria:** TC-ING-06, TC-ING-07, TC-SEC-05.

## UC-5 — Authorize or disable a data source

- **Primary actor:** operator · **Supporting actor:** the source owner
- **Trigger:** a new source is proposed, or a permission record changes.
- **Preconditions:** the operator has D1 access and a written permission record for the source.
- **Priority:** high · **Frequency:** rarely

**Main success flow**

1. The operator records the source in `sources` with its kind, allowed host, and the permission review outcome.
2. The operator sets `enabled = 1` only after the permission status is `approved`.
3. The API exposes the source through `GET /api/sources`.
4. Every ingestion path consults the registry before touching data and fails closed otherwise.

**Alternate flows:** 2a. The permission is missing, expired, or rejected → the source stays disabled and every ingestion path answers `403`.

**Business rules:** no credential is stored in the registry; secrets stay in Cloudflare bindings; the permission record is reviewed on a fixed cadence.

**Acceptance criteria:** TC-ING-06, TC-SEC-04.

## UC-7 — Search the sources and answer from a short lived cache

- **Primary actor:** the platform (scheduled job) · **Supporting actor:** the source's public category page · **Stakeholders:** seeker, operator, source owner
- **Trigger:** the cron schedule fires (every six hours) or an operator calls `POST /api/collect`.
- **Preconditions:** the collector source is registered, enabled, and approved; the pages to read are declared in `source_pages`.
- **Priority:** high · **Frequency:** six times a day

**Main success flow**

1. The scheduler calls the collector.
2. The collector checks the permission gate; a source that is missing, disabled, or unapproved refuses to run.
3. The collector reads the enabled pages one by one, one request per page, with a 2 MiB budget, an 8 second timeout, no cookies, and no redirect outside the allowlist.
4. The collector extracts the listings the page publishes: title, price, monthly rent, deposit, area, rooms, city, neighbourhood, amenities, and the link to the original listing.
5. A page may restrict the result to categories (`category_filter`), so a general city page contributes only property listings.
6. Each listing is stored once: an existing listing is updated and a new one is inserted, and every sighting is recorded as an observation.
7. The collector records the outcome of the page in `source_pages` and closes the ingestion run.

**Alternate flows**

- 2a. The permission is missing → the run fails closed and nothing is fetched.
- 3a. The page cannot be read, is too large, or times out → the page is marked with the error, the other pages continue, and no listing is touched.
- 4a. A listing states no price → the price stays unknown; the listing is not a budget mismatch and never earns the budget point.

**Postconditions:** the listings table holds the collected listings with their source links; the run history records what was inserted and updated.

**Business rules:** the collector reads only the declared pages, follows the sources' `robots.txt`, keeps a low request rate, uses no account, bypasses no access control, stores only the fields needed for matching, and always links the user back to the source listing.

**Acceptance criteria:** TC-ING-09, TC-ING-10, TC-SEC-07.

## UC-6 — Run maintenance cleanup

- **Primary actor:** operator
- **Trigger:** a scheduled or manual cleanup run.
- **Preconditions:** `ADMIN_INGEST_TOKEN` is configured.
- **Priority:** medium · **Frequency:** daily

**Main success flow**

1. The operator sends `POST /api/maintenance/cleanup`.
2. The API deletes expired preference rows, observations older than 180 days, and rate-limit buckets older than one hour.
3. The API reports the number of deleted rows per category.

**Postconditions:** expired anonymous search sessions are gone; historical provenance inside the retention window survives.

**Acceptance criteria:** TC-SEC-06.
