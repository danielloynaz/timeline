import { describe, it, expect } from 'vitest';
import {
  ZOOM_PRESETS,
  presetToPxPerMs,
  nearestPreset,
  createViewportState,
  viewportEnd,
  setRange,
  zoomBy,
  panByPixels,
  panByTime,
  resizeViewport,
  fitRange,
  toTimeScale,
  setScale,
} from '../../src/core/viewport.js';
import { MS, timeToX, xToTime } from '../../src/core/time-scale.js';

const D0 = Date.UTC(2026, 2, 1);
const D1 = Date.UTC(2026, 4, 31, 23, 59, 59);

function base(overrides = {}) {
  return createViewportState({
    domainStart: D0,
    domainEnd: D1,
    width: 1000,
    pxPerMs: presetToPxPerMs('week'),
    minPxPerMs: presetToPxPerMs('quarter'),
    maxPxPerMs: presetToPxPerMs('day'),
    ...overrides,
  });
}

describe('viewport', () => {
  it('presets map to px/ms and back', () => {
    expect(presetToPxPerMs('day')).toBeCloseTo(ZOOM_PRESETS.day / MS.day);
    expect(nearestPreset(presetToPxPerMs('month'))).toBe('month');
    expect(nearestPreset(presetToPxPerMs('week') * 1.2)).toBe('week');
    expect(() => presetToPxPerMs('fortnight')).toThrow();
  });

  it('starts at the domain start and clamps inside the domain', () => {
    const v = base();
    expect(v.start).toBe(D0);
    expect(viewportEnd(v)).toBeLessThanOrEqual(D1);
    const late = panByTime(v, 400 * MS.day);
    expect(viewportEnd(late)).toBeCloseTo(D1, 3);
    const early = panByTime(v, -400 * MS.day);
    expect(early.start).toBe(D0);
  });

  it('never shows more than the whole domain', () => {
    const v = base({ minPxPerMs: 1e-12, pxPerMs: 1e-12 });
    expect(v.start).toBe(D0);
    expect(viewportEnd(v)).toBeCloseTo(D1, 3);
  });

  it('setRange shows the requested range when it fits the bounds', () => {
    const s = Date.UTC(2026, 2, 10);
    const e = Date.UTC(2026, 3, 20);
    const v = setRange(base(), s, e);
    expect(v.start).toBe(s);
    expect(viewportEnd(v)).toBeCloseTo(e, 3);
    expect(() => setRange(base(), e, s)).toThrow();
  });

  it('setRange is clamped by zoom bounds', () => {
    const v = setRange(base(), D0, D0 + MS.hour); // asks for far more zoom than "day" allows
    expect(v.pxPerMs).toBeCloseTo(presetToPxPerMs('day'));
  });

  it('zoomBy keeps the time under the anchor fixed', () => {
    const v = setRange(base(), Date.UTC(2026, 2, 10), Date.UTC(2026, 3, 20));
    const anchorX = 300;
    const tBefore = xToTime(toTimeScale(v), anchorX);
    const z = zoomBy(v, 1.5, anchorX);
    expect(z.pxPerMs).toBeCloseTo(v.pxPerMs * 1.5);
    expect(xToTime(toTimeScale(z), anchorX)).toBeCloseTo(tBefore, 3);
    const back = zoomBy(z, 1 / 1.5, anchorX);
    expect(back.start).toBeCloseTo(v.start, 3);
  });

  it('zoomBy respects min and max bounds', () => {
    const v = base();
    expect(zoomBy(v, 1e6).pxPerMs).toBeCloseTo(presetToPxPerMs('day'));
    expect(zoomBy(v, 1e-6).pxPerMs).toBeCloseTo(presetToPxPerMs('quarter'));
    expect(setScale(v, presetToPxPerMs('month')).pxPerMs).toBeCloseTo(presetToPxPerMs('month'));
    expect(() => zoomBy(v, 0)).toThrow();
  });

  it('pans by pixels using the scale and clamps at domain edges', () => {
    const v = setRange(base(), Date.UTC(2026, 2, 10), Date.UTC(2026, 3, 20));
    const p = panByPixels(v, 100);
    expect(p.start - v.start).toBeCloseTo(100 / v.pxPerMs, 3);
    const far = panByPixels(v, -1e9);
    expect(far.start).toBe(D0);
  });

  it('resize keeps start and scale, re-clamping the end', () => {
    const v = setRange(base(), Date.UTC(2026, 2, 10), Date.UTC(2026, 3, 20));
    const r = resizeViewport(v, 500);
    expect(r.start).toBe(v.start);
    expect(r.pxPerMs).toBe(v.pxPerMs);
    expect(viewportEnd(r) - r.start).toBeCloseTo((viewportEnd(v) - v.start) / 2, 3);
    const zero = resizeViewport(v, 0);
    expect(zero.width).toBe(1);
  });

  it('fitRange pads the range and handles single instants', () => {
    const s = Date.UTC(2026, 2, 10);
    const e = Date.UTC(2026, 3, 10);
    const v = fitRange(base({ minPxPerMs: 1e-12, maxPxPerMs: 1e9 }), s, e, 0.1);
    expect(v.start).toBeCloseTo(s - 0.1 * (e - s), 3);
    expect(viewportEnd(v)).toBeCloseTo(e + 0.1 * (e - s), 3);
    const point = fitRange(base({ minPxPerMs: 1e-12, maxPxPerMs: 1e9 }), s, s);
    expect(viewportEnd(point) - point.start).toBeCloseTo(MS.day * 1.04, 3);
  });

  it('toTimeScale shares the same transformation as rendering', () => {
    const v = base();
    const scale = toTimeScale(v, 160);
    expect(timeToX(scale, v.start)).toBe(160);
    expect(timeToX(scale, viewportEnd(v))).toBeCloseTo(160 + v.width);
  });

  it('rejects an empty domain', () => {
    expect(() => createViewportState({ domainStart: D0, domainEnd: D0, width: 100, pxPerMs: 1 })).toThrow();
  });
});
