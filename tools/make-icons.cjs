// Renders the app icon to PNGs. Run: node tools/make-icons.cjs
const { chromium } = require('playwright');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3ee06a"/><stop offset="1" stop-color="#1fa049"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M370 196a130 130 0 0 0-232-22"/><path d="M128 120v60h60"/>
    <path d="M142 316a130 130 0 0 0 232 22"/><path d="M384 392v-60h-60"/>
    <path d="M200 258l40 40 76-82"/>
  </g></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<style>html,body{margin:0}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`);
    await p.screenshot({ path: path.join(__dirname, '..', 'icons', name) });
  }
  await b.close();
})();
