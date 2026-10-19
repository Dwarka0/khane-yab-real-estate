import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * Finalises the exported web build:
 *  - publishes the PWA manifest and links it from the document head
 *  - adds the apple touch icon so iOS can add the app to the home screen
 */
const dist = new URL('../dist/', import.meta.url);
const manifestPath = new URL('manifest.webmanifest', dist);
const indexPath = new URL('index.html', dist);

if (!existsSync(indexPath)) {
  console.error('dist/index.html is missing; run `expo export --platform web` first');
  process.exit(1);
}

const manifest = {
  name: 'خانه‌یاب',
  short_name: 'خانه‌یاب',
  description: 'جست‌وجو و پیشنهاد آگهی ملک بر اساس نیاز شما',
  lang: 'fa-IR',
  dir: 'rtl',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#F7F8F5',
  theme_color: '#1D5B44',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

let html = readFileSync(indexPath, 'utf8');
if (!html.includes('rel="manifest"')) {
  html = html.replace(
    '</head>',
    '  <link rel="manifest" href="/manifest.webmanifest" />\n  <link rel="apple-touch-icon" href="/icon-192.png" />\n  <meta name="apple-mobile-web-app-capable" content="yes" />\n  <meta name="apple-mobile-web-app-title" content="خانه‌یاب" />\n</head>',
  );
  writeFileSync(indexPath, html, 'utf8');
}
console.log('Web build finalised: manifest and home-screen icons linked');
