# خانه‌یاب | Real Estate Recommendation Platform

A Persian, right-to-left property discovery and recommendation platform designed for Cloudflare Workers and D1, with a responsive web client and an Expo mobile client. The engineering process and UML deliverables follow the analysis, design, implementation, verification, and maintenance workflow described in Roger S. Pressman's *Software Engineering: A Practitioner's Approach*.

## Current integration status

- `backend/`: Cloudflare Worker API, D1 schema, listing normalization, and explainable recommendations (see `backend/README.md`).
- `web-mobile/web/`: responsive Persian RTL web interface.
- `web-mobile/mobile/`: Expo/React Native mobile application source.
- `docs/`: requirements, traceability, architecture, UML/data-flow diagrams, and verification plans.
- Public source repository: [github.com/Dwarka0/khane-yab-real-estate](https://github.com/Dwarka0/khane-yab-real-estate).

## Deployed web and API

- Web app: [https://khane-yab-web.pages.dev](https://khane-yab-web.pages.dev)
- API health: [https://real-estate-platform-api.m-abner-9907.workers.dev/health](https://real-estate-platform-api.m-abner-9907.workers.dev/health)
- API data: Cloudflare D1 database `khane-yab-platform`; migrations `0001_initial.sql`, `0002_demo_listings.sql`, and `0003_align_demo_seed.sql` are applied remotely.

The web app and API have been deployed and smoke-tested. Demo listings are seeded and clearly marked as demo data. The protected manual-import endpoints remain disabled until `ADMIN_INGEST_TOKEN` is configured as a Cloudflare Worker secret; configure it before importing authorized external data.

Listings from Divar and Sheypoor must only be imported through an official API, an explicitly authorized integration, or user-provided data that the user is entitled to use. The project includes demo data and manual import as a safe starting path; it does not bypass access controls or claim that a listing is still available. Each result should show its source and freshness/verification status.

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

Review the licensing decision before public release; no third-party listing content or trademarks are bundled as owned assets. Mobile store publication additionally requires the final application identifier, store accounts, privacy policy, signing credentials, and store review; this repository alone does not constitute a published app.

## Known pre-release limitations

- No Divar or Sheypoor connector is enabled. Real listing ingestion requires an official API, licensed export, or documented authorization. Included listings are synthetic demo fixtures.
- The mobile source typechecks and Expo exports an Android JavaScript bundle, but no installable APK/AAB has been produced because this environment has no Android SDK/device tooling.
- The current Expo SDK 58 dependency tree reports 15 high-severity `npm audit` findings in transitive Metro/Expo build-tooling packages (`braces` and `node-forge` advisories). The configured registry does not yet offer patched versions; `npm audit fix --force` proposes downgrading Expo to SDK 44, which breaks the current SDK. Re-audit before a signed mobile release; this is not marked security-clean.
- Preference routes still need authenticated ownership before private saved profiles are supported. The current UI creates anonymous client-generated IDs and stores no account details.
