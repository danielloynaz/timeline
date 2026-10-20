import { describe, it, expect } from 'vitest';
import {
  MS,
  createTimeScale,
  timeToX,
  xToTime,
  durationToWidth,
  widthToDuration,
  pxPerMsForRange,
  visibleEnd,
  clipRange,
  rangesOverlap,
} from '../../src/core/time-scale.js';

const T0 = Date.UTC(2026, 2, 1); // 2026-03-01T00:00Z

describe('time-scale', () => {
  const scale = createTimeScale({ start: T0, pxPerMs: 100 / MS.day, origin: 160 });

  it('maps start to origin and is linear in elapsed time', () => {
    expect(timeToX(scale, T0)).toBe(160);
    expect(timeToX(scale, T0 + MS.day)).toBeCloseTo(260);
    expect(timeToX(scale, T0 + 10 * MS.day)).toBeCloseTo(1160);
    expect(timeToX(scale, T0 - MS.day)).toBeCloseTo(60);
  });

  it('is invertible', () => {
    for (const t of [T0, T0 + 1, T0 + 3.5 * MS.day, T0 - 40 * MS.day]) {
      expect(xToTime(scale, timeToX(scale, t))).toBeCloseTo(t, 6);
    }
    expect(timeToX(scale, xToTime(scale, 777.25))).toBeCloseTo(777.25, 9);
  });

  it('gives proportional widths independent of position', () => {
    const w1 = timeToX(scale, T0 + 7 * MS.day) - timeToX(scale, T0);
    const w2 = timeToX(scale, T0 + 50 * MS.day) - timeToX(scale, T0 + 43 * MS.day);
    expect(w1).toBeCloseTo(700);
    expect(w2).toBeCloseTo(w1);
    expect(durationToWidth(scale, 2 * MS.day)).toBeCloseTo(200);
    expect(widthToDuration(scale, 50)).toBeCloseTo(MS.day / 2);
  });

  it('computes pxPerMs for a target range and the visible end', () => {
    const p = pxPerMsForRange(T0, T0 + 10 * MS.day, 1000);
    const s = createTimeScale({ start: T0, pxPerMs: p });
    expect(visibleEnd(s, 1000)).toBeCloseTo(T0 + 10 * MS.day);
    expect(() => pxPerMsForRange(T0, T0, 100)).toThrow();
    expect(() => pxPerMsForRange(T0, T0 + 1, 0)).toThrow();
  });

  it('rejects invalid scales', () => {
    expect(() => createTimeScale({ start: NaN, pxPerMs: 1 })).toThrow();
    expect(() => createTimeScale({ start: 0, pxPerMs: 0 })).toThrow();
    expect(() => createTimeScale({ start: 0, pxPerMs: -1 })).toThrow();
  });

  describe('clipRange', () => {
    const s = createTimeScale({ start: T0, pxPerMs: 1 / MS.hour }); // 24px per day
    it('returns null when fully outside', () => {
      expect(clipRange(s, T0 - 2 * MS.day, T0 - MS.day, 0, 240)).toBeNull();
      expect(clipRange(s, T0 + 20 * MS.day, T0 + 21 * MS.day, 0, 240)).toBeNull();
    });
    it('keeps fully-visible ranges intact', () => {
      const r = clipRange(s, T0 + MS.day, T0 + 2 * MS.day, 0, 240);
      expect(r).toEqual({ x0: 24, x1: 48, clippedStart: T0 + MS.day, clippedEnd: T0 + 2 * MS.day });
    });
    it('clips partially visible ranges without touching source timestamps', () => {
      const start = T0 - MS.day;
      const end = T0 + 20 * MS.day;
      const r = clipRange(s, start, end, 0, 240);
      expect(r?.x0).toBe(0);
      expect(r?.x1).toBe(240);
      expect(r?.clippedStart).toBeCloseTo(T0);
      expect(r?.clippedEnd).toBeCloseTo(T0 + 10 * MS.day);
      expect(start).toBe(T0 - MS.day); // untouched
    });
  });

  it('rangesOverlap handles half-open ranges and points', () => {
    expect(rangesOverlap(0, 10, 10, 20)).toBe(false);
    expect(rangesOverlap(0, 11, 10, 20)).toBe(true);
    expect(rangesOverlap(5, 5, 0, 10)).toBe(true);
    expect(rangesOverlap(10, 10, 0, 10)).toBe(true);
    expect(rangesOverlap(11, 11, 0, 10)).toBe(false);
  });
});
