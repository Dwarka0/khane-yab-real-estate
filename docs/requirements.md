# Product scope and requirements

## Purpose

Help a person describe a property need, discover relevant real-estate listings, compare matches, and understand why each listing was recommended. The first release is a recommendation and discovery experience, not a brokerage transaction system.

## Scope

### In scope

- Persian RTL responsive web experience, with mobile layouts treated as a first-class use case.
- Search criteria for location, property type, buy/rent intent, price range, area, rooms, and optional preferences.
- Listing details with source attribution, freshness information, and a clear indication of data provenance.
- Explainable ranking based on declared user criteria and available listing fields.
- Demo fixtures and operator-triggered manual import as default ingestion paths.
- Optional source adapters only after source authorization, terms review, and documented operational approval.
- Validation, pagination, rate limits, structured errors, operational logging without sensitive payloads, and administrative review of ingestion runs.

### Out of scope for the initial release

- Bypassing anti-bot controls, authentication walls, paywalls, robots restrictions, or source access limits.
- Scraping sources without permission, automated account creation, or circumventing source-imposed throttles.
- Payments, deposits, contracts, identity verification, mortgage decisions, legal advice, or transaction completion.
- Claims that a property is available, legally compliant, or independently verified unless a defined verification process supports the claim.
- Automated messaging to owners or agents.

## Assumptions

- The user interface and user-facing copy are Persian and use RTL direction by default; numeric identifiers and technical tokens may retain their natural direction.
- Cloudflare Workers provides the API/runtime layer and D1 is the initial relational store. Static web assets can be hosted through Cloudflare; object storage is optional and should be introduced only for a demonstrated need.
- The current API implementation is described in `architecture-api-data.md` and deployed as a Cloudflare Worker. Its public preference IDs still lack authenticated ownership, and the rental price model remains a documented release limitation; the architecture document distinguishes implemented behavior from future production requirements.
- Imported listing data can be incomplete, duplicated, stale, misleading, or malformed.
- Source permissions vary. Each adapter requires a documented authorization record and an explicit enablement decision.
- No production secrets or personal data are required in demo fixtures.

## Stakeholders and user stories

| ID | Actor | User story | Value |
|---|---|---|---|
| US-01 | Property seeker | As a seeker, I want to enter a budget, location, and property needs so I can narrow down relevant listings. | Less manual searching |
| US-02 | Property seeker | As a seeker, I want to see why each listing matches my criteria so I can judge whether it is relevant. | Explainable results |
| US-03 | Property seeker | As a seeker, I want to compare key listing facts and their update times so I can spot incomplete or stale information. | Better-informed decisions |
| US-04 | Property seeker | As a seeker using Persian, I want readable RTL pages and keyboard-accessible controls on mobile and desktop. | Inclusive access |
| US-05 | Operator | As an operator, I want to import a validated file manually so I can add authorized listings without an unapproved crawler. | Controlled ingestion |
| US-06 | Operator | As an operator, I want to inspect ingestion errors and duplicates so I can correct data quality issues. | Maintainable data |
| US-07 | Operator | As an operator, I want source adapters disabled until permission is documented so ingestion stays within approved access. | Reduced compliance risk |
| US-08 | Maintainer | As a maintainer, I want auditable configuration, tests, and deployment instructions so releases can be reviewed and repeated. | Reliable delivery |

## Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | The system shall accept validated search criteria and return paginated listings ranked by relevance. | Must |
| FR-02 | The system shall validate filter ranges, enums, lengths, pagination, and sort options at the API boundary. | Must |
| FR-03 | Each result shall expose source attribution, data provenance, and timestamps for creation/import and last observation. | Must |
| FR-04 | Each result shall expose a human-readable explanation derived from matching criteria and available fields. | Must |
| FR-05 | The system shall distinguish unknown values from zero, false, or empty values. | Must |
| FR-06 | The system shall identify likely duplicate listings and preserve provenance for merged observations. | Must |
| FR-07 | The system shall mark records stale according to a configurable policy and shall not imply that stale data confirms current availability. | Must |
| FR-08 | Manual imports shall validate file type/size/schema, report row-level errors, and avoid partial commits unless explicitly designed as atomic batches. | Must |
| FR-09 | Demo data shall be available without connecting to third-party sources or entering secrets. | Must |
| FR-10 | An ingestion adapter shall be disabled by default and require a documented permission record before activation. | Must |
| FR-11 | Operators shall be able to review ingestion run status, counts, and sanitized errors. | Should |
| FR-12 | The application shall provide accessible loading, empty, validation-error, and service-error states in Persian. | Must |
| FR-13 | The system shall apply rate limits to public endpoints and stricter limits to import/admin operations. | Must |
| FR-14 | The system shall support deletion or correction of records and their associated source observations under a documented retention policy. | Should |

