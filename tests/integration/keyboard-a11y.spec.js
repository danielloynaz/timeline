import { test } from '@playwright/test';
import { create, expect, summary, events, settle } from './helpers.js';

test.describe('keyboard access and accessibility', () => {
  test('arrow keys move focus, Space selects, Enter activates, Escape clears', async ({ page }) => {
    await create(page);
    const scroller = page.locator('.tl-scroller');
    await scroller.focus();
    await expect(scroller).toHaveAttribute('role', 'application');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    const active = await scroller.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    const text = await page.evaluate((id) => document.getElementById(id)?.textContent, active);
    expect(text).toContain('iv-locked'); // first visible item (row 0)
    expect(text).toContain('Track: 9373064574');

    await page.keyboard.press('ArrowDown'); // nearest in time on phone-2: ev-dot (Mar 25) is closer to Mar 5 than iv-long (Feb 1)
    await settle(page);
    const active2 = await scroller.getAttribute('aria-activedescendant');
    expect(await page.evaluate((id) => document.getElementById(id)?.textContent, active2)).toContain('Call');

    await page.keyboard.press('ArrowLeft'); // previous on same track → iv-long
    await settle(page);
    expect(await page.evaluate((id) => document.getElementById(id)?.textContent, await scroller.getAttribute('aria-activedescendant'))).toContain('iv-long');
    await page.keyboard.press('End'); // last on track → ev-dot again
    await settle(page);
    const active3 = await scroller.getAttribute('aria-activedescendant');
    expect(await page.evaluate((id) => document.getElementById(id)?.textContent, active3)).toContain('Call');

    await page.keyboard.press(' ');
    expect((await summary(page)).selection.ids).toEqual(['ev-dot']);
    await page.keyboard.press(' ');
    expect((await summary(page)).selection.ids).toEqual([]);
    await page.keyboard.press('Enter');
    expect((await summary(page)).selection.ids).toEqual(['ev-dot']);
    expect((await events(page, 'eventActivate')).at(-1).detail).toMatchObject({ id: 'ev-dot', source: 'keyboard' });
    await settle(page);
    expect(await page.evaluate((id) => document.getElementById(id)?.getAttribute('aria-selected'), active3)).toBe('true');

    await page.keyboard.press('Escape');
    await settle(page);
    expect(await scroller.getAttribute('aria-activedescendant')).toBeNull();
  });

  test('focused item is scrolled and panned into view and drawn with a focus ring', async ({ page }) => {
    await create(page, {}, undefined, { start: '2026-05-01T00:00:00Z', end: '2026-06-20T00:00:00Z' });
    const scroller = page.locator('.tl-scroller');
    await scroller.focus();
    await page.keyboard.press('ArrowRight'); // iv-long is visible (runs to Jun 1)
    await page.keyboard.press('ArrowRight'); // ev-dot on Mar 25 is off-screen → pans
    await settle(page);
    const v = (await summary(page)).viewport;
    expect(v.start).toBeLessThanOrEqual(Date.parse('2026-03-25T00:00:00Z'));
    const painted = await page.evaluate(() => {
      const t = window.TL.instance;
      const x = t.timeToX('2026-03-25T00:00:00Z');
      const y = t.rowOf('phone-2') * 40 + 20;
      return window.TL.paintedCount('overlay', x - 10, y - 10, 20, 20);
    });
    expect(painted).toBeGreaterThan(20);
  });

  test('+/- zoom, Shift+arrows pan, and unrelated keys are not intercepted', async ({ page }) => {
    await create(page);
    const scroller = page.locator('.tl-scroller');
    await scroller.focus();
    const v0 = (await summary(page)).viewport;
    await page.keyboard.press('+');
    expect((await summary(page)).viewport.pxPerMs).toBeGreaterThan(v0.pxPerMs);
    await page.keyboard.press('-');
    expect((await summary(page)).viewport.pxPerMs).toBeCloseTo(v0.pxPerMs, 12);
    await page.keyboard.press('Shift+ArrowRight');
    expect((await summary(page)).viewport.start).toBeGreaterThan(v0.start);

    const results = await page.evaluate(() => {
      const s = window.TL.instance.nodes.scroller;
      const fire = (key, init = {}) => {
        const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        s.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return { k: fire('k'), ctrlS: fire('s', { ctrlKey: true }), tab: fire('Tab'), plus: fire('+'), ctrlPlus: fire('+', { ctrlKey: true }) };
    });
    expect(results).toEqual({ k: false, ctrlS: false, tab: false, plus: true, ctrlPlus: false });

    // Keys pressed outside the timeline are untouched.
    await page.locator('#other').focus();
    const before = (await summary(page)).viewport;
    await page.keyboard.press('+');
    expect((await summary(page)).viewport.pxPerMs).toBe(before.pxPerMs);
  });

  test('offscreen listbox describes visible items textually and marker shapes differ', async ({ page }) => {
    await create(page);
    const options = await page.locator('.tl-a11y[role="listbox"] [role="option"]').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(6);
    expect(options.some((t) => t.includes('iv-a') && t.includes('Duration: 10d'))).toBe(true);
    expect(options.some((t) => t.includes('Alert') && t.includes('Scope: Global'))).toBe(true);
    expect(await page.locator('.tl-scroller').getAttribute('aria-description')).toContain('4 tracks');
    const markers = await page.evaluate(() => [...window.TL.instance.index.eventById.values()].map((e) => e.marker));
    expect(new Set(markers).size).toBeGreaterThan(1);
  });

  test('focus-visible ring is shown on the scroller', async ({ page }) => {
    await create(page);
    await page.locator('#other').focus();
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.className);
    expect(focused).toBe('tl-scroller');
    const shadow = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
    expect(shadow).not.toBe('none');
  });
});
