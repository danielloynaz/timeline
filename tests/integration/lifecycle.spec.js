import { test, chromium } from '@playwright/test';
import { create, expect, summary, events, clearEvents, settle, barCenter, canvasOrigin, FIXTURE } from './helpers.js';

test.describe('lifecycle, resizing and host-controlled data', () => {
  test('container resize re-measures canvases and keeps the scale', async ({ page }) => {
    await create(page);
    const before = await page.evaluate(() => ({ w: window.TL.instance.nodes.dataCanvas.clientWidth, v: window.TL.instance.getViewport() }));
    await clearEvents(page);
    await page.evaluate(() => {
      document.querySelector('#host').style.width = '1000px';
      document.querySelector('#host').style.height = '300px';
    });
    await page.waitForTimeout(100);
    await settle(page);
    const after = await page.evaluate(() => ({ w: window.TL.instance.nodes.dataCanvas.clientWidth, h: window.TL.instance.nodes.dataCanvas.clientHeight, v: window.TL.instance.getViewport() }));
    expect(after.w).toBe(before.w + 200);
    expect(after.v.pxPerMs).toBe(before.v.pxPerMs);
    expect(after.v.start).toBe(before.v.start);
    expect(after.v.end - after.v.start).toBeGreaterThan(before.v.end - before.v.start);
    expect((await events(page, 'viewportChange')).length).toBeGreaterThan(0);
  });

  test('compact height hides the axis', async ({ page }) => {
    await create(page);
    await page.evaluate(() => {
      document.querySelector('#host').style.height = '120px';
    });
    await page.waitForTimeout(100);
    await settle(page);
    await expect(page.locator('.tl-root')).toHaveAttribute('data-tl-compact', 'true');
    expect(await page.evaluate(() => window.TL.instance.nodes.axis.getBoundingClientRect().height)).toBe(0);
  });

  test('renders crisply on high-density displays', async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1000, height: 600 } });
    const page = await ctx.newPage();
    await create(page);
    const dims = await page.evaluate(() => {
      const c = window.TL.instance.nodes.dataCanvas;
      return { w: c.width, cw: c.clientWidth, h: c.height, ch: c.clientHeight, dpr: window.devicePixelRatio };
    });
    expect(dims.dpr).toBe(2);
    expect(dims.w).toBe(dims.cw * 2);
    expect(dims.h).toBe(dims.ch * 2);
    const bar = await barCenter(page, 'iv-a');
    const o = await canvasOrigin(page);
    const px = await page.evaluate(([x, y]) => window.TL.pixel('data', x, y), [bar.x - o.left, bar.y - o.top]);
    expect(await page.evaluate((p) => window.TL.isOrange(p), px)).toBe(true);
    await browser.close();
  });

  test('destroy removes only library DOM, stops listeners, and re-initialisation works', async ({ page }) => {
    await create(page);
    await page.evaluate(() => {
      const host = document.querySelector('#host');
      const sibling = document.createElement('p');
      sibling.id = 'sibling';
      host.appendChild(sibling);
    });
    await page.evaluate(() => window.TL.instance.destroy());
    expect((await events(page, 'destroy')).length).toBe(1);
    expect(await page.evaluate(() => document.querySelectorAll('#host .tl-root').length)).toBe(0);
    expect(await page.evaluate(() => Boolean(document.querySelector('#sibling')))).toBe(true);
    const err = await page.evaluate(() => {
      try {
        window.TL.instance.setData({});
        return null;
      } catch (e) {
        return e.code;
      }
    });
    expect(err).toBe('DESTROYED');
    expect(await page.evaluate(() => window.TL.instance.destroyed)).toBe(true);

    for (let i = 0; i < 3; i++) {
      const s = await create(page);
      expect(s.rootCount).toBe(1);
      expect(s.labels.length).toBe(4);
    }
  });

  test('setData is atomic: structural errors leave data intact; unknown tracks emit dataError', async ({ page }) => {
    await create(page);
    const err = await page.evaluate(() => {
      try {
        window.TL.instance.setData({ tracks: [{ id: 'a' }, { id: 'a' }], intervals: [{ id: 'x', trackId: 'a', start: 1, end: 5 }] });
        return null;
      } catch (e) {
        return { code: e.code, message: e.message };
      }
    });
    expect(err.code).toBe('DUPLICATE_ID');
    expect((await summary(page)).labels.length).toBe(4);
    const err2 = await page.evaluate(() => {
      try {
        window.TL.instance.setData({ tracks: [{ id: 'a' }], intervals: [{ id: 'x', trackId: 'a', start: 'yesterday', end: 1 }] });
        return null;
      } catch (e) {
        return e.code;
      }
    });
    expect(err2).toBe('INVALID_TIMESTAMP');
    expect((await summary(page)).labels.length).toBe(4);

    await clearEvents(page);
    await page.evaluate(() =>
      window.TL.instance.setData({
        tracks: [{ id: 'a', label: 'A' }],
        intervals: [{ id: 'ok', trackId: 'a', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' }, { id: 'lost', trackId: 'ghost', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' }],
        events: [{ id: 'lost-e', trackId: 'ghost', date: '2026-03-01T00:00:00Z' }],
      }),
    );
    const de = await events(page, 'dataError');
    expect(de.length).toBe(1);
    expect(de[0].detail.code).toBe('UNKNOWN_TRACK');
    expect(de[0].detail.intervals.map((i) => i.id)).toEqual(['lost']);
    expect(de[0].detail.events.map((e) => e.id)).toEqual(['lost-e']);
    expect(await page.evaluate(() => window.TL.instance.index.intervalById.has('ok'))).toBe(true);
    expect(await page.evaluate(() => window.TL.instance.index.intervalById.has('lost'))).toBe(false);
  });

  test('data refreshes preserve selection and viewport; removed items are dropped with one event', async ({ page }) => {
    await create(page);
    await page.evaluate(() => window.TL.instance.setSelection(['iv-a', 'ev-dot']));
    const v = (await summary(page)).viewport;
    await clearEvents(page);
    await page.evaluate(() => window.TL.instance.updateData({ tracks: [{ id: 'phone-4', label: 'new' }] }));
    await settle(page);
    let s = await summary(page);
    expect(s.selection.ids).toEqual(['iv-a', 'ev-dot']);
    expect(s.viewport).toEqual(v);
    expect(s.labels).toContain('new');
    expect((await events(page, 'selectionChange')).length).toBe(0);

    await page.evaluate(() => window.TL.instance.updateData({ remove: { events: ['ev-dot'] } }));
    await settle(page);
    s = await summary(page);
    expect(s.selection).toEqual({ ids: ['iv-a'], primaryId: 'iv-a' });
    expect((await events(page, 'selectionChange')).length).toBe(1);

    // The host's own objects are never mutated.
    const mutated = await page.evaluate(() => {
      const d = window.TL.DATA;
      const snapshot = JSON.stringify(d);
      window.TL.instance.setData(d);
      window.TL.instance.updateData({ intervals: [{ id: 'iv-a', trackId: 'phone-3', start: '2026-03-11T00:00:00Z', end: '2026-03-21T00:00:00Z' }] });
      return JSON.stringify(d) !== snapshot;
    });
    expect(mutated).toBe(false);
  });

  test('on/off and native CustomEvents bubble to the host container', async ({ page }) => {
    await page.goto(FIXTURE);
    await page.waitForFunction(() => Boolean(window.TL));
    const result = await page.evaluate(() => {
      const host = document.querySelector('#host');
      const seen = [];
      host.addEventListener('timeline:selection-change', (e) => seen.push(['dom', e.detail.ids]));
      const t = new window.TL.Timeline(host, { ...window.TL.BASE_OPTIONS });
      const cb = (e) => seen.push(['api', e.detail.ids]);
      t.on('selection-change', cb);
      t.setData(window.TL.DATA);
      t.setSelection(['iv-a']);
      t.setFilters({ tracks: ['phone-1'] }); // drops iv-a → emits
      t.off('selectionChange', cb);
      t.setFilters(null);
      t.setSelection(['iv-a']);
      t.setFilters({ tracks: ['phone-1'] }); // emits again, only DOM listener left
      t.destroy();
      return seen;
    });
    // Listeners on the root (api) run before the event bubbles to the host (dom).
    expect(result).toEqual([
      ['api', []],
      ['dom', []],
      ['dom', []],
    ]);
  });

  test('no listener or frame leaks across repeated init/destroy', async ({ page }) => {
    await create(page);
    const leaks = await page.evaluate(async () => {
      const host = document.querySelector('#host');
      const origAdd = EventTarget.prototype.addEventListener;
      const origRemove = EventTarget.prototype.removeEventListener;
      let live = 0;
      /** @type {Map<string, number>} */
      const windowListeners = new Map();
      EventTarget.prototype.addEventListener = function (type, fn, opts) {
        live++;
        if (this === window) windowListeners.set(type, (windowListeners.get(type) ?? 0) + 1);
        if (opts && typeof opts === 'object' && opts.signal) opts.signal.addEventListener?.call(opts.signal, 'abort', () => live--, { once: true });
        return origAdd.call(this, type, fn, opts);
      };
      let rafPending = 0;
      const origRaf = window.requestAnimationFrame;
      const origCancel = window.cancelAnimationFrame;
      window.requestAnimationFrame = (cb) => {
        rafPending++;
        return origRaf((ts) => {
          rafPending--;
          cb(ts);
        });
      };
      window.cancelAnimationFrame = (id) => {
        rafPending--;
        origCancel(id);
      };
      window.TL.destroy();
      for (let i = 0; i < 10; i++) {
        const t = new window.TL.Timeline(host, { ...window.TL.BASE_OPTIONS });
        t.setData(window.TL.DATA);
        t.destroy();
      }
      await new Promise((r) => setTimeout(r, 50));
      EventTarget.prototype.addEventListener = origAdd;
      EventTarget.prototype.removeEventListener = origRemove;
      window.requestAnimationFrame = origRaf;
      window.cancelAnimationFrame = origCancel;
      return { rafPending, windowBlur: windowListeners.get('blur') ?? 0, roots: host.querySelectorAll('.tl-root').length };
    });
    expect(leaks.roots).toBe(0);
    expect(leaks.rafPending).toBeLessThanOrEqual(0);
    expect(leaks.windowBlur).toBe(10); // one per instance, all removed by the AbortController
  });
});
