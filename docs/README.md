# Real-estate recommendation platform — engineering docs

This documentation defines a reviewable baseline for a Persian, right-to-left real-estate recommendation platform built around Cloudflare. It follows the requirements, design, implementation, verification, and maintenance loop described in Roger S. Pressman's software-engineering process.

## Document map

- [Product scope and requirements](requirements.md) — scope, assumptions, risks, user stories, requirements, acceptance criteria, and traceability.
- [Architecture and data/API design](architecture-api-data.md) — decisions, trust boundaries, API contract, and proposed data model.
- [System diagrams](diagrams.md) — Mermaid context, use case, activity, class, sequence, state, component, deployment, ERD, data-flow, ingestion, and recommendation diagrams.
- [Test plan](test-plan.md) — test levels, fixtures, cases, and exit criteria.
- [Review plan](review-plan.md) — review gates and release-readiness checklist.

## Status and interpretation

The web and mobile clients now follow the implemented recommendation flow: save preferences with `PUT /api/preferences/:id`, then request recommendations with `POST /api/recommendations/:id`; recommendation results use `{ items: [{ listing, score, reasons }] }`. The architecture document records this integrated API contract and distinguishes it from proposed target-model improvements. A remaining security gap is that preference routes do not enforce authentication or ownership, so callers may access or overwrite preferences by identifier; resolve this before exposing private preferences to untrusted clients. No `AGENTS.md` was found during the initial workspace inspection.

## Product principles

1. Use only authorized data access. Default to demo fixtures and explicit manual import. Enable a source adapter only when the operator has documented permission and the source's terms allow the proposed access.
2. Make recommendation reasons understandable: show the factors that influenced a match and distinguish verified facts from imported or user-provided claims.
3. Treat listing information as time-sensitive. Show last-seen/update timestamps, flag stale records, and avoid presenting stale listings as confirmed available.
4. Default to data minimization, secure-by-default access, Persian RTL layout, and mobile usability.
5. Keep provider credentials server-side. Never commit secrets, include them in logs, or expose them to browser/mobile clients.
