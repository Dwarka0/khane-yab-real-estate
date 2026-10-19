# Web client

Responsive Persian RTL React + Vite interface. It offers purchase/rent selection, budget and property filters, ranked recommendation cards, explainable match reasons, saved-in-session cards, loading/empty/error states, source links, and explicit demo/unverified disclosures.

## Run

```sh
npm install
copy .env.example .env.local
npm run dev
```

Set `VITE_API_BASE_URL` to the Worker origin. On search, the client creates an anonymous preference ID, calls `PUT /api/preferences/:id`, then calls `POST /api/recommendations/:id`; it maps the backend's `{ items: [{ listing, score, reasons }] }` response into the cards. Preference IDs are currently client-generated and the API does not yet enforce authenticated ownership, so do not use it for sensitive/private profiles until that is addressed. With no API URL, the client uses clearly disclosed demo fixtures. Demo data and external image URLs are not real listings or product-owned assets.

## Cloudflare deployment

The client is published as a Worker with static assets, which keeps it on a `workers.dev` address:

```sh
npm ci
$env:VITE_API_BASE_URL = "https://real-estate-platform-api.m-abner-9907.workers.dev"
npm run build
npx wrangler deploy
```

The result is served at `https://khane-yab-web.m-abner-9907.workers.dev`. Add that origin to the Worker `ALLOWED_ORIGINS` variable.

The same build can be published to Cloudflare Pages as a mirror:

Build with the production Worker URL configured at build time:

```sh
npm ci
$env:VITE_API_BASE_URL = "https://YOUR-WORKER.workers.dev"
npm run build
npx wrangler pages deploy dist --project-name khane-yab-web
```

Create the Pages project first if it does not exist. Set the exact deployed Pages origin in the Worker `ALLOWED_ORIGINS` variable. The placeholder Worker URL must be replaced before building for production.
