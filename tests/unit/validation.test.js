import { describe, it, expect } from 'vitest';
import { normalizeOptions, validateData, applyPatch, toEpoch, DEFAULT_OPTIONS } from '../../src/core/validation.js';
import { TimelineError } from '../../src/core/errors.js';

const baseOptions = { startDate: '2026-03-01T00:00:00Z', endDate: '2026-05-31T23:59:59Z' };

describe('normalizeOptions', () => {
  it('fills defaults and resolves the domain', () => {
    const o = normalizeOptions(baseOptions);
    expect(o.domainStart).toBe(Date.parse(baseOptions.startDate));
    expect(o.domainEnd).toBe(Date.parse(baseOptions.endDate));
    expect(o.rowHeight).toBe(DEFAULT_OPTIONS.rowHeight);
    expect(o.timeZone).toBe('UTC');
    expect(o.zoom.initial).toBe('week');
    expect(Object.isFrozen(o)).toBe(true);
  });

  it('merges zoom options and custom presets', () => {
    const o = normalizeOptions({ ...baseOptions, zoom: { initial: 'month', presets: { month: 5 } } });
    expect(o.zoom.min).toBe('day');
    expect(o.zoom.presets.month).toBe(5);
    expect(o.zoom.presets.day).toBe(60);
  });

  it.each([
    [{}, /startDate and options.endDate are required/],
    [{ startDate: 'nope', endDate: '2026-01-01' }, /startDate is not a valid/],
    [{ startDate: '2026-02-01', endDate: '2026-01-01' }, /endDate must be after/],
    [{ ...baseOptions, renderMode: 'svg' }, /not supported/],
    [{ ...baseOptions, theme: 'blue' }, /theme/],
    [{ ...baseOptions, rowHeight: -1 }, /rowHeight/],
    [{ ...baseOptions, barHeight: 100 }, /barHeight cannot exceed/],
    [{ ...baseOptions, timeZone: 'Nowhere/City' }, /Unknown time zone/],
    [{ ...baseOptions, locale: 'xx-INVALID-@@' }, /locale/i],
    [{ ...baseOptions, zoom: { initial: 'decade' } }, /zoom.initial/],
    [{ ...baseOptions, zoom: { min: 'quarter', max: 'day' } }, /zoom.min must be a finer/],
    [{ ...baseOptions, zoom: { initial: 'year' } }, /zoom.initial must lie between/],
    [{ ...baseOptions, snap: 'soon' }, /snap increment/],
    [{ ...baseOptions, trackOrder: 'random' }, /trackOrder/],
    [{ ...baseOptions, editable: 'yes' }, /editable must be a boolean/],
    [{ ...baseOptions, weekStartsOn: 9 }, /weekStartsOn/],
  ])('rejects invalid options %#', (options, re) => {
    expect(() => normalizeOptions(/** @type {any} */ (options))).toThrow(re);
    try {
      normalizeOptions(/** @type {any} */ (options));
    } catch (e) {
      expect(e).toBeInstanceOf(TimelineError);
      expect(/** @type {TimelineError} */ (e).code).toMatch(/INVALID_CONFIG|INVALID_TIMESTAMP/);
    }
  });
});

describe('toEpoch', () => {
  it('accepts ISO strings, numbers and Dates', () => {
    expect(toEpoch('2026-03-01T00:00:00Z', 'x')).toBe(Date.UTC(2026, 2, 1));
    expect(toEpoch(123, 'x')).toBe(123);
    expect(toEpoch(new Date(5), 'x')).toBe(5);
  });
  it('rejects garbage', () => {
    for (const v of ['', 'tomorrow', NaN, null, undefined, {}, new Date('x')]) {
      expect(() => toEpoch(v, 'start', 'interval "a": ')).toThrow(/interval "a": start is not a valid/);
    }
  });
});

