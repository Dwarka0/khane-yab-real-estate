# Mobile client

Expo / React Native client for Android and iOS, with Persian RTL property preferences, recommendation cards, match explanations, source verification disclosures, and optional Worker API integration.

## Run

```sh
npm install
copy .env.example .env
npm start
```

Configure `EXPO_PUBLIC_API_BASE_URL` to the Worker origin. The app currently uses demo fixtures when the API is not configured. Run `npm run assets:generate` to reproduce the tracked icon, adaptive icon, and splash PNGs. `eas.json` defines an internal APK profile (`npx eas-cli build --platform android --profile preview`) and a production AAB profile (`npx eas-cli build --platform android --profile production`). Both require an Expo/EAS account and successful authentication. `ir.khaneyab.app` remains a provisional application identifier and must be confirmed before store submission. The current dependency audit still reports high-severity Expo/Metro transitive advisories; resolve and re-audit those before signing/releasing. Complete privacy disclosures, accessibility review, and physical-device tests before store submission. This repository does not yet contain a signed release artifact or a store publication.
