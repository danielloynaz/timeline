import { test } from '@playwright/test';
import { create, expect, summary, events, clearEvents, barCenter, trackPoint, canvasOrigin, drag, settle } from './helpers.js';

const iso = (ms) => new Date(ms).toISOString();

test.describe('interval editing', () => {
  test('moving an interval previews, commits a proposal and waits for host data', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    const px = (await summary(page)).viewport.pxPerMs;
    const dx = 100; // pixels
    await drag(page, { x: a.x, y: a.y }, { x: a.x + dx, y: a.y });
    await settle(page);
    const starts = await events(page, 'intervalEditStart');
    const previews = await events(page, 'intervalEditPreview');
    const commits = await events(page, 'intervalEditCommit');
    expect(starts.length).toBe(1);
    expect(starts[0].detail).toMatchObject({ operation: 'move', intervalId: 'iv-a', trackId: 'phone-3', isNew: false });
    expect(previews.length).toBeGreaterThan(2);
    expect(commits.length).toBe(1);
    const c = commits[0].detail;
    const expectedShift = dx / px;
    expect(c.start - Date.parse('2026-03-10T00:00:00Z')).toBeCloseTo(expectedShift, -4);
    expect(c.end - c.start).toBe(10 * 86400000);
    expect(c.original).toEqual({ start: Date.parse('2026-03-10T00:00:00Z'), end: Date.parse('2026-03-20T00:00:00Z') });

    // Source data untouched; edit pending; original hidden, preview drawn.
    const src = await page.evaluate(() => window.TL.instance.getData().intervals.find((i) => i.id === 'iv-a'));
    expect(src.start).toBe('2026-03-10T00:00:00.000Z');
    expect((await summary(page)).pending).toEqual(['iv-a']);
    const o = await canvasOrigin(page);
    const origPx = await page.evaluate(([x, y]) => window.TL.pixel('data', x, y), [a.localX - 40, a.localY]);
    expect(await page.evaluate((p) => window.TL.isOrange(p), origPx)).toBe(false);
    const previewPainted = await page.evaluate(([x, y]) => window.TL.paintedCount('overlay', x, y - 6, 40, 12), [a.localX + dx - 10, a.localY]);
    expect(previewPainted).toBeGreaterThan(100);
    void o;

    // Host persists and applies.
    await page.evaluate((d) => {
      window.TL.instance.updateData({ intervals: [{ id: 'iv-a', trackId: d.trackId, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), editable: true }] });
    }, c);
    await settle(page);
    expect((await summary(page)).pending).toEqual([]);
    const moved = await barCenter(page, 'iv-a');
    expect(moved.left - a.left).toBeCloseTo(dx, 0);
  });

  test('resizing from either edge', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    await drag(page, { x: a.right, y: a.y }, { x: a.right + 60, y: a.y });
    let c = (await events(page, 'intervalEditCommit')).at(-1).detail;
    expect(c.operation).toBe('resize-end');
    expect(c.start).toBe(Date.parse('2026-03-10T00:00:00Z'));
    expect(c.end).toBeGreaterThan(Date.parse('2026-03-20T00:00:00Z'));
    await page.evaluate(() => window.TL.instance.rejectEdit('iv-a'));
    expect((await events(page, 'intervalEditCancel')).at(-1).detail.reason).toBe('rejected');
    expect((await summary(page)).pending).toEqual([]);

    await drag(page, { x: a.left, y: a.y }, { x: a.left - 40, y: a.y });
    c = (await events(page, 'intervalEditCommit')).at(-1).detail;
    expect(c.operation).toBe('resize-start');
    expect(c.end).toBe(Date.parse('2026-03-20T00:00:00Z'));
    expect(c.start).toBeLessThan(Date.parse('2026-03-10T00:00:00Z'));
  });

  test('creating an interval by dragging on an empty editable track uses a temporary id', async ({ page }) => {
    await create(page, { snap: '1d' });
    const from = await trackPoint(page, 'phone-1', '2026-04-01T00:00:00Z');
    const to = await trackPoint(page, 'phone-1', '2026-04-08T00:00:00Z');
    await drag(page, from, to);
    const c = (await events(page, 'intervalEditCommit')).at(-1).detail;
    expect(c).toMatchObject({ operation: 'create', isNew: true, intervalId: null, trackId: 'phone-1' });
    expect(c.tempId).toMatch(/^tmp-\d+$/);
    expect(iso(c.start)).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(c.end)).toBe('2026-04-08T00:00:00.000Z');
    expect((await summary(page)).pending).toEqual([c.tempId]);
    await page.evaluate((d) => {
      window.TL.instance.updateData({ intervals: [{ id: 'new-1', trackId: d.trackId, start: d.start, end: d.end }], replaceIds: { [d.tempId]: 'new-1' } });
    }, c);
    await settle(page);
    expect((await summary(page)).pending).toEqual([]);
    expect(await page.evaluate(() => window.TL.instance.index.intervalById.has('new-1'))).toBe(true);
    // The viewport did not pan during creation.
    expect(iso((await summary(page)).viewport.start)).toBe('2026-03-01T00:00:00.000Z');
  });

  test('Escape and pointer cancellation abort an edit without committing', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    await drag(page, { x: a.x, y: a.y }, { x: a.x + 80, y: a.y }, { release: false });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await settle(page);
    expect((await events(page, 'intervalEditCommit')).length).toBe(0);
    expect((await events(page, 'intervalEditCancel')).at(-1).detail.reason).toBe('escape');
    expect((await summary(page)).pending).toEqual([]);
    const still = await barCenter(page, 'iv-a');
    expect(still.left).toBeCloseTo(a.left, 0);

    await clearEvents(page);
    await page.evaluate(([x, y]) => {
      const area = window.TL.instance.nodes.canvasArea;
      const r = area.getBoundingClientRect();
      const common = { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      area.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: r.left + x, clientY: r.top + y }));
      area.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: r.left + x + 30, clientY: r.top + y }));
      area.dispatchEvent(new PointerEvent('pointercancel', { ...common, clientX: r.left + x + 30, clientY: r.top + y }));
    }, [a.localX, a.localY]);
    await settle(page);
    expect((await events(page, 'intervalEditStart')).length).toBe(1);
    expect((await events(page, 'intervalEditCancel')).at(-1).detail.reason).toBe('pointercancel');
    expect((await events(page, 'intervalEditCommit')).length).toBe(0);
  });

  test('editing can be disabled globally, per interval and per track', async ({ page }) => {
    await create(page);
    const locked = await barCenter(page, 'iv-locked');
    const before = (await summary(page)).viewport.start;
    await drag(page, { x: locked.x, y: locked.y }, { x: locked.x + 80, y: locked.y });
    await settle(page);
    expect((await events(page, 'intervalEditStart')).length).toBe(0);
    expect((await summary(page)).viewport.start).toBeLessThan(before); // the drag panned instead
    const t1 = await trackPoint(page, 'locked', '2026-04-01T00:00:00Z');
    await drag(page, t1, { x: t1.x + 80, y: t1.y });
    expect((await events(page, 'intervalEditStart')).length).toBe(0);

    await create(page, { editable: false });
    const a = await barCenter(page, 'iv-a');
    await drag(page, { x: a.x, y: a.y }, { x: a.x + 80, y: a.y });
    expect((await events(page, 'intervalEditStart')).length).toBe(0);
  });

  test('destroying during an edit cancels it and a full setData clears pending edits', async ({ page }) => {
    await create(page);
    const a = await barCenter(page, 'iv-a');
    await drag(page, { x: a.x, y: a.y }, { x: a.x + 80, y: a.y }, { release: false });
    await page.evaluate(() => window.TL.instance.destroy());
    await page.mouse.up();
    expect((await events(page, 'intervalEditCancel')).at(-1).detail.reason).toBe('destroyed');
    expect(await page.evaluate(() => document.querySelectorAll('#host .tl-root').length)).toBe(0);

    await create(page);
    const b = await barCenter(page, 'iv-b');
    await drag(page, { x: b.x, y: b.y }, { x: b.x + 50, y: b.y });
    expect((await summary(page)).pending).toEqual(['iv-b']);
    await page.evaluate(() => window.TL.instance.setData(window.TL.DATA));
    expect((await summary(page)).pending).toEqual([]);
  });
});
