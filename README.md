# خانه‌یاب | Real Estate Recommendation Platform

A Persian, right-to-left property discovery and recommendation platform designed for Cloudflare Workers and D1, with a responsive web client and an Expo mobile client. The engineering process and UML deliverables follow the analysis, design, implementation, verification, and maintenance workflow described in Roger S. Pressman's *Software Engineering: A Practitioner's Approach*.

## Current integration status

- `backend/`: Cloudflare Worker API, D1 schema, listing normalization, a source registry with a fail-closed permission gate, provenance observations, and explainable recommendations (see `backend/README.md`).
- `web-mobile/web/`: responsive Persian RTL web interface, including a panel for submitting a listing link.
- `web-mobile/mobile/`: Expo/React Native mobile application source, including the same link-submission panel. The same source builds an installable web app that is published on Cloudflare Pages.
- `docs/`: requirements, traceability, architecture, use-case descriptions, UML/data-flow/schedule diagrams, and verification plans.
- Public source repository: [github.com/Dwarka0/khane-yab-real-estate](https://github.com/Dwarka0/khane-yab-real-estate) (MIT licence).

## Deployed web and API

- Web app: [https://khane-yab-web.pages.dev](https://khane-yab-web.pages.dev)
- Mobile app (installable web build): [https://khane-yab-mobile.pages.dev](https://khane-yab-mobile.pages.dev)
- API health: [https://real-estate-platform-api.m-abner-9907.workers.dev/health](https://real-estate-platform-api.m-abner-9907.workers.dev/health)
- API data: Cloudflare D1 database `khane-yab-platform`; migrations `0001_initial.sql` through `0005_sources_observations.sql` are applied remotely.

The web app and API have been deployed and smoke-tested. Demo listings are seeded and clearly marked as demo data. A live end-to-end check imported a real listing page through `POST /api/listings/import-link` and returned it as a ranked recommendation with its reasons and its original link.

### How real listings enter the platform

1. **User-submitted link (default).** The user pastes one public listing URL from Divar or Sheypoor. The worker reads that single page, extracts the structured data (`schema.org` JSON-LD `Offer`: price, monthly rent, deposit, area, rooms, location, amenities), stores the minimum fields needed for matching, records the observation, and always links back to the original listing. The worker never crawls a source and never uses an account.
2. **Operator import.** `POST /api/ingest/manual` accepts up to 100 authorized records with a bearer token, validates every field, reports row-level diagnostics, and commits transactionally.
3. **Demo fixtures.** Synthetic records for a fresh deployment.

Every source must be registered in the `sources` table with an approved permission record, and the gate fails closed: a source that is missing, disabled, or unapproved refuses every ingestion path.

Listings from Divar and Sheypoor must only be imported through an official API, an explicitly authorized integration, or user-provided data that the user is entitled to use. The project includes demo data and manual import as a safe starting path; it does not bypass access controls or claim that a listing is still available. Each result shows its source and freshness/verification status.

## Local development

Follow the README in each subproject. Typical setup:

1. Install a current Node.js LTS release.
2. In `backend/`, install dependencies, apply the D1 migrations locally, then run the Worker dev server.
3. In `web-mobile/web/`, install dependencies, copy `.env.example` to `.env.local`, set `VITE_API_BASE_URL`, and run the Vite dev server.
4. In `web-mobile/mobile/`, install dependencies, copy `.env.example` to `.env`, set `EXPO_PUBLIC_API_BASE_URL`, and start Expo.

Never commit API keys, Cloudflare credentials, `.dev.vars`, signing keys, or production user data. The root project is not considered deployed or published until the relevant deployment/push has actually succeeded.

## Cloudflare deployment

The live target uses Cloudflare Pages for `web-mobile/web/` and a separate Worker/D1 API. See `backend/README.md`, `web-mobile/web/README.md`, and `docs/architecture-api-data.md` for setup and deployment instructions. The current API uses insert-only UUIDv4 capability IDs for anonymous, non-sensitive search sessions; it has no account authentication or durable private profiles. Add authenticated ownership before supporting those features. The current schema stores one integer `price` per listing; represent monthly rent and deposit separately before treating rental recommendations as production-ready.

## GitHub and mobile release

The repository is published under the MIT licence (see `LICENSE`). The licence covers the source code only: listing content stays with its publisher, every result shows its source and its original link, and no third-party listing text, logo, or trademark is redistributed as an owned asset. Mobile store publication additionally requires the final application identifier, store accounts, privacy policy, signing credentials, and store review; this repository alone does not constitute a published app.

## Known pre-release limitations

- No automated Divar or Sheypoor connector is enabled. Real listing ingestion is limited to a page the user explicitly submits, the operator's manual import, and the demo fixtures. A source adapter may only be enabled with a documented permission record, and the registry gate fails closed.
- The user-submitted link path depends on the structured data a source page publishes. When a page exposes only OpenGraph metadata, the price, area, and rooms may stay unknown; the listing is still stored with its source link so the user can reach the source, and unknown fields never earn match points.
- The mobile source typechecks and Expo exports an Android JavaScript bundle. EAS preview (APK) and production (AAB) profiles and reproducible icon/splash assets are configured, but no installable APK/AAB has been produced because this environment has no Android SDK/ADB and EAS is not authenticated.
- The current Expo SDK 58 dependency tree reports 15 high-severity `npm audit` findings in transitive Metro/Expo build-tooling packages (`braces` and `node-forge` advisories). The configured registry does not yet offer patched versions; `npm audit fix --force` proposes downgrading Expo to SDK 44, which breaks the current SDK. Re-audit before a signed mobile release; this is not marked security-clean.
- Preference routes use UUIDv4 anonymous capabilities for non-sensitive search sessions; authenticated ownership is still required before private saved profiles are supported. The current UI stores no account details. Preferences now expire after `PREFERENCE_TTL_HOURS` (default 24 hours) and are removed by the maintenance endpoint.
- The reason list is Persian prose rather than stable reason codes, and stale listings are filtered out instead of being shown with a visible stale label. Both are recorded as open items in `docs/requirements.md`.
