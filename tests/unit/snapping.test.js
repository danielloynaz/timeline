import { describe, it, expect } from 'vitest';
import { parseIncrement, snapTime, createSnapper } from '../../src/core/snapping.js';
import { MS } from '../../src/core/time-scale.js';

describe('snapping', () => {
  it('parses increments', () => {
    expect(parseIncrement(null)).toBe(0);
    expect(parseIncrement(0)).toBe(0);
    expect(parseIncrement(5000)).toBe(5000);
    expect(parseIncrement('15m')).toBe(15 * MS.minute);
    expect(parseIncrement('1h')).toBe(MS.hour);
    expect(parseIncrement('2d')).toBe(2 * MS.day);
    expect(parseIncrement('1w')).toBe(MS.week);
    expect(parseIncrement('500ms')).toBe(500);
    expect(() => parseIncrement('soon')).toThrow(/Invalid snap increment/);
    expect(() => parseIncrement(-1)).toThrow();
    expect(() => parseIncrement(/** @type {any} */ ({}))).toThrow();
  });

  it('snaps sub-day increments relative to local midnight', () => {
    const t = Date.UTC(2026, 2, 10, 13, 37);
    expect(snapTime(t, 15 * MS.minute, 'UTC')).toBe(Date.UTC(2026, 2, 10, 13, 30));
    expect(snapTime(t, 15 * MS.minute, 'UTC', 'ceil')).toBe(Date.UTC(2026, 2, 10, 13, 45));
    expect(snapTime(t, MS.hour, 'UTC', 'floor')).toBe(Date.UTC(2026, 2, 10, 13));
    // Kolkata is UTC+5:30 -> whole local hours are at :30 UTC
    expect(snapTime(t, MS.hour, 'Asia/Kolkata')).toBe(Date.UTC(2026, 2, 10, 13, 30));
  });

  it('snaps whole-day increments to local midnights across DST', () => {
    const t = Date.UTC(2026, 2, 8, 20); // 16:00 EDT on spring-forward day
    const snapped = snapTime(t, MS.day, 'America/New_York');
    expect(snapped).toBe(Date.UTC(2026, 2, 9, 4)); // next local midnight (EDT)
    expect(snapTime(t, MS.day, 'America/New_York', 'floor')).toBe(Date.UTC(2026, 2, 8, 5));
    expect(snapTime(Date.UTC(2026, 2, 8, 5), MS.day, 'America/New_York', 'ceil')).toBe(Date.UTC(2026, 2, 8, 5));
  });

  it('createSnapper returns identity when disabled', () => {
    const id = createSnapper({ increment: null, timeZone: 'UTC' });
    expect(id(12345)).toBe(12345);
    const snap = createSnapper({ increment: '1d', timeZone: 'UTC' });
    expect(snap(Date.UTC(2026, 2, 10, 13))).toBe(Date.UTC(2026, 2, 11));
  });
});
