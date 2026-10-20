import { describe, it, expect } from 'vitest';
import { lowerBound, upperBound, buildRangeIndex, buildPointIndex, buildDataIndex, computeTrackRows } from '../../src/core/data-index.js';
import { validateData } from '../../src/core/validation.js';

describe('binary search helpers', () => {
  const arr = [1, 3, 3, 5, 9];
  it('lowerBound / upperBound', () => {
    expect(lowerBound(arr, 0)).toBe(0);
    expect(lowerBound(arr, 3)).toBe(1);
    expect(upperBound(arr, 3)).toBe(3);
    expect(lowerBound(arr, 10)).toBe(5);
    expect(upperBound(arr, 9)).toBe(5);
    expect(lowerBound([], 1)).toBe(0);
  });
});

describe('buildRangeIndex', () => {
  const items = [
    { id: 'long', start: 0, end: 100 },
    { id: 'a', start: 10, end: 20 },
    { id: 'b', start: 15, end: 25 },
    { id: 'c', start: 30, end: 40 },
    { id: 'd', start: 90, end: 95 },
  ];
  const idx = buildRangeIndex(items);

  it('sorts by start then id and keeps a running max end', () => {
    expect(idx.items.map((i) => i.id)).toEqual(['long', 'a', 'b', 'c', 'd']);
    expect(Array.from(idx.maxEnd)).toEqual([100, 100, 100, 100, 100]);
  });

  it('answers overlap queries including long intervals that start before the window', () => {
    expect(idx.query(50, 60).map((i) => i.id)).toEqual(['long']);
    expect(idx.query(18, 32).map((i) => i.id)).toEqual(['long', 'a', 'b', 'c']);
    expect(idx.query(20, 30).map((i) => i.id)).toEqual(['long', 'b']); // half-open: a ends at 20, c starts at 30
    expect(idx.query(200, 300)).toEqual([]);
    expect(idx.query(5, 5)).toEqual([]);
  });

  it('matches a brute force oracle on random data', () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const data = Array.from({ length: 500 }, (_, i) => {
      const s = Math.floor(rnd() * 10000);
      return { id: `r${i}`, start: s, end: s + 1 + Math.floor(rnd() * (rnd() < 0.05 ? 5000 : 200)) };
    });
    const index = buildRangeIndex(data);
    for (let q = 0; q < 200; q++) {
      const a = Math.floor(rnd() * 10000);
      const b = a + Math.floor(rnd() * 800);
      const expected = data
        .filter((d) => d.start < b && d.end > a)
        .sort((x, y) => x.start - y.start || (x.id < y.id ? -1 : 1))
        .map((d) => d.id);
      expect(index.query(a, b).map((d) => d.id)).toEqual(expected);
    }
  });
});

describe('buildPointIndex', () => {
  it('returns inclusive range matches in time order', () => {
    const idx = buildPointIndex([
      { id: 'c', time: 30 },
      { id: 'a', time: 10 },
      { id: 'b', time: 10 },
    ]);
    expect(idx.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(idx.query(10, 10).map((i) => i.id)).toEqual(['a', 'b']);
    expect(idx.query(11, 30).map((i) => i.id)).toEqual(['c']);
    expect(idx.query(31, 40)).toEqual([]);
  });
});

describe('buildDataIndex + computeTrackRows', () => {
  const data = validateData({
    tracks: [
      { id: 'p1', label: 'B' },
      { id: 'p2', label: 'A', order: 5 },
      { id: 'p3', label: 'C', visible: false },
      { id: 'p4', label: 'D' },
    ],
    intervals: [
      { id: 'i1', trackId: 'p1', start: 100, end: 200 },
      { id: 'i2', trackId: 'p2', start: 50, end: 60 },
      { id: 'i3', trackId: 'p1', start: 150, end: 400 },
    ],
    events: [
      { id: 'e1', trackId: 'p2', date: 300 },
      { id: 'g1', scope: 'global', date: 120, marker: 'line' },
      { id: 'g2', scope: 'global', start: 10, end: 20 },
    ],
  });
  const index = buildDataIndex(data);

  it('indexes by id and track and computes the data range', () => {
    expect(index.intervalById.get('i3')?.trackId).toBe('p1');
    expect(index.eventById.get('g1')?.scope).toBe('global');
    expect(index.dataRange).toEqual({ start: 10, end: 400 });
    expect(index.byTrack.get('p1')).toMatchObject({ first: 100, last: 400 });
    expect(index.byTrack.get('p2')).toMatchObject({ first: 50, last: 300 });
    expect(index.byTrack.get('p4')).toMatchObject({ first: Infinity, last: -Infinity });
  });

  it('queries rows and global items', () => {
    expect(index.queryRow('p1', 180, 190).intervals.map((i) => i.id)).toEqual(['i1', 'i3']);
    expect(index.queryRow('p2', 0, 1000).events.map((e) => e.id)).toEqual(['e1']);
    expect(index.queryRow('nope', 0, 1000)).toEqual({ intervals: [], events: [] });
    expect(index.queryGlobal(0, 15)).toMatchObject({ points: [], ranges: [expect.objectContaining({ id: 'g2' })] });
    expect(index.queryGlobal(120, 120).points.map((e) => e.id)).toEqual(['g1']);
  });

  it('trackHasItems is viewport aware', () => {
    expect(index.trackHasItems('p1', 0, 99)).toBe(false);
    expect(index.trackHasItems('p1', 0, 100)).toBe(false); // half-open interval start
    expect(index.trackHasItems('p1', 0, 101)).toBe(true);
    expect(index.trackHasItems('p2', 300, 300)).toBe(true);
    expect(index.trackHasItems('p4', 0, 1e9)).toBe(false);
  });

  it('lane helpers are reserved and return a single lane', () => {
    expect(index.laneOf('i1')).toBe(0);
    expect(index.laneCount('p1')).toBe(1);
  });

  it('orders rows by data order, label, first/last event and comparators, skipping hidden tracks', () => {
    const args = { index, hideEmptyTracks: false, viewStart: 0, viewEnd: 1e9 };
    expect(computeTrackRows({ ...args, trackOrder: 'data' }).rows.map((t) => t.id)).toEqual(['p1', 'p4', 'p2']);
    expect(computeTrackRows({ ...args, trackOrder: 'label' }).rows.map((t) => t.id)).toEqual(['p2', 'p1', 'p4']);
    expect(computeTrackRows({ ...args, trackOrder: 'firstEvent' }).rows.map((t) => t.id)).toEqual(['p2', 'p1', 'p4']);
    expect(computeTrackRows({ ...args, trackOrder: 'lastEvent' }).rows.map((t) => t.id)).toEqual(['p1', 'p2', 'p4']);
    const custom = computeTrackRows({ ...args, trackOrder: (a, b) => b.label.localeCompare(a.label) });
    expect(custom.rows.map((t) => t.id)).toEqual(['p4', 'p1', 'p2']);
    expect(custom.rowOfTrack.get('p2')).toBe(2);
  });

  it('applies hideEmptyTracks and track filters', () => {
    const rows = computeTrackRows({ index, trackOrder: 'data', hideEmptyTracks: true, viewStart: 0, viewEnd: 1e9 }).rows;
    expect(rows.map((t) => t.id)).toEqual(['p1', 'p2']);
    const filtered = computeTrackRows({
      index,
      trackOrder: 'data',
      hideEmptyTracks: false,
      viewStart: 0,
      viewEnd: 1e9,
      trackFilter: (t) => t.label !== 'D',
    }).rows;
    expect(filtered.map((t) => t.id)).toEqual(['p1', 'p2']);
  });
});
