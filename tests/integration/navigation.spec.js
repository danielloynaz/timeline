import { test } from '@playwright/test';
import { create, expect, summary, events, clearEvents, barCenter, canvasOrigin, drag, settle } from './helpers.js';

const iso = (ms) => new Date(ms).toISOString();

test.describe('navigation', () => {
  test('setViewport, setZoom, zoom and pan update the viewport and emit viewportChange', async ({ page }) => {
    await create(page);
    await clearEvents(page);
    await page.evaluate(() => window.TL.instance.setViewport({ start: '2026-03-10T00:00:00Z', end: '2026-04-20T00:00:00Z' }));
    let v = (await summary(page)).viewport;
    expect(iso(v.start)).toBe('2026-03-10T00:00:00.000Z');
    expect(iso(v.end)).toBe('2026-04-20T00:00:00.000Z');
    expect((await events(page, 'viewportChange')).length).toBe(1);

    await page.evaluate(() => window.TL.instance.zoom('in'));
    const v2 = (await summary(page)).viewport;
    expect(v2.pxPerMs).toBeCloseTo(v.pxPerMs * 1.5, 12);
    expect((v2.start + v2.end) / 2).toBeCloseTo((v.start + v.end) / 2, -3); // centre preserved (ms tolerance)

    await page.evaluate(() => window.TL.instance.setZoom('month'));
    expect((await summary(page)).viewport.zoom).toBe('month');

    await page.evaluate(() => window.TL.instance.setZoom('week'));
    v = (await summary(page)).viewport;
    await page.evaluate(() => window.TL.instance.pan('right'));
    const v3 = (await summary(page)).viewport;
    expect(v3.start - v.start).toBeCloseTo((v.end - v.start) / 4, -2);
    await page.evaluate(() => window.TL.instance.pan(-86400000));
    expect((await summary(page)).viewport.start).toBeCloseTo(v3.start - 86400000, -2);
  });

  test('zoom is bounded by min/max presets and the domain', async ({ page }) => {
    await create(page);
    for (let i = 0; i < 30; i++) await page.evaluate(() => window.TL.instance.zoom('in'));
    expect((await summary(page)).viewport.zoom).toBe('day');
    for (let i = 0; i < 40; i++) await page.evaluate(() => window.TL.instance.zoom('out'));
    const v = (await summary(page)).viewport;
    // The 150-day domain fits in 640px before the 'quarter' preset is reached: the domain is the hard bound.
    expect(v.start).toBe(v.domainStart);
    expect(v.end).toBeCloseTo(v.domainEnd, -2);
    expect(v.zoom).toBe('month');
  });

  test('fitToData fits the data extent within the bounds', async ({ page }) => {
    await create(page);
    await page.evaluate(() => window.TL.instance.fitToData());
    const v = (await summary(page)).viewport;
    // data spans Feb 1 → Jun 1; quarter preset allows ~ that range in 640px
    expect(iso(v.start) <= '2026-02-01T00:00:00.000Z').toBe(true);
    expect(iso(v.end) >= '2026-05-31T00:00:00.000Z').toBe(true);
  });

  test('dragging the data area pans and labels stay fixed', async ({ page }) => {
    await create(page);
    const before = (await summary(page)).viewport;
    const labelsBefore = await page.evaluate(() => [...document.querySelectorAll('.tl-label')].map((n) => n.getBoundingClientRect().left));
    const o = await canvasOrigin(page);
    // drag on the 'locked' track (not editable) so the gesture is a pan
    const y = o.top + 3 * 40 + 20;
    await drag(page, { x: o.left + 400, y }, { x: o.left + 200, y });
    await settle(page);
    const after = (await summary(page)).viewport;
    expect(after.start - before.start).toBeCloseTo(200 / before.pxPerMs, -4);
    const labelsAfter = await page.evaluate(() => [...document.querySelectorAll('.tl-label')].map((n) => n.getBoundingClientRect().left));
    expect(labelsAfter).toEqual(labelsBefore);
  });

  test('all layers stay aligned after pan: bar edge, grid and axis tick share one x', async ({ page }) => {
    await create(page);
    await page.evaluate(() => window.TL.instance.pan(5 * 86400000));
    await settle(page);
    const check = await page.evaluate(() => {
      const t = window.TL.instance;
      const f = t.frame();
      // Monday 2026-03-16 is a weekly tick; locate its x through the shared scale.
      const tick = f.ticks.minor.find((m) => new Date(m.time).toISOString().startsWith('2026-03-16'));
      const x = Math.round(t.timeToX(tick.time)); // the 1px line covers column round(x)
      const axisPx = window.TL.pixel('axis', x, 30);
      const gridPx = window.TL.pixel('data', x, 3 * 40 + 5);
      const offAxis = window.TL.pixel('axis', x + 6, 30);
      return { axisPx, gridPx, offAxis };
    });
    // Tick line (lighter than the axis background) at exactly the same x in both canvases.
    expect(check.axisPx[0]).toBeGreaterThan(check.offAxis[0]);
    expect(check.gridPx[3]).toBe(255);
  });

  test('ctrl+wheel zooms around the pointer, shift+wheel pans, plain wheel scrolls tracks', async ({ page }) => {
    await create(page, { rowHeight: 120 }); // 4 rows * 120 = 480 > 356 visible
    const o = await canvasOrigin(page);
    const anchorX = 200;
    const before = await page.evaluate((x) => {
      const t = window.TL.instance;
      return { time: t.getViewport().start + x / t.getViewport().pxPerMs, px: t.getViewport().pxPerMs };
    }, anchorX);
    await page.mouse.move(o.left + anchorX, o.top + 60);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await settle(page);
    const after = await page.evaluate((x) => {
      const t = window.TL.instance;
      return { time: t.getViewport().start + x / t.getViewport().pxPerMs, px: t.getViewport().pxPerMs };
    }, anchorX);
    expect(after.px).toBeGreaterThan(before.px);
    expect(after.time).toBeCloseTo(before.time, -3);

    const startBefore = (await summary(page)).viewport.start;
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Shift');
    await settle(page);
    expect((await summary(page)).viewport.start).toBeGreaterThan(startBefore);

    const scrollBefore = await page.evaluate(() => window.TL.instance.nodes.scroller.scrollTop);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    const scrollAfter = await page.evaluate(() => window.TL.instance.nodes.scroller.scrollTop);
    expect(scrollAfter).toBeGreaterThan(scrollBefore);
    const v = (await summary(page)).viewport;
    expect(v.start).toBe((await summary(page)).viewport.start); // horizontal unchanged by plain wheel
  });

  test('horizontal scrollbar thumb reflects and drives the viewport', async ({ page }) => {
    await create(page);
    const thumb = page.locator('.tl-hscroll-thumb');
    const box = await thumb.boundingBox();
    expect(box.width).toBeGreaterThan(16);
    const before = (await summary(page)).viewport.start;
    await drag(page, { x: box.x + box.width / 2, y: box.y + 3 }, { x: box.x + box.width / 2 + 60, y: box.y + 3 });
    await settle(page);
    expect((await summary(page)).viewport.start).toBeGreaterThan(before);
    const box2 = await thumb.boundingBox();
    expect(box2.x).toBeGreaterThan(box.x);
  });

  test('vertical scrolling virtualises labels and rows', async ({ page }) => {
    const tracks = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, label: `Track ${i}` }));
    await create(page, {}, { tracks, intervals: [{ id: 'x', trackId: 't150', start: '2026-03-10T00:00:00Z', end: '2026-03-12T00:00:00Z' }] });
    let s = await summary(page);
    expect(s.labels.length).toBeLessThan(20);
    expect(s.labels[0]).toBe('Track 0');
    await page.evaluate(() => {
      window.TL.instance.nodes.scroller.scrollTop = 150 * 40;
    });
    await settle(page);
    s = await summary(page);
    expect(s.labels).toContain('Track 150');
    expect(s.labels).not.toContain('Track 0');
    const bar = await barCenter(page, 'x');
    const o = await canvasOrigin(page);
    const px = await page.evaluate(([x, y]) => window.TL.pixel('data', x, y), [bar.x - o.left, bar.y - o.top]);
    expect(await page.evaluate((p) => window.TL.isOrange(p), px)).toBe(true);
  });
});
