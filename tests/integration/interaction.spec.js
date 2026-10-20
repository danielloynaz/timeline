import { test } from '@playwright/test';
import { create, expect, summary, events, clearEvents, barCenter, eventPoint, trackPoint, canvasOrigin, drag, settle, clickAt } from './helpers.js';

test.describe('hover, selection, filtering and low-level events', () => {
  test('hovering an interval shows a tooltip with label, track, dates, duration and metadata', async ({ page }) => {
    await create(page);
    const c = await barCenter(page, 'iv-a');
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(80);
    const tip = page.locator('.tl-tooltip');
    await expect(tip).toHaveAttribute('data-tl-visible', 'true');
    const text = await tip.textContent();
    expect(text).toContain('iv-a');
    expect(text).toContain('9378312462');
    expect(text).toContain('Mar 10');
    expect(text).toContain('Mar 20');
    expect(text).toContain('10d');
    expect(text).toContain('category');
    expect(text).toContain('activity');
    const hovers = await events(page, 'hover');
    expect(hovers.at(-1).detail.ids).toEqual(['iv-a']);

    // Moving within the same bar must not hide/re-show the tooltip.
    await clearEvents(page);
    await page.mouse.move(c.x + 20, c.y + 1);
    await page.mouse.move(c.x - 20, c.y - 1);
    await page.waitForTimeout(80);
    expect((await events(page, 'hover')).length).toBe(0);
    await expect(tip).toHaveAttribute('data-tl-visible', 'true');

    // Leaving hides it.
    const o = await canvasOrigin(page);
    await page.mouse.move(o.left + 5, o.top + o.height - 5);
    await page.waitForTimeout(80);
    await expect(tip).toHaveAttribute('data-tl-visible', 'false');
    expect((await events(page, 'hover')).at(-1).detail.ids).toEqual([]);
  });

  test('hovering an event shows type, date and track', async ({ page }) => {
    await create(page);
    const p = await eventPoint(page, 'ev-dot');
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(80);
    const text = await page.locator('.tl-tooltip').textContent();
    expect(text).toContain('Call');
    expect(text).toContain('call');
    expect(text).toContain('Mar 25');
    expect(text).toContain('7575859695');
    const g = await eventPoint(page, 'ev-global');
    await page.mouse.move(g.x, g.y + 3 * 40); // on the empty 'locked' row: the global line wins there
    await page.waitForTimeout(80);
    expect(await page.locator('.tl-tooltip').textContent()).toContain('Global');
  });

  test('tooltip stays inside the container near the right edge', async ({ page }) => {
    await create(page);
    const o = await canvasOrigin(page);
    const row = await page.evaluate(() => window.TL.instance.rowOf('phone-2'));
    await page.mouse.move(o.left + o.width - 3, o.top + row * 40 + 20); // iv-long is visible here
    await page.waitForTimeout(80);
    const tip = await page.locator('.tl-tooltip').boundingBox();
    const root = await page.locator('.tl-root').boundingBox();
    expect(tip.x + tip.width).toBeLessThanOrEqual(root.x + root.width + 1);
  });

  test('pointer selection: click, ctrl+click, shift+click, click on empty', async ({ page }) => {
    await create(page);
    await clearEvents(page);
    const a = await barCenter(page, 'iv-a');
    const b = await barCenter(page, 'iv-b');
    const dot = await eventPoint(page, 'ev-dot');
    await page.mouse.click(a.x, a.y);
    expect((await summary(page)).selection).toEqual({ ids: ['iv-a'], primaryId: 'iv-a' });
    await clickAt(page, b, ['Control']);
    expect((await summary(page)).selection).toEqual({ ids: ['iv-a', 'iv-b'], primaryId: 'iv-b' });
    await clickAt(page, dot, ['Shift']);
    expect((await summary(page)).selection.ids).toEqual(['iv-a', 'iv-b', 'ev-dot']);
    await clickAt(page, a, ['Control']);
    expect((await summary(page)).selection.ids).toEqual(['iv-b', 'ev-dot']);
    const empty = await trackPoint(page, 'locked', '2026-04-10T00:00:00Z');
    await page.mouse.click(empty.x, empty.y);
    expect((await summary(page)).selection).toEqual({ ids: [], primaryId: null });
    const sel = await events(page, 'selectionChange');
    expect(sel.length).toBe(5);
    expect(sel[0].detail).toMatchObject({ ids: ['iv-a'], primaryId: 'iv-a' });
    const clicks = await events(page, 'itemClick');
    expect(clicks.length).toBe(5);
    expect(clicks[0].detail).toMatchObject({ ids: ['iv-a'], kind: 'interval', trackId: 'phone-3' });
    expect(clicks[4].detail).toMatchObject({ ids: [], kind: 'track', trackId: 'locked' });
  });

  test('selection is drawn on the overlay and the label is highlighted', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    const o = await canvasOrigin(page);
    const before = await page.evaluate(([x, y]) => window.TL.paintedCount('overlay', x - 30, y - 10, 60, 20), [a.x - o.left, a.y - o.top]);
    await page.mouse.click(a.x, a.y);
    await settle(page);
    const after = await page.evaluate(([x, y]) => window.TL.paintedCount('overlay', x - 30, y - 10, 60, 20), [a.x - o.left, a.y - o.top]);
    expect(before).toBe(0);
    expect(after).toBeGreaterThan(50);
    await expect(page.locator('.tl-label[data-tl-selected="true"]')).toHaveText('9378312462');
  });

  test('programmatic selection does not emit and ignores unknown ids', async ({ page }) => {
    await create(page);
    await clearEvents(page);
    await page.evaluate(() => window.TL.instance.setSelection(['iv-a', 'ghost', 'ev-global'], { primary: 'iv-a' }));
    expect((await summary(page)).selection).toEqual({ ids: ['iv-a', 'ev-global'], primaryId: 'iv-a' });
    expect((await events(page, 'selectionChange')).length).toBe(0);
    await create(page, { selectable: false });
    const a = await barCenter(page, 'iv-a');
    await page.mouse.click(a.x, a.y);
    expect((await summary(page)).selection.ids).toEqual([]);
  });

  test('filters hide tracks and item types; selection is reconciled', async ({ page }) => {
    await create(page);
    await page.evaluate(() => window.TL.instance.setSelection(['iv-a', 'ev-dot']));
    await clearEvents(page);
    await page.evaluate(() => window.TL.instance.setFilters({ tracks: ['phone-1', 'phone-2'] }));
    await settle(page);
    let s = await summary(page);
    expect(s.labels).toEqual(['9373064574', '7575859695']);
    expect(s.selection).toEqual({ ids: ['ev-dot'], primaryId: 'ev-dot' });
    expect((await events(page, 'selectionChange')).length).toBe(1);

    await page.evaluate(() => window.TL.instance.setFilters({ eventTypes: ['alert'] }));
    await settle(page);
    s = await summary(page);
    expect(s.labels.length).toBe(4);
    expect(s.selection.ids).toEqual([]);
    const dotExists = await page.evaluate(() => window.TL.instance.index.eventById.has('ev-dot'));
    expect(dotExists).toBe(false);

    await page.evaluate(() => window.TL.instance.setFilters({ tracks: (t) => t.label.startsWith('93'), intervals: (i) => i.id !== 'iv-b' }));
    await settle(page);
    s = await summary(page);
    expect(s.labels).toEqual(['9373064574', '9378312462']);
    expect(await page.evaluate(() => window.TL.instance.index.intervalById.has('iv-b'))).toBe(false);
    await page.evaluate(() => window.TL.instance.setFilters(null));
    await settle(page);
    expect((await summary(page)).labels.length).toBe(4);
  });

  test('double-click emits itemDoubleClick and eventActivate; context menu is cancelable', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    await page.mouse.dblclick(a.x, a.y);
    expect((await events(page, 'itemDoubleClick')).at(-1).detail.ids).toEqual(['iv-a']);
    expect((await events(page, 'eventActivate')).at(-1).detail).toMatchObject({ id: 'iv-a', kind: 'interval', source: 'pointer' });

    await page.evaluate(() => window.TL.instance.on('contextMenu', (e) => e.preventDefault()));
    const prevented = await page.evaluate(([x, y]) => {
      const t = window.TL.instance;
      const r = t.nodes.canvasArea.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, button: 2 });
      t.nodes.canvasArea.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, [a.localX, a.localY]);
    expect(prevented).toBe(true);
    expect((await events(page, 'contextMenu')).at(-1).detail.ids).toEqual(['iv-a']);
  });

  test('shift+drag and right-drag select a time range', async ({ page }) => {
    await create(page);
    const o = await canvasOrigin(page);
    const y = o.top + 3 * 40 + 20;
    await drag(page, { x: o.left + 100, y }, { x: o.left + 300, y }, { modifiers: ['Shift'] });
    let r = (await events(page, 'rangeSelect')).at(-1).detail;
    const scale = await page.evaluate(() => window.TL.instance.getViewport());
    expect(r.start).toBeCloseTo(scale.start + 100 / scale.pxPerMs, -3);
    expect(r.end).toBeCloseTo(scale.start + 300 / scale.pxPerMs, -3);
    await drag(page, { x: o.left + 400, y }, { x: o.left + 350, y }, { button: 'right' });
    r = (await events(page, 'rangeSelect')).at(-1).detail;
    expect(r.end - r.start).toBeCloseTo(50 / scale.pxPerMs, -3);
    expect((await summary(page)).viewport.start).toBe(scale.start); // no pan happened
  });

  test('hit-testing priority: event marker wins over an interval underneath', async ({ page }) => {
    await create(page, {}, {
      tracks: [{ id: 't' }],
      intervals: [{ id: 'under', trackId: 't', start: '2026-03-05T00:00:00Z', end: '2026-03-30T00:00:00Z' }],
      events: [{ id: 'on-top', trackId: 't', date: '2026-03-15T00:00:00Z', marker: 'dot' }],
    });
    const p = await eventPoint(page, 'on-top');
    await page.mouse.click(p.x, p.y);
    expect((await summary(page)).selection.ids).toEqual(['on-top']);
    await page.mouse.click(p.x + 40, p.y);
    expect((await summary(page)).selection.ids).toEqual(['under']);
  });
});
