# Engineering review and release-readiness plan

## Review approach

Review each change against requirements and the traceability matrix in `requirements.md`. Review source code, configuration, migrations, UI behavior, and operational documentation together when a change crosses boundaries. The review should establish what the application actually does; this document describes intended behavior and must not be treated as implementation evidence.

## Review gates

### 1. Requirements and product behavior

- [ ] Every new feature maps to a user story and one or more requirement IDs.
- [ ] Acceptance criteria are observable and testable.
- [ ] Ranking factors and reason codes are documented and understandable to users.
- [ ] Unknown, stale, withdrawn, and unverified listing facts are represented accurately.
- [ ] No copy implies guaranteed availability, legal verification, or transaction safety without a defined process.

### 2. Source authorization and ingestion

- [ ] Demo fixtures and manual import work without external accounts or secrets.
- [ ] Each enabled external adapter has a source-specific authorization/terms review record, an owner, review date, and allowed access method.
- [ ] Adapter defaults are disabled; missing/expired permission fails closed.
- [ ] Implementation respects robots/access restrictions, authentication, rate limits, and published terms; no anti-bot or access-control bypass exists.
- [ ] Import schema, upload size, row count, field lengths, content type, and encoding are bounded.
- [ ] Deduplication is idempotent and conservative; source observations and provenance survive reconciliation.
- [ ] Partial failure, retry, and rollback behavior is explicit and tested.
- [ ] Logs and run errors are sanitized and do not contain full raw rows, credentials, or unnecessary personal data.

### 3. API and data design

- [ ] Every route validates input at the server boundary and uses parameterized database statements.
- [ ] Pagination, sorting, filter names, and enums are allowlisted and bounded.
- [ ] Response and error envelopes are stable and documented; errors avoid stack traces and internal SQL details.
- [ ] Rate limits cover public search and stricter privileged operations.
- [ ] Authentication and authorization are enforced on every privileged read/write route.
- [ ] If cookie sessions are used, CSRF controls and secure cookie attributes are reviewed.
- [ ] CORS is restricted to intended origins; credentialed wildcard CORS is not used.
- [ ] D1 migrations, indexes, foreign keys, unique constraints, and rollback/recovery approach are reviewed.
- [ ] Freshness threshold, retention, deletion, and observation reconciliation policies are documented.

### 4. Security and privacy

- [ ] No secret values are committed, bundled into client assets, printed to logs, or copied into screenshots/test fixtures.
- [ ] Cloudflare secrets are configured by binding name and environment; local examples contain placeholders only.
- [ ] Imported text is safely rendered and unexpected columns are rejected or discarded according to an explicit allowlist.
- [ ] Data minimization and retention are documented; no unnecessary seeker profile or contact data is collected.
- [ ] Dependency changes are reviewed; build output and dependency audit results are checked where tooling supports them.
- [ ] Error messages and health endpoints do not disclose internal configuration.

### 5. Persian RTL, accessibility, and mobile

- [ ] Document language and direction are set correctly; nested LTR tokens use direction-aware presentation.
- [ ] Search forms, listing cards, details, dialogs, toasts, tables, and errors follow a logical RTL reading order.
- [ ] All core actions work without a pointer; focus is visible and not trapped unexpectedly.
- [ ] Inputs have persistent labels; validation errors are associated with controls and announced.
- [ ] Color is not the only carrier of meaning; contrast, zoom, reflow, and touch targets are checked.
- [ ] Long Persian text, mixed numerals, URLs, prices, and empty values are tested.
- [ ] Narrow mobile viewports have no blocking horizontal overflow; network errors and slow loading have usable states.
- [ ] Manual screen-reader review and supported-browser/viewport results are recorded.

### 6. Cloudflare operations

- [ ] Worker entry points, routes, environment bindings, D1 binding, asset binding, and migrations match the intended environment.
- [ ] Preview and production configuration are separate; no development secret is reused blindly in production.
- [ ] Limits, timeout behavior, scheduled tasks (if any), and expected D1 usage are documented.
- [ ] Logs include useful run/request IDs and sanitized failure categories.
- [ ] Backups/export and restore procedure are documented and have been rehearsed where supported.
- [ ] Smoke checks cover health, search, listing detail, rate limiting, and authorized import behavior.
- [ ] A rollback/mitigation plan exists for schema or ranking changes.

### 7. GitHub readiness

- [ ] Repository includes a useful README, supported runtime versions, lockfile, setup instructions, and documented commands.
- [ ] `.gitignore` excludes local environment files, credentials, generated artifacts, and local database files as appropriate.
- [ ] `.env.example` lists variable names and safe placeholders only; no actual secrets.
- [ ] CI runs lint, type checks, tests, migration/schema checks, and a production build without production credentials.
- [ ] Tests use synthetic fixtures and do not depend on unauthorized or unstable external sites.
- [ ] Documentation diagrams and traceability references agree with the implemented API and schema.
- [ ] No unrelated user files or local-only artifacts are included in the change.
- [ ] License, dependency notices, and source-adapter permissions are reviewed before public publication.
- [ ] The final diff has been inspected for accidental secrets, unrelated changes, and generated noise.

## Severity and disposition

- **Blocker:** unauthorized access/bypass, exposed secret, data corruption, broken authentication, or a release-blocking privacy issue. Do not release until fixed.
- **High:** core search/import behavior is incorrect, stale information is misleading, or critical accessibility/use flow fails. Fix before release unless an accountable owner documents an exceptional decision.
- **Medium:** significant usability, maintainability, observability, or performance gap. Fix before release when it affects acceptance criteria; otherwise record an owner and target release.
- **Low:** cosmetic or minor documentation issue with no material effect on acceptance. Track for follow-up.

## Review record template

```text
Change / commit:
Reviewer and date:
Requirements covered:
Tests and commands run:
Source authorization checked (if applicable):
Security/privacy findings:
RTL/accessibility/mobile findings:
Cloudflare/GitHub readiness findings:
Decision: approve / changes requested / blocked
Follow-up issues and owners:
```

## Release decision

Release approval requires passing Must acceptance criteria, completion of the test-plan exit criteria, no open blocker/high security or privacy finding, and explicit confirmation that every enabled source adapter is authorized. Production deployment and public repository publication remain separate actions that require their own appropriate authorization and credentials.
