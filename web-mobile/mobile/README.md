# Mobile client

Expo / React Native starter for Android and iOS, with Persian RTL property preferences, recommendation cards, match explanations, source verification disclosures, and optional Worker API integration.

## Run

```sh
npm install
copy .env.example .env
npm start
```

Configure `EXPO_PUBLIC_API_BASE_URL` to the Worker origin. The app currently uses demo fixtures when the API is not configured. Before store submission, verify the application ID (`ir.khaneyab.app` is a placeholder), add approved icon/splash assets, complete privacy disclosures and accessibility review, configure signing/EAS, and build/test on physical devices. This is source code, not a signed release artifact or store publication.
