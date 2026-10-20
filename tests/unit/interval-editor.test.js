import { describe, it, expect, vi } from 'vitest';
import { createIntervalEditor } from '../../src/interaction/interval-editor.js';
import { validateData, normalizeOptions } from '../../src/core/validation.js';
import { buildDataIndex } from '../../src/core/data-index.js';
import { createFormatter } from '../../src/core/format.js';
import { MS } from '../../src/core/time-scale.js';

const D = (d, h = 0) => Date.UTC(2026, 2, d, h);

function setup({ snap = null, editable = true, data } = {}) {
  let options = normalizeOptions({ startDate: D(1), endDate: Date.UTC(2026, 4, 31), editable, snap });
  let index = buildDataIndex(
    validateData(
      data ?? {
        tracks: [{ id: 't1' }, { id: 't2', editable: false }],
        intervals: [
          { id: 'a', trackId: 't1', start: D(10), end: D(12) },
          { id: 'locked', trackId: 't1', start: D(20), end: D(22), editable: false },
          { id: 'onLocked', trackId: 't2', start: D(5), end: D(6) },
        ],
      },
    ),
  );
  const events = [];
  const emit = vi.fn((name, detail) => events.push({ name, detail }));
  const invalidate = vi.fn();
  const editor = createIntervalEditor({ options: () => options, index: () => index, emit, invalidate, formatter: () => createFormatter('en-US', 'UTC') });
  return {
    editor,
    events,
    get index() {
      return index;
    },
    setIndex(d) {
      index = buildDataIndex(validateData(d));
    },
    setOptions(o) {
      options = normalizeOptions({ startDate: D(1), endDate: Date.UTC(2026, 4, 31), ...o });
    },
  };
}

