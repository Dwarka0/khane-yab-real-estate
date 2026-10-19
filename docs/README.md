# Real-estate recommendation platform — engineering docs

This documentation defines a reviewable baseline for a Persian, right-to-left real-estate recommendation platform built around Cloudflare. It follows the requirements, design, implementation, verification, and maintenance loop described in Roger S. Pressman's software-engineering process.

## Document map

- [Product scope and requirements](requirements.md) — scope, assumptions, risks, user stories, requirements, acceptance criteria, and traceability.
- [Architecture and data/API design](architecture-api-data.md) — decisions, trust boundaries, API contract, and proposed data model.
- [Use-case descriptions](use-cases.md) — trigger, flows, business rules, and acceptance criteria for each use case.
- [System diagrams](diagrams.md) — Mermaid context, use case, activity, class, domain model, sequence, state, component, package, deployment, ERD, data-flow, ingestion, recommendation, and schedule diagrams.
- [Test plan](test-plan.md) — test levels, fixtures, cases, and exit criteria.
- [Review plan](review-plan.md) — review gates and release-readiness checklist.
- [Release report](release-report.md) — the checks that were actually executed, the measured performance, and the accepted risks.

## Status and interpretation

The web and mobile clients follow the implemented recommendation flow: create a preference with `PUT /api/preferences/:id`, then request recommendations with `POST /api/recommendations/:id`; recommendation results use `{ items: [{ listing, score, reasons }] }`. Preference IDs are client-generated UUIDv4 bearer capabilities: creation is insert-only (`ON CONFLICT DO NOTHING`), there is no preference GET route, and reusing an ID returns `409` rather than overwriting it. Anyone who obtains a valid ID can request recommendations for that preference, so treat IDs as bearer secrets and do not share them. Because IDs appear in URL paths, request/error logging must be reviewed and redacted; the current generic error logger records the request path. This is not account authentication or ownership; preferences are non-sensitive search-session data, and there is currently no TTL/cleanup policy. Do not use this model for private saved profiles. The architecture document separates implemented behavior from target-model improvements. No `AGENTS.md` was found during the initial workspace inspection.

## Product principles

1. Use only authorized data access. Default to demo fixtures and explicit manual import. Enable a source adapter only when the operator has documented permission and the source's terms allow the proposed access.
2. Make recommendation reasons understandable: show the factors that influenced a match and distinguish verified facts from imported or user-provided claims.
3. Treat listing information as time-sensitive. Show last-seen/update timestamps, flag stale records, and avoid presenting stale listings as confirmed available.
4. Default to data minimization, secure-by-default access, Persian RTL layout, and mobile usability.
5. Keep provider credentials server-side. Never commit secrets, include them in logs, or expose them to browser/mobile clients.
