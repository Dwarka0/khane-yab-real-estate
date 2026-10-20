# Release report — v1.0.1

This report records what was actually executed for the release. A check is only listed as passed when it was run; anything that was not executed is listed as not run.

- **Commit range:** `689f1c3..v1.0.1`
- **Environment:** Windows, Node v26.3.0, npm 12.0.2 (CI pins Node 22)
- **Target:** Cloudflare Worker `real-estate-platform-api` + D1 `khane-yab-platform` + two Cloudflare Pages projects
- **Date:** 2026-10-19

## Deployed artefacts

| Artefact | Address | State |
|---|---|---|
| Web client | https://khane-yab-web.m-abner-9907.workers.dev (mirror: https://khane-yab-web.pages.dev) | deployed |
| Mobile client (installable web build) | https://khane-yab-mobile.m-abner-9907.workers.dev (mirror: https://khane-yab-mobile.pages.dev) | deployed |
| API | https://real-estate-platform-api.m-abner-9907.workers.dev | deployed |
| D1 database | `khane-yab-platform` (`8f599923-218f-4316-bbe4-01a76ce2cd4a`) | migrations `0001`–`0005` applied |

## Checks executed

| Check | Command | Result |
|---|---|---|
| Backend type check | `npm run typecheck` | pass |
| Backend tests | `npm test` | pass — 45 tests |
| Backend dependency audit | `npm audit --audit-level=moderate` | pass — 0 vulnerabilities |
| Web type check | `npm run typecheck` | pass |
| Web production build | `npm run build` | pass — 242 kB bundle |
| Web dependency audit | `npm audit --audit-level=high` | pass — 0 vulnerabilities |
| Mobile type check | `npm run typecheck` | pass |
| Mobile asset generation | `npm run assets:generate` / `npm run assets:web` | pass |
| Mobile Android export | `npx expo export --platform android` | pass |
| Mobile web export | `npm run export:web` | pass |
| Mobile dependency audit | `npm audit --audit-level=high` | **15 high** — build-time only, see below |
| D1 migrations (local) | `npx wrangler d1 migrations apply khane-yab-platform --local` | pass |
| D1 migrations (remote) | `npx wrangler d1 migrations apply khane-yab-platform --remote` | pass |
| Live health | `GET /health` | pass — 200 |
| Live listing import | `POST /api/listings/import-link` with a real listing page | pass — 201, real facts extracted |
| Live recommendation | `PUT /api/preferences/:id` then `POST /api/recommendations/:id` | pass — score 100 with reasons |
| Live rental import | `POST /api/listings/import-link` with a rental page | pass — monthly rent and deposit stored separately |
| Live collection | `POST /api/collect` over the configured pages | pass — 109 listings inserted and 28 updated in one run; the pages report their outcome and how many listing pages were read |
| Live search | `POST /api/search/live` with the criteria of a seeker | pass — 22 real Divar listings matched in 11 seconds; the repeated search answered from the cache in 4.5 seconds without asking the source again |
| No permanent storage | the database after a search | pass — every collected row carries an expiry, only the three synthetic demo fixtures stay, and the 866 permanently stored rows of the earlier versions were removed |
| Divar extraction | the Divar category pages and their listing pages | pass — 189 Divar listings stored, of which the area, the rooms, the coordinates, and the city are read from the category page and the price from the listing page |
| Live recommendations over collected listings | `PUT /api/preferences/:id` then `POST /api/recommendations/:id` | pass — 30 real listings returned with score 100 and their reasons |
| Unknown price handling | a collected listing without a stated price | pass — it is not treated as a budget mismatch and never earns the budget point |
| CORS policy | requests with allowed and foreign origins | pass — only the configured origins receive `Access-Control-Allow-Origin` |

## Performance measurement (NFR-03, TC-OPS-05)

Measured with `backend/scripts/load-test.mjs`.

| Target | Requests | Concurrency | p50 | p95 | p99 | Error rate |
|---|---|---|---|---|---|---|
| Local Worker (`wrangler dev`, local D1) | 300 | 10 | 51 ms | 58 ms | 59 ms | 0.0 % |
| Deployed Worker (edge, remote D1) | 40 | 4 | 227 ms | 655 ms | 660 ms | 0.0 % |

The p95 target of 800 ms is met on the deployed path. The deployed sample is deliberately small because the public rate limit is 60 requests per minute per client, and the dataset is the seeded demo set plus the imported listings, not a representative production volume. A re-measurement with a representative dataset is still open (TC-OPS-05).

## Accepted risks

1. **15 high-severity advisories in the mobile build toolchain.** `npm audit` reports `braces` (vulnerable `<=3.0.3`, latest published version is 3.0.3) and `node-forge` (vulnerable `<=1.4.0`, latest published version is 1.4.0); no patched version exists, and the only proposed fix downgrades Expo to SDK 44, which breaks the SDK 58 toolchain. Both packages are build-time dependencies of the Expo/Metro CLI. The published artefacts were inspected: the exported web bundle and the Android Hermes bundle contain no `node-forge`, `micromatch`, or `braces` code, so the advisories do not reach the shipped application. Owner: maintainer. Review before the first signed store release.
2. **No signed mobile artefact.** EAS is not authenticated in this environment and no Android SDK/ADB is installed, so no APK or AAB exists. The installable web build is the published mobile experience.
3. **No account authentication.** Preferences are anonymous UUIDv4 capabilities with a 24-hour expiry. Private saved profiles are not supported.
4. **Stale records are shown, not hidden.** Listings older than the freshness threshold are returned with `stale: true` and a `STALE_LISTING` reason, and the clients label them «قدیمی». The copy never states that the availability is confirmed.
5. **Reason codes are stable, labels are duplicated.** The API returns stable codes plus Persian labels; the clients keep a local map so the labels can be changed without a backend release.

## Not executed

- Automated screen-reader and keyboard-only review (TC-UI-02, TC-UI-03) — the manual checklist is recorded in `docs/review-plan.md` and still needs a human pass.
- Store submission and store review.
- Backup and restore rehearsal for D1.
- A load test against a representative listing volume.
