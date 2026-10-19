# Privacy notice — خانه‌یاب (Khane-Yab)

Effective date: 2026-10-19. This notice describes what the platform stores, why, and for how long.

## What the platform stores

| Data | Why | Retention |
|---|---|---|
| Anonymous search preferences (budget, city, areas, room count, required and avoided terms) | To rank listings for the search that created them | Expires after 24 hours (`PREFERENCE_TTL_HOURS`); removed by the daily maintenance run |
| Listing records imported from a page the user submitted (title, price, area, rooms, city, neighbourhood, amenities, source link) | To match a listing against a search and to link the user to the source | Kept while the listing is active; observations older than 180 days are removed by the maintenance run |
| Source observations (which source, which source record, when it was seen) | Provenance and duplicate detection | 180 days |
| Ingestion run records and row-level diagnostics (row number, error code, field names) | Operator review of data quality | Kept with the run history; diagnostics never contain a full imported row |
| Rate-limit counters | Abuse protection | Buckets older than one hour are removed |
| Request identifiers | To correlate a user report with a server log | Present in the log line only; they contain no user data |

## What the platform does not store

- No accounts, no names, no phone numbers, no email addresses, no national identifiers.
- No cookies for tracking, no advertising identifiers, no third-party analytics.
- No payment details; the platform is not a transaction system.
- The favourites ("saved") list in the web and mobile clients lives in the browser or device memory only and is never uploaded.

## Third-party content

Listing text, images, and trademarks belong to their publishers (for example Divar or Sheypoor). The platform stores only the fields required to match a listing to a search, always shows the source, and always links back to the original listing page. It does not redistribute listing content as its own.

## Your choices

- Use the service without creating an account; no personal data is required.
- Submit a listing link only for a listing you are entitled to share.
- Ask for removal of a stored listing: the operator can withdraw or delete a record, and the removal is recorded in the ingestion history. Contact the repository owner through the public issue tracker of the project.
- Search preferences disappear on their own after 24 hours.

## Changes

Material changes to this notice are published with the project history in the public repository, so every change is reviewable.
