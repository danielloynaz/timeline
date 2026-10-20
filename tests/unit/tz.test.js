import { describe, it, expect } from 'vitest';
import {
  resolveTimeZone,
  toParts,
  getOffset,
  fromParts,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  addDays,
  addMonths,
  floorToUnit,
  addUnit,
} from '../../src/core/tz.js';
import { MS } from '../../src/core/time-scale.js';

const NY = 'America/New_York';
const MADRID = 'Europe/Madrid';

describe('tz', () => {
  it('resolves and validates time zones', () => {
    expect(resolveTimeZone(undefined)).toBe('UTC');
    expect(resolveTimeZone('UTC')).toBe('UTC');
    expect(resolveTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(() => resolveTimeZone('Mars/Olympus')).toThrow(/Unknown time zone/);
    expect(() => resolveTimeZone('')).toThrow();
  });

  it('toParts/fromParts round-trip in UTC', () => {
    const t = Date.UTC(2026, 2, 15, 13, 45, 30, 250);
    const p = toParts(t, 'UTC');
    expect(p).toMatchObject({ year: 2026, month: 3, day: 15, hour: 13, minute: 45, second: 30, millisecond: 250, weekday: 0 });
    expect(fromParts(p, 'UTC')).toBe(t);
  });

  it('computes offsets on both sides of US DST (2026-03-08 02:00 local)', () => {
    const before = Date.UTC(2026, 2, 8, 6, 59); // 01:59 EST
    const after = Date.UTC(2026, 2, 8, 7, 0); // 03:00 EDT
    expect(getOffset(before, NY)).toBe(-5 * MS.hour);
    expect(getOffset(after, NY)).toBe(-4 * MS.hour);
    expect(toParts(before, NY)).toMatchObject({ hour: 1, minute: 59 });
    expect(toParts(after, NY)).toMatchObject({ hour: 3, minute: 0 });
  });

  it('startOfDay is local midnight and spring-forward day is 23h long', () => {
    const noon = Date.UTC(2026, 2, 8, 16); // 12:00 EDT on DST day
    const midnight = startOfDay(noon, NY);
    expect(toParts(midnight, NY)).toMatchObject({ year: 2026, month: 3, day: 8, hour: 0, minute: 0 });
    expect(midnight).toBe(Date.UTC(2026, 2, 8, 5)); // 00:00 EST = 05:00Z
    const next = addDays(midnight, 1, NY);
    expect(next - midnight).toBe(23 * MS.hour);
  });

  it('fall-back day is 25h long in Europe/Madrid (2026-10-25)', () => {
    const d = startOfDay(Date.UTC(2026, 9, 25, 12), MADRID);
    expect(d).toBe(Date.UTC(2026, 9, 24, 22)); // 00:00 CEST = 22:00Z previous day
    const next = addDays(d, 1, MADRID);
    expect(next - d).toBe(25 * MS.hour);
    expect(toParts(next, MADRID)).toMatchObject({ month: 10, day: 26, hour: 0 });
  });

  it('resolves non-existent local times forward and ambiguous ones to the earlier instant', () => {
    // 02:30 on 2026-03-08 does not exist in New York -> 03:30 EDT
    const gap = fromParts({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, NY);
    expect(toParts(gap, NY)).toMatchObject({ hour: 3, minute: 30 });
    // 01:30 on 2026-11-01 happens twice in New York -> earlier (EDT, -4h)
    const amb = fromParts({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, NY);
    expect(getOffset(amb, NY)).toBe(-4 * MS.hour);
    expect(toParts(amb, NY)).toMatchObject({ hour: 1, minute: 30 });
  });

  it('handles leap day and year boundaries', () => {
    const leap = fromParts({ year: 2028, month: 2, day: 29 }, 'UTC');
    expect(toParts(leap, 'UTC')).toMatchObject({ year: 2028, month: 2, day: 29 });
    expect(toParts(addDays(leap, 1, 'UTC'), 'UTC')).toMatchObject({ month: 3, day: 1 });
    expect(toParts(addMonths(Date.UTC(2028, 0, 31), 1, 'UTC'), 'UTC')).toMatchObject({ month: 3, day: 2 }); // Date.UTC overflow
    const nye = Date.UTC(2026, 11, 31, 23, 59, 59);
    expect(toParts(addUnit(nye, 'minute', 1, 'UTC'), 'UTC')).toMatchObject({ year: 2027, month: 1, day: 1, hour: 0 });
  });

  it('computes week/month/quarter/year starts in a time zone', () => {
    const t = Date.UTC(2026, 2, 18, 12); // Wednesday 2026-03-18
    expect(toParts(startOfWeek(t, 'UTC'), 'UTC')).toMatchObject({ month: 3, day: 16, weekday: 1 });
    expect(toParts(startOfWeek(t, 'UTC', 0), 'UTC')).toMatchObject({ month: 3, day: 15, weekday: 0 });
    expect(startOfMonth(t, 'UTC')).toBe(Date.UTC(2026, 2, 1));
    expect(startOfQuarter(Date.UTC(2026, 4, 10), 'UTC')).toBe(Date.UTC(2026, 3, 1));
    expect(startOfYear(t, 'UTC')).toBe(Date.UTC(2026, 0, 1));
    // Madrid: local midnight of March 1st is 23:00Z on Feb 28th
    expect(startOfMonth(Date.UTC(2026, 2, 5), MADRID)).toBe(Date.UTC(2026, 1, 28, 23));
  });

  it('floorToUnit and addUnit cover all units', () => {
    const t = Date.UTC(2026, 2, 18, 13, 47, 11);
    expect(floorToUnit(t, 'minute', 'UTC', { step: 15 })).toBe(Date.UTC(2026, 2, 18, 13, 45));
    expect(floorToUnit(t, 'hour', 'UTC', { step: 6 })).toBe(Date.UTC(2026, 2, 18, 12));
    expect(floorToUnit(t, 'day', 'UTC')).toBe(Date.UTC(2026, 2, 18));
    expect(floorToUnit(t, 'week', 'UTC')).toBe(Date.UTC(2026, 2, 16));
    expect(floorToUnit(t, 'month', 'UTC')).toBe(Date.UTC(2026, 2, 1));
    expect(floorToUnit(t, 'month', 'UTC', { step: 3 })).toBe(Date.UTC(2026, 0, 1));
    expect(floorToUnit(t, 'quarter', 'UTC')).toBe(Date.UTC(2026, 0, 1));
    expect(floorToUnit(t, 'year', 'UTC')).toBe(Date.UTC(2026, 0, 1));
    expect(addUnit(Date.UTC(2026, 0, 1), 'quarter', 1, 'UTC')).toBe(Date.UTC(2026, 3, 1));
    expect(addUnit(Date.UTC(2026, 0, 1), 'year', 2, 'UTC')).toBe(Date.UTC(2028, 0, 1));
    expect(addUnit(Date.UTC(2026, 0, 1), 'week', 1, 'UTC')).toBe(Date.UTC(2026, 0, 8));
    expect(() => floorToUnit(t, /** @type {any} */ ('fortnight'), 'UTC')).toThrow();
  });

  it('hour steps across DST stay anchored to local midnight', () => {
    const day = startOfDay(Date.UTC(2026, 2, 8, 12), NY);
    expect(floorToUnit(day + 2.5 * MS.hour, 'hour', NY, { step: 1 })).toBe(day + 2 * MS.hour);
  });
});
