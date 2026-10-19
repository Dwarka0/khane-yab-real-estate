import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const path = new URL('../app.json', import.meta.url);
const config = JSON.parse(readFileSync(path, 'utf8'));

config.expo.web = {
  bundler: 'metro',
  output: 'single',
  name: 'خانه‌یاب',
  shortName: 'خانه‌یاب',
  description: 'جست‌وجو و پیشنهاد آگهی ملک بر اساس نیاز شما',
  lang: 'fa-IR',
  dir: 'rtl',
  themeColor: '#1D5B44',
  backgroundColor: '#F7F8F5',
  display: 'standalone',
  orientation: 'portrait',
  favicon: './public/favicon.png',
  manifest: {
    name: 'خانه‌یاب',
    short_name: 'خانه‌یاب',
    description: 'جست‌وجو و پیشنهاد آگهی ملک بر اساس نیاز شما',
    lang: 'fa-IR',
    dir: 'rtl',
    start_url: '.',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F7F8F5',
    theme_color: '#1D5B44',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
};

mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log('app.json web section written');
