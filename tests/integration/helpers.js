import { expect } from '@playwright/test';

export const FIXTURE = '/tests/integration/fixtures/index.html';

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {object | null} [data]
 * @param {{ start: string, end: string } | null} [viewport]
 */
export async function create(page, options = {}, data = undefined, viewport = undefined) {
  await page.goto(FIXTURE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.TL));
  return page.evaluate(([o, d, v]) => window.TL.create(o, d, v), [options, data, viewport]);
}

/** @param {import('@playwright/test').Page} page */
export const summary = (page) => page.evaluate(() => window.TL.summary());
/** @param {import('@playwright/test').Page} page @param {string} [name] */
export const events = (page, name) => page.evaluate((n) => window.TL.eventsOf(n), name);
/** @param {import('@playwright/test').Page} page */
export const clearEvents = (page) => page.evaluate(() => window.TL.clearEvents());
/** @param {import('@playwright/test').Page} page */
export const flush = (page) => page.evaluate(() => window.TL.instance.flush());
/** @param {import('@playwright/test').Page} page @param {string} id */
export const barCenter = (page, id) => page.evaluate((i) => window.TL.barCenter(i), id);
/** @param {import('@playwright/test').Page} page @param {string} id */
export const eventPoint = (page, id) => page.evaluate((i) => window.TL.eventPoint(i), id);
/** @param {import('@playwright/test').Page} page @param {string} trackId @param {string} iso */
export const trackPoint = (page, trackId, iso) => page.evaluate(([t, i]) => window.TL.trackPoint(t, i), [trackId, iso]);
/** @param {import('@playwright/test').Page} page */
export const canvasOrigin = (page) => page.evaluate(() => window.TL.canvasOrigin());

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }} to
 * @param {{ button?: 'left'|'right', modifiers?: string[], steps?: number, release?: boolean }} [opts]
 */
export async function drag(page, from, to, opts = {}) {
  const mods = opts.modifiers ?? [];
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: opts.button ?? 'left' });
  const steps = opts.steps ?? 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  if (opts.release !== false) await page.mouse.up({ button: opts.button ?? 'left' });
  for (const m of mods) await page.keyboard.up(m);
}

/**
 * Click with modifier keys held (page.mouse.click ignores `modifiers`).
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} p
 * @param {string[]} [modifiers]
 */
export async function clickAt(page, p, modifiers = []) {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Wait for a frame and flush the renderer. */
export async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await flush(page);
}

export { expect };