## Nonfunctional requirements

| ID | Requirement | Acceptance target |
|---|---|---|
| NFR-01 | Security | Secrets stay server-side; all write operations validate authorization and input; errors do not expose stack traces or credentials. |
| NFR-02 | Privacy | Collect only data needed for search, ingestion, and operations; avoid storing seeker profiles unless explicitly required. |
| NFR-03 | Performance | For a representative seeded dataset, p95 search API latency target is under 800 ms at the agreed test load; measure on the deployed Cloudflare path before release. |
| NFR-04 | Reliability | Ingestion failures are visible and retry-safe; a failed import cannot silently corrupt existing records. |
| NFR-05 | Freshness | Results expose `lastSeenAt` and a clear stale status based on a documented threshold. |
| NFR-06 | Accessibility | Aim for WCAG 2.2 AA, including keyboard operation, visible focus, sufficient contrast, accessible names, and correct RTL semantics. |
| NFR-07 | Compatibility | Core flows work on current major desktop browsers and common Android/iOS mobile viewport sizes. |
| NFR-08 | Maintainability | API schemas, ranking rules, migration process, and adapter authorization are documented and version-controlled. |
| NFR-09 | Observability | Structured logs and metrics include request/run identifiers and outcomes while excluding secrets and unnecessary personal data. |
| NFR-10 | Cost control | Prefer Cloudflare's free/open-source-compatible components where practical; document expected limits and usage assumptions before production traffic. |

## Acceptance criteria

- A seeker can submit valid criteria and receive stable, paginated results; invalid ranges and unsupported values receive a structured 4xx response.
- Result ordering is deterministic for equal relevance scores, using a documented tie-breaker.
- Every result includes source attribution, `lastSeenAt`, provenance, and a reason list; missing fields are labelled unknown.
- A duplicate fixture does not create a second active canonical listing when the matching rule says it is the same property; both source observations remain traceable.
- A stale fixture is visibly labelled stale and is not described as confirmed available.
- Invalid manual-import rows produce row-level diagnostics; the import result reports accepted, rejected, and duplicate counts.
- An adapter with no recorded authorization cannot run; no adapter attempts to bypass access controls or source throttles.
- Public endpoints and administrative/import endpoints enforce their respective rate limits.
- RTL layout, keyboard navigation, labels, focus states, and error announcements pass the test plan on mobile and desktop.
- A clean checkout can run documented checks and build the application without production credentials; deployment remains a separate authorized operation.

## Principal risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Unauthorized source collection | Legal, contractual, or service-access consequences | Demo/manual import by default; per-source permission record; adapter disabled until approved; periodic review of source terms. |
| Stale or false availability | Users may waste time or make poor decisions | Show observation time and stale status; avoid availability guarantees; provide a report/correction path. |
| Duplicate or conflicting listings | Misleading counts and ranking | Normalize fields, use conservative match signals, retain observations, and require review for ambiguous matches. |
| Sensitive data in imports or logs | Privacy/security incident | Schema allowlist, reject unneeded fields, redact logs, restrict admin routes, and define retention. |
| Unfair or opaque ranking | Users cannot understand recommendations | Publish ranking factors, show reasons, allow criteria changes, and test representative edge cases. |
| Cloudflare service limits or cost growth | Errors or unexpected expense | Set limits, monitor usage, load-test, and document bindings/quotas before production. |
| Mobile/RTL regressions | Reduced usability | Automated viewport checks plus manual keyboard/screen-reader review. |

## Requirements traceability matrix

| Requirement | Design/diagram | Verification |
|---|---|---|
| FR-01, FR-02 | Search API; component and sequence diagrams | TC-API-01 through TC-API-04 |
| FR-03, FR-05, FR-07 | Listing/observation model; state and ERD diagrams | TC-DATA-01 through TC-DATA-04 |
| FR-04 | Recommendation service and scoring contract | TC-REC-01 through TC-REC-05 |
| FR-06 | Dedupe workflow and source observations | TC-ING-03, TC-ING-04 |
| FR-08, FR-09 | Manual import and demo adapter | TC-ING-01, TC-ING-02, TC-ING-05 |
| FR-10, FR-11 | Adapter registry and ingestion run model | TC-SEC-04, TC-ING-06 |
| FR-12, NFR-06, NFR-07 | RTL web/mobile component | TC-UI-01 through TC-UI-06 |
| FR-13, NFR-01 | API boundary and rate limiter | TC-SEC-01 through TC-SEC-05 |
| FR-14, NFR-02 | Retention/deletion policy | TC-SEC-06 |
| NFR-03, NFR-04, NFR-09, NFR-10 | Cloudflare deployment and observability | TC-OPS-01 through TC-OPS-05 |