describe('validateData', () => {
  const data = {
    tracks: [
      { id: 'phone-1', label: '9373064574' },
      { id: 'phone-2', label: '7575859695', order: 0 },
      { id: 3, visible: false },
    ],
    intervals: [
      { id: 'i1', trackId: 'phone-1', start: '2026-03-20T00:00:00Z', end: '2026-03-27T00:00:00Z', color: '#e98200', editable: true, metadata: { a: 1 } },
      { id: 'i2', trackId: 3, start: 0, end: 10 },
    ],
    events: [
      { id: 'e1', date: '2026-03-16T00:00:00Z', scope: 'global', type: 'activity', marker: 'line' },
      { id: 'e2', date: '2026-03-16T00:00:00Z', trackId: 'phone-2' },
      { id: 'e3', start: '2026-03-10T00:00:00Z', end: '2026-03-12T00:00:00Z', scope: 'global' },
    ],
  };

  it('normalizes without mutating the input', () => {
    const snapshot = JSON.stringify(data);
    const out = validateData(data);
    expect(JSON.stringify(data)).toBe(snapshot);
    expect(out.tracks.map((t) => t.id)).toEqual(['phone-1', 'phone-2', '3']);
    expect(out.tracks[2].label).toBe('3');
    expect(out.tracks[2].visible).toBe(false);
    expect(out.tracks[1].order).toBe(0);
    expect(out.tracks[0].order).toBe(0); // index
    expect(out.intervals[0]).toMatchObject({ kind: 'interval', trackId: 'phone-1', start: Date.UTC(2026, 2, 20), end: Date.UTC(2026, 2, 27), editable: true });
    expect(out.intervals[0].source).toBe(data.intervals[0]);
    expect(out.intervals[1].trackId).toBe('3');
    expect(out.events[0]).toMatchObject({ scope: 'global', trackId: null, marker: 'line', isRange: false, time: Date.UTC(2026, 2, 16) });
    expect(out.events[1]).toMatchObject({ scope: 'track', trackId: 'phone-2', type: 'default', marker: 'dot' });
    expect(out.events[2]).toMatchObject({ isRange: true, start: Date.UTC(2026, 2, 10), end: Date.UTC(2026, 2, 12) });
    expect(out.orphans).toEqual({ intervals: [], events: [] });
  });

  it('accepts empty or missing collections', () => {
    expect(validateData(undefined).tracks).toEqual([]);
    expect(validateData({}).events).toEqual([]);
    expect(() => validateData(/** @type {any} */ ([]))).toThrow(/expects an object/);
    expect(() => validateData(/** @type {any} */ ({ tracks: 'x' }))).toThrow(/must be an array/);
  });

  it('separates unknown-track items as orphans instead of throwing', () => {
    const out = validateData({
      tracks: [{ id: 't' }],
      intervals: [{ id: 'ok', trackId: 't', start: 0, end: 1 }, { id: 'lost', trackId: 'ghost', start: 0, end: 1 }],
      events: [{ id: 'g', date: 0, scope: 'global' }, { id: 'lost-e', date: 0, trackId: 'ghost' }],
    });
    expect(out.intervals.map((i) => i.id)).toEqual(['ok']);
    expect(out.events.map((e) => e.id)).toEqual(['g']);
    expect(out.orphans.intervals.map((i) => i.id)).toEqual(['lost']);
    expect(out.orphans.events.map((e) => e.id)).toEqual(['lost-e']);
  });

  it.each([
    [{ tracks: [{ id: 'a' }, { id: 'a' }] }, 'DUPLICATE_ID', /tracks: a/],
    [{ tracks: [{ id: 't' }], intervals: [{ id: 'x', trackId: 't', start: 0, end: 1 }], events: [{ id: 'x', date: 0, scope: 'global' }] }, 'DUPLICATE_ID', /intervals\/events: x/],
    [{ tracks: [{ label: 'no id' }] }, 'MISSING_FIELD', /tracks\[0\] is missing a valid "id"/],
    [{ intervals: [{ id: 'i', start: 0, end: 1 }] }, 'MISSING_FIELD', /missing "trackId"/],
    [{ intervals: [{ id: 'i', trackId: 't', start: 'bad', end: 1 }] }, 'INVALID_TIMESTAMP', /interval "i": start/],
    [{ intervals: [{ id: 'i', trackId: 't', start: 5, end: 5 }] }, 'INVALID_RANGE', /strictly earlier/],
    [{ intervals: [{ id: 'i', trackId: 't', start: 6, end: 5 }] }, 'INVALID_RANGE', /strictly earlier/],
    [{ events: [{ id: 'e', scope: 'track' }] }, 'MISSING_FIELD', /no "trackId"/],
    [{ events: [{ id: 'e', scope: 'global' }] }, 'MISSING_FIELD', /missing "date"/],
    [{ events: [{ id: 'e', scope: 'sideways', date: 0 }] }, 'INVALID_TYPE', /scope/],
    [{ events: [{ id: 'e', scope: 'global', date: 0, marker: 'star' }] }, 'INVALID_TYPE', /marker/],
    [{ events: [{ id: 'e', trackId: 't', start: 0, end: 1 }] }, 'INVALID_TYPE', /only global events may have start\/end/],
    [{ events: [{ id: 'e', scope: 'global', start: 2, end: 1 }] }, 'INVALID_RANGE', /strictly earlier/],
    [{ tracks: [{ id: 't', metadata: 4 }] }, 'INVALID_TYPE', /metadata must be an object/],
    [{ tracks: [{ id: 't', order: 'first' }] }, 'INVALID_TYPE', /order must be a number/],
  ])('throws a TimelineError for structural error %#', (input, code, re) => {
    let err;
    try {
      validateData(/** @type {any} */ (input));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TimelineError);
    expect(/** @type {TimelineError} */ (err).code).toBe(code);
    expect(/** @type {TimelineError} */ (err).message).toMatch(re);
  });
});

describe('applyPatch', () => {
  const current = {
    tracks: [{ id: 't1' }, { id: 't2' }],
    intervals: [{ id: 'a', trackId: 't1', start: 0, end: 1 }, { id: 'tmp-1', trackId: 't1', start: 2, end: 3 }],
    events: [{ id: 'e', date: 0, scope: 'global' }],
  };

  it('upserts, removes and renames without mutating the current collections', () => {
    const snapshot = JSON.stringify(current);
    const next = applyPatch(current, {
      tracks: [{ id: 't3' }, { id: 't1', label: 'renamed' }],
      intervals: [{ id: 'a', trackId: 't2', start: 5, end: 6 }],
      remove: { tracks: ['t2'], events: ['e'] },
      replaceIds: { 'tmp-1': 'real-1' },
    });
    expect(JSON.stringify(current)).toBe(snapshot);
    expect(next.tracks).toEqual([{ id: 't1', label: 'renamed' }, { id: 't3' }]);
    expect(next.intervals).toEqual([{ id: 'a', trackId: 't2', start: 5, end: 6 }, { id: 'real-1', trackId: 't1', start: 2, end: 3 }]);
    expect(next.events).toEqual([]);
  });

  it('rejects non-object patches', () => {
    expect(() => applyPatch(current, /** @type {any} */ (null))).toThrow(/patch object/);
  });
});
