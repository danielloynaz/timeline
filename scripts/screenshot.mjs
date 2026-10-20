// Dev helper: node scripts/screenshot.mjs <out.png> [url]  (requires the dev server on :4173)
import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.argv[3] ?? 'http://127.0.0.1:4173/examples/vanilla/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(url);
await page.waitForTimeout(600);
await page.locator('#timeline').screenshot({ path: out });
console.log(JSON.stringify({ errors, log: (await page.locator('#log').textContent())?.split('\n').slice(0, 5) }, null, 2));
await browser.close();