describe('interval-editor', () => {
  it('respects editability of library, interval and track', () => {
    const s = setup();
    const a = s.index.intervalById.get('a');
    expect(s.editor.isEditable(a)).toBe(true);
    expect(s.editor.isEditable(s.index.intervalById.get('locked'))).toBe(false);
    expect(s.editor.isEditable(s.index.intervalById.get('onLocked'))).toBe(false);
    expect(s.editor.isTrackEditable(s.index.trackById.get('t2'))).toBe(false);
    const off = setup({ editable: false });
    expect(off.editor.isEditable(off.index.intervalById.get('a'))).toBe(false);
    expect(off.editor.beginExisting(off.index.intervalById.get('a'), 'move', D(10))).toBe(false);
  });

  it('move: preview, commit, pending until data applied', () => {
    const s = setup();
    const a = s.index.intervalById.get('a');
    expect(s.editor.beginExisting(a, 'move', D(10, 6))).toBe(true);
    expect(s.events[0]).toMatchObject({ name: 'intervalEditStart', detail: { operation: 'move', intervalId: 'a', isNew: false, original: { start: D(10), end: D(12) } } });
    s.editor.update(D(13, 6)); // pointer moved 3 days
    const preview = s.events.at(-1);
    expect(preview.name).toBe('intervalEditPreview');
    expect(preview.detail).toMatchObject({ start: D(13), end: D(15), valid: true });
    expect(s.editor.previews().at(-1)).toMatchObject({ trackId: 't1', start: D(13), end: D(15), pending: false });
    s.editor.commit();
    const commit = s.events.at(-1);
    expect(commit.name).toBe('intervalEditCommit');
    expect(commit.detail).toMatchObject({ operation: 'move', intervalId: 'a', tempId: null, trackId: 't1', start: D(13), end: D(15), original: { start: D(10), end: D(12) } });
    expect(s.editor.isPending('a')).toBe(true);
    expect(s.editor.isEditing).toBe(false);
    // Host applies the change.
    s.setIndex({ tracks: [{ id: 't1' }], intervals: [{ id: 'a', trackId: 't1', start: D(13), end: D(15) }] });
    s.editor.onDataApplied(undefined, false);
    expect(s.editor.isPending('a')).toBe(false);
    expect(s.editor.previews()).toEqual([]);
  });

  it('commit with no change cancels with reason "unchanged"', () => {
    const s = setup();
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.editor.update(D(10));
    s.editor.commit();
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'unchanged' } });
    expect(s.editor.pendingIds().size).toBe(0);
  });

  it('resize from either end never inverts and is clamped', () => {
    const s = setup();
    const a = s.index.intervalById.get('a');
    s.editor.beginExisting(a, 'resize-end', D(12));
    s.editor.update(D(9)); // dragged before the start
    expect(s.events.at(-1).detail).toMatchObject({ start: D(10), end: D(10) + 1, valid: true });
    s.editor.update(D(14));
    expect(s.events.at(-1).detail).toMatchObject({ start: D(10), end: D(14) });
    s.editor.commit();
    expect(s.events.at(-1).detail).toMatchObject({ operation: 'resize-end', end: D(14) });
    s.editor.beginExisting(a, 'resize-start', D(10));
    s.editor.update(D(8));
    expect(s.events.at(-1).detail).toMatchObject({ start: D(8), end: D(12) });
    s.editor.cancel('escape');
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'escape', intervalId: 'a' } });
  });

  it('move keeps duration and stays inside the domain', () => {
    const s = setup();
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.editor.update(Date.UTC(2025, 0, 1)); // far before the domain
    expect(s.events.at(-1).detail).toMatchObject({ start: D(1), end: D(3), valid: true });
    s.editor.update(Date.UTC(2027, 0, 1));
    const d = s.events.at(-1).detail;
    expect(d.end).toBe(Date.UTC(2026, 4, 31));
    expect(d.end - d.start).toBe(2 * MS.day);
  });

  it('create: temp id, drag either direction, commit, replaceIds resolves', () => {
    const s = setup();
    const t1 = s.index.trackById.get('t1');
    expect(s.editor.beginCreate(t1, D(15))).toBe(true);
    expect(s.events[0].detail).toMatchObject({ operation: 'create', isNew: true, tempId: 'tmp-1', intervalId: null, trackId: 't1' });
    s.editor.update(D(13));
    expect(s.events.at(-1).detail).toMatchObject({ start: D(13), end: D(15), valid: true });
    s.editor.commit();
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCommit', detail: { tempId: 'tmp-1', isNew: true, start: D(13), end: D(15) } });
    expect(s.editor.isPending('tmp-1')).toBe(true);
    s.setIndex({ tracks: [{ id: 't1' }], intervals: [{ id: 'real', trackId: 't1', start: D(13), end: D(15) }] });
    s.editor.onDataApplied({ 'tmp-1': 'real' }, false);
    expect(s.editor.isPending('tmp-1')).toBe(false);
    // zero-length create cancels
    s.editor.beginCreate(t1, D(20));
    s.editor.commit();
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'Interval must have a positive duration' } });
    expect(s.editor.beginCreate(s.index.trackById.get('t2') ?? t1, D(1))).toBe(t1.id === 't2' ? false : true);
  });

  it('create on a non-editable track is refused', () => {
    const s = setup();
    expect(s.editor.beginCreate(s.index.trackById.get('t2'), D(1))).toBe(false);
  });

  it('snapping applies to all operations', () => {
    const s = setup({ snap: '1d' });
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10, 3));
    s.editor.update(D(11, 14)); // +1d11h -> snaps to +1d (grab offset 3h kept then rounded)
    expect(s.events.at(-1).detail).toMatchObject({ start: D(11), end: D(13) });
    s.editor.cancel();
    s.editor.beginCreate(s.index.trackById.get('t1'), D(15, 13));
    s.editor.update(D(17, 1));
    expect(s.events.at(-1).detail).toMatchObject({ start: D(16), end: D(17) });
  });

  it('reject restores and throws for unknown ids; full setData clears pending', () => {
    const s = setup();
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.editor.update(D(11));
    s.editor.commit();
    s.editor.reject('a');
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'rejected', intervalId: 'a' } });
    expect(() => s.editor.reject('a')).toThrow(/no pending edit/);
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.editor.update(D(11));
    s.editor.commit();
    s.editor.onDataApplied(undefined, true);
    expect(s.editor.pendingIds().size).toBe(0);
  });

  it('cancels the live session when its interval disappears or on dispose', () => {
    const s = setup();
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.setIndex({ tracks: [{ id: 't1' }] });
    s.editor.onDataApplied(undefined, false);
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'interval-removed' } });
    s.setIndex({ tracks: [{ id: 't1' }], intervals: [{ id: 'a', trackId: 't1', start: D(10), end: D(12) }] });
    s.editor.beginExisting(s.index.intervalById.get('a'), 'move', D(10));
    s.editor.dispose();
    expect(s.events.at(-1)).toMatchObject({ name: 'intervalEditCancel', detail: { reason: 'destroyed' } });
    expect(s.editor.isEditing).toBe(false);
  });
});
