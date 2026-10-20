# خانه‌یاب | Real Estate Recommendation Platform

A Persian, right-to-left property discovery and recommendation platform designed for Cloudflare Workers and D1, with a responsive web client and an Expo mobile client. The engineering process and UML deliverables follow the analysis, design, implementation, verification, and maintenance workflow described in Roger S. Pressman's *Software Engineering: A Practitioner's Approach*.

## Current integration status

- `backend/`: Cloudflare Worker API, D1 schema, listing normalization, a source registry with a fail-closed permission gate, a scheduled collector, provenance observations, and explainable recommendations (see `backend/README.md`).
- `web-mobile/web/`: responsive Persian RTL web interface, including a panel for submitting a listing link.
- `web-mobile/mobile/`: Expo/React Native mobile application source, including the same link-submission panel. The same source builds an installable web app that is published on Cloudflare Pages.
- `docs/`: requirements, traceability, architecture, use-case descriptions, UML/data-flow/schedule diagrams, and verification plans.
- Public source repository: [github.com/Dwarka0/khane-yab-real-estate](https://github.com/Dwarka0/khane-yab-real-estate) (MIT licence).

## Deployed web and API

- Web app: [https://khane-yab-web.m-abner-9907.workers.dev](https://khane-yab-web.m-abner-9907.workers.dev)
- Mobile app (installable web build): [https://khane-yab-mobile.m-abner-9907.workers.dev](https://khane-yab-mobile.m-abner-9907.workers.dev)
- API health: [https://real-estate-platform-api.m-abner-9907.workers.dev/health](https://real-estate-platform-api.m-abner-9907.workers.dev/health)
- API data: Cloudflare D1 database `khane-yab-platform`; migrations `0001_initial.sql` through `0005_sources_observations.sql` are applied remotely.

The web app and API have been deployed and smoke-tested. Demo listings are seeded and clearly marked as demo data. A live end-to-end check imported a real listing page through `POST /api/listings/import-link` and returned it as a ranked recommendation with its reasons and its original link.

### How real listings enter the platform

**The search happens when the seeker searches.** `POST /api/search/live` takes the criteria, reads the matching pages of the sources (Divar first), and answers with the listings that fit. The pages are declared in `source_pages` and can be changed without a deployment; the sources' `robots.txt` is followed, the request rate is low, no account is used, and no access control is bypassed.

**The server keeps nothing.** The listings a search reads live in a cache with a two hour lifetime, and an hourly job removes what expired. Only the synthetic demo fixtures stay. The 866 permanently stored rows of earlier versions were removed from the database.

**The device keeps everything.** The web and mobile clients store the listings they fetched, the favourites, and the profile in the device's own storage, and they learn from what the seeker saves: the city, the budget, the area, and the room count that appear most often become the suggestions for the next search. The criteria travel with a search only as the short lived anonymous capability the API already accepts, and the server stores nothing that identifies the device or the person.

Two more paths exist for the operator: a user-submitted listing link (`POST /api/listings/import-link`) and a validated bulk import (`POST /api/ingest/manual`). Every source must be registered in the `sources` table with an approved permission record, and the gate fails closed.

### The memory stays on the device

Both clients keep a **device-local memory**: the search criteria, the listings that were fetched, the favourites, and what the app has learned about the seeker. No account and no login is required, and the user can erase the memory from the interface. A search asks the server for the current listings, the answer is stored on the device, and the device can answer from its own copy the next time. The server keeps a two hour cache of what it read, never a copy of the seeker's memory, and nothing that identifies the device or the person.

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

The repository is published under the MIT licence (see `LICENSE`). The licence covers the source code only: listing content stays with its publisher, every result shows its source and its original link, and no third-party listing text, logo, or trademark is redistributed as an owned asset. The privacy notice is `PRIVACY.md`, and the executed release checks are recorded in `docs/release-report.md`. Mobile store publication additionally requires the final application identifier, store accounts, privacy policy, signing credentials, and store review; this repository alone does not constitute a published app. The installable mobile build and the download page are published as Cloudflare Workers with static assets at `https://khane-yab-mobile.m-abner-9907.workers.dev` and `https://khane-yab-web.m-abner-9907.workers.dev/download.html`. The Cloudflare Pages addresses (`https://khane-yab-web.pages.dev` and `https://khane-yab-mobile.pages.dev`) mirror the same builds, but `workers.dev` is the primary address because `pages.dev` is unreachable on some networks.

## Known pre-release limitations

- No automated Divar or Sheypoor connector is enabled. Real listing ingestion is limited to a page the user explicitly submits, the operator's manual import, and the demo fixtures. A source adapter may only be enabled with a documented permission record, and the registry gate fails closed.
- The user-submitted link path depends on the structured data a source page publishes. When a page exposes only OpenGraph metadata, the price, area, and rooms may stay unknown; the listing is still stored with its source link so the user can reach the source, and unknown fields never earn match points.
- The mobile source typechecks and Expo exports an Android JavaScript bundle. EAS preview (APK) and production (AAB) profiles and reproducible icon/splash assets are configured. An installable Android package is built by the `apk` GitHub Actions workflow (`.github/workflows/apk.yml`) on every version tag and attached to the release; it is signed with the local build key, not a store signing account, and `ir.khaneyab.app` must be confirmed before store submission.
- The current Expo SDK 58 dependency tree reports 15 high-severity `npm audit` findings in transitive Metro/Expo build-tooling packages (`braces` and `node-forge` advisories). The configured registry does not yet offer patched versions; `npm audit fix --force` proposes downgrading Expo to SDK 44, which breaks the current SDK. Re-audit before a signed mobile release; this is not marked security-clean.
- Preference routes use UUIDv4 anonymous capabilities for non-sensitive search sessions; authenticated ownership is still required before private saved profiles are supported. The current UI stores no account details. Preferences now expire after `PREFERENCE_TTL_HOURS` (default 24 hours) and are removed by the maintenance endpoint.
- The reason list is Persian prose rather than stable reason codes, and stale listings are filtered out instead of being shown with a visible stale label. Both are recorded as open items in `docs/requirements.md`.
