# Mobile client

Expo / React Native client for Android and iOS, with Persian RTL property preferences, recommendation cards, match explanations, source verification disclosures, an optional Worker API integration, and a listing-link submission panel. The same source also builds an installable web app (PWA) that is published on Cloudflare Pages.

## Run

```sh
npm install
copy .env.example .env
npm start
```

Configure `EXPO_PUBLIC_API_BASE_URL` to the Worker origin. The app currently uses demo fixtures when the API is not configured. Run `npm run assets:generate` to reproduce the tracked icon, adaptive icon, and splash PNGs, and `npm run assets:web` to reproduce the web favicon and PWA icon sizes. `eas.json` defines an internal APK profile (`npx eas-cli build --platform android --profile preview`) and a production AAB profile (`npx eas-cli build --platform android --profile production`). Both require an Expo/EAS account and successful authentication. `ir.khaneyab.app` remains a provisional application identifier and must be confirmed before store submission. The current dependency audit still reports high-severity Expo/Metro transitive advisories; resolve and re-audit those before signing/releasing. Complete privacy disclosures, accessibility review, and physical-device tests before store submission. This repository does not yet contain a signed release artifact or a store publication.

## Installable web build (PWA)

The mobile source is exported as a single-page web app and published as a Cloudflare Worker with static assets at `https://khane-yab-mobile.m-abner-9907.workers.dev` (mirrored to Cloudflare Pages at `https://khane-yab-mobile.pages.dev`). It installs on Android and iOS home screens, updates without a store release, and talks to the same Worker API as the web client.

```sh
npm install
$env:EXPO_PUBLIC_API_BASE_URL = "https://real-estate-platform-api.m-abner-9907.workers.dev"
npm run export:web
npx wrangler deploy
```

- `npm run export:web` exports with Metro, then `scripts/postprocess-web.mjs` publishes `manifest.webmanifest` and links it, the apple touch icon, and the home-screen metadata from the document head.
- `public/sw.js` is a small app-shell service worker. It caches the shell only and never caches API responses, so listing data always comes from the live API.
- The API Worker must allow this origin in `ALLOWED_ORIGINS` (`https://khane-yab-mobile.m-abner-9907.workers.dev`), otherwise the browser blocks the API calls.
- `npm run configure:web` regenerates the `web` section of `app.json`; it is idempotent and the result is committed.

## Native release

`npx eas-cli build --platform android --profile preview` produces an installable APK and `--profile production` produces an AAB. Both need an authenticated EAS account, and this environment has no Android SDK/ADB, so no signed artifact exists yet. A signed build can be served from Cloudflare (R2 or a Pages download page) and installed as a trusted web app by publishing `/.well-known/assetlinks.json`; store publication remains a separate, account-gated step.
