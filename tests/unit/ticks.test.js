import { describe, it, expect } from 'vitest';
import { TICK_LEVELS, chooseTickLevel, generateTicks, unitBoundaries } from '../../src/core/ticks.js';
import { createFormatter } from '../../src/core/format.js';
import { MS } from '../../src/core/time-scale.js';
import { ZOOM_PRESETS, presetToPxPerMs } from '../../src/core/viewport.js';

const fmt = createFormatter('en-US', 'UTC');

describe('ticks', () => {
  it('levels are ordered from fine to coarse', () => {
    for (let i = 1; i < TICK_LEVELS.length; i++) {
      expect(TICK_LEVELS[i].approxMs).toBeGreaterThan(TICK_LEVELS[i - 1].approxMs);
    }
  });

  it('chooses week ticks grouped by month at the "week" preset', () => {
    const lvl = chooseTickLevel(presetToPxPerMs('week', ZOOM_PRESETS));
    expect(lvl.minor).toEqual({ unit: 'week', step: 1 });
    expect(lvl.major).toEqual({ unit: 'month', step: 1 });
  });

  it('picks the expected minor unit for each preset', () => {
    expect(chooseTickLevel(presetToPxPerMs('day')).minor.unit).toBe('day');
    expect(chooseTickLevel(presetToPxPerMs('month')).minor.unit).toBe('month');
    expect(chooseTickLevel(presetToPxPerMs('quarter')).minor).toEqual({ unit: 'month', step: 3 });
    expect(chooseTickLevel(presetToPxPerMs('hour')).minor.unit).toBe('hour');
    expect(chooseTickLevel(1e-12).minor.unit).toBe('year'); // absurdly zoomed out -> coarsest
  });

  it('unitBoundaries includes one boundary before start and one after end', () => {
    const start = Date.UTC(2026, 2, 10);
    const end = Date.UTC(2026, 2, 25);
    const b = unitBoundaries(start, end, 'week', 1, 'UTC', 1);
    expect(b[0]).toBe(Date.UTC(2026, 2, 9)); // Monday before
    expect(b[b.length - 1]).toBeGreaterThan(end);
    expect(b).toEqual([Date.UTC(2026, 2, 9), Date.UTC(2026, 2, 16), Date.UTC(2026, 2, 23), Date.UTC(2026, 2, 30)]);
  });

  it('generates the reference layout: weekly minor ticks with day numbers, month spans', () => {
    const start = Date.UTC(2026, 1, 14);
    const end = Date.UTC(2026, 4, 6);
    const ticks = generateTicks({ start, end, pxPerMs: presetToPxPerMs('week'), timeZone: 'UTC', formatter: fmt });
    expect(ticks.level.minor.unit).toBe('week');
    expect(ticks.minor[0].time).toBe(Date.UTC(2026, 1, 16));
    expect(ticks.minor.map((t) => t.label).slice(0, 4)).toEqual(['16', '23', '2', '9']);
    expect(ticks.major.map((m) => m.label)).toEqual(['February 2026', 'March 2026', 'April 2026', 'May 2026']);
    expect(ticks.major[1]).toMatchObject({ start: Date.UTC(2026, 2, 1), end: Date.UTC(2026, 3, 1) });
    for (const t of ticks.minor) {
      expect(t.time).toBeGreaterThanOrEqual(start);
      expect(t.time).toBeLessThanOrEqual(end);
    }
  });

  it('respects the time zone for day boundaries', () => {
    const start = Date.UTC(2026, 2, 7, 0);
    const end = Date.UTC(2026, 2, 10, 0);
    const ny = createFormatter('en-US', 'America/New_York');
    const ticks = generateTicks({ start, end, pxPerMs: 60 / MS.day, timeZone: 'America/New_York', formatter: ny });
    expect(ticks.level.minor.unit).toBe('day');
    // Local midnights: Mar 7 (05:00Z, EST), Mar 8 (05:00Z), Mar 9 (04:00Z, EDT)
    expect(ticks.minor.map((t) => t.time)).toEqual([Date.UTC(2026, 2, 7, 5), Date.UTC(2026, 2, 8, 5), Date.UTC(2026, 2, 9, 4)]);
  });

  it('year level has no major spans', () => {
    const ticks = generateTicks({
      start: Date.UTC(2020, 0, 1),
      end: Date.UTC(2030, 0, 1),
      pxPerMs: 60 / MS.year,
      timeZone: 'UTC',
      formatter: fmt,
    });
    expect(ticks.level.minor.unit).toBe('year');
    expect(ticks.major).toEqual([]);
    expect(ticks.minor.map((t) => t.label)).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030']);
  });

  it('formats hour ticks with locale', () => {
    const es = createFormatter('es-ES', 'UTC');
    const ticks = generateTicks({
      start: Date.UTC(2026, 2, 1, 0),
      end: Date.UTC(2026, 2, 1, 6),
      pxPerMs: 60 / MS.hour,
      timeZone: 'UTC',
      formatter: es,
    });
    expect(ticks.level.minor.unit).toBe('hour');
    expect(ticks.minor.length).toBe(7);
    expect(ticks.major[0].label).toMatch(/1 mar/);
  });
});
