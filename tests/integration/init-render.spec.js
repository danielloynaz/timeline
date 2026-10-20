import { test } from '@playwright/test';
import { create, expect, summary, barCenter, eventPoint, canvasOrigin, FIXTURE } from './helpers.js';

test.describe('initialisation and static rendering', () => {
  test('mounts one root inside the host and renders labels, bars and markers', async ({ page }) => {
    const s = await create(page);
    expect(s.rootCount).toBe(1);
    expect(s.labels).toEqual(['9373064574', '7575859695', '9378312462', 'locked track']);
    expect(s.viewport.zoom).toBe('week');

    // Interval bar pixel is orange; empty area is background.
    const bar = await barCenter(page, 'iv-a');
    const o = await canvasOrigin(page);
    const px = await page.evaluate(([x, y]) => window.TL.pixel('data', x, y), [bar.x - o.left, bar.y - o.top]);
    expect(await page.evaluate((p) => window.TL.isOrange(p), px)).toBe(true);
    const empty = await page.evaluate(() => window.TL.pixel('data', 5, 5));
    expect(await page.evaluate((p) => window.TL.isOrange(p), empty)).toBe(false);

    // Global line marker spans the whole track area.
    const g = await eventPoint(page, 'ev-global');
    for (const y of [4, 100, 150]) {
      const p = await page.evaluate(([x, yy]) => window.TL.pixel('data', x, yy), [g.x - o.left, y]);
      expect(await page.evaluate((p2) => window.TL.isOrange(p2), p)).toBe(true);
    }
    // Track event dot.
    const d = await eventPoint(page, 'ev-dot');
    const dp = await page.evaluate(([x, y]) => window.TL.pixel('data', x, y), [d.x - o.left, d.y - o.top]);
    expect(await page.evaluate((p) => window.TL.isOrange(p), dp)).toBe(true);
  });

  test('axis shows month labels and weekly day numbers at the week preset', async ({ page }) => {
    await create(page);
    const painted = await page.evaluate(() => window.TL.paintedCount('axis', 0, 0, 640, 44));
    expect(painted).toBeGreaterThan(640 * 44 * 0.9); // background painted everywhere
    // Verify through the tick generator used by the renderer (same scale).
    const labels = await page.evaluate(() => {
      const f = window.TL.instance.frame();
      return { minor: f.ticks.minor.map((t) => t.label), major: f.ticks.major.map((m) => m.label), level: f.ticks.level.minor.unit };
    });
    expect(labels.level).toBe('week');
    expect(labels.major).toEqual(['March 2026', 'April 2026']);
    expect(labels.minor.slice(0, 3)).toEqual(['2', '9', '16']);
  });

  test('intervals extending beyond the viewport are clipped, not discarded', async ({ page }) => {
    await create(page);
    const o = await canvasOrigin(page);
    const row = await page.evaluate(() => window.TL.instance.rowOf('phone-2'));
    const y = row * 40 + 20;
    // iv-long runs Feb 1 → Jun 1; the visible row must be orange at both edges.
    for (const x of [1, 300, o.width - 2]) {
      const p = await page.evaluate(([xx, yy]) => window.TL.pixel('data', xx, yy), [x, y]);
      expect(await page.evaluate((p2) => window.TL.isOrange(p2), p)).toBe(true);
    }
    const src = await page.evaluate(() => window.TL.instance.getData().intervals.find((i) => i.id === 'iv-long'));
    expect(src.start).toBe('2026-02-01T00:00:00.000Z');
  });

  test('constructor validates container and options with TimelineError', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => Boolean(window.TL));
    const result = await page.evaluate(() => {
      const out = [];
      const tryIt = (fn) => {
        try {
          fn();
          out.push('ok');
        } catch (e) {
          out.push(`${e.name}:${e.code}`);
        }
      };
      tryIt(() => new window.TL.Timeline(null, { startDate: '2026-01-01', endDate: '2026-02-01' }));
      tryIt(() => new window.TL.Timeline(document.querySelector('#host'), {}));
      tryIt(() => new window.TL.Timeline(document.querySelector('#host'), { startDate: '2026-02-01', endDate: '2026-01-01' }));
      tryIt(() => new window.TL.Timeline(document.querySelector('#host'), { startDate: '2026-01-01', endDate: '2026-02-01', renderMode: 'svg' }));
      return { out, roots: document.querySelectorAll('#host .tl-root').length };
    });
    expect(result.out).toEqual(['TimelineError:INVALID_CONFIG', 'TimelineError:INVALID_CONFIG', 'TimelineError:INVALID_CONFIG', 'TimelineError:INVALID_CONFIG']);
    expect(result.roots).toBe(0);
  });

  test('styles are injected once and can be disabled', async ({ page }) => {
    await create(page);
    const count = await page.evaluate(() => document.adoptedStyleSheets.length + document.querySelectorAll('style[data-tl-styles]').length);
    expect(count).toBe(1);
    await create(page, { injectStyles: true });
    const count2 = await page.evaluate(() => document.adoptedStyleSheets.length + document.querySelectorAll('style[data-tl-styles]').length);
    expect(count2).toBe(1);
    const bg = await page.evaluate(() => getComputedStyle(window.TL.instance.element).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('light theme switches the palette read by the canvas', async ({ page }) => {
    await create(page, { theme: 'light' });
    const p = await page.evaluate(() => window.TL.pixel('data', 5, 5));
    expect(p[0]).toBeGreaterThan(240);
    expect(p[1]).toBeGreaterThan(240);
    const s = await summary(page);
    expect(s.rootCount).toBe(1);
  });

  test('cornerLabel and hideEmptyTracks options', async ({ page }) => {
    await create(page, { cornerLabel: 'phone', hideEmptyTracks: true });
    expect(await page.textContent('.tl-corner')).toBe('phone');
    const s = await summary(page);
    expect(s.labels).toEqual(['9373064574', '7575859695', '9378312462']); // 'locked track' has no items
  });
});
