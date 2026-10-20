import { describe, it, expect, vi } from 'vitest';
import { createSelectionController } from '../../src/interaction/selection-controller.js';

function setup({ selectable = new Set(['a', 'b', 'c']), multi = true } = {}) {
  const emit = vi.fn();
  const invalidate = vi.fn();
  const ctl = createSelectionController({ isSelectable: (id) => selectable.has(id), multiSelect: () => multi, emit, invalidate });
  return { ctl, emit, invalidate, selectable };
}

describe('selection-controller', () => {
  it('click replaces, ctrl toggles, shift adds, empty clears', () => {
    const { ctl, emit } = setup();
    ctl.click('a', {});
    expect(ctl.detail()).toEqual({ ids: ['a'], primaryId: 'a' });
    ctl.click('b', { ctrl: true });
    expect(ctl.detail()).toEqual({ ids: ['a', 'b'], primaryId: 'b' });
    ctl.click('a', { meta: true });
    expect(ctl.detail()).toEqual({ ids: ['b'], primaryId: 'b' });
    ctl.click('c', { shift: true });
    expect(ctl.detail()).toEqual({ ids: ['b', 'c'], primaryId: 'c' });
    ctl.click(null, { ctrl: true });
    expect(ctl.ids.size).toBe(2);
    ctl.click(null, {});
    expect(ctl.detail()).toEqual({ ids: [], primaryId: null });
    expect(emit).toHaveBeenCalledTimes(5); // the ctrl+click on empty space is a no-op
  });

  it('ignores non-selectable ids and does not emit when nothing changes', () => {
    const { ctl, emit } = setup();
    ctl.click('zzz', {});
    expect(emit).not.toHaveBeenCalled();
    ctl.click('a', {});
    ctl.click('a', {});
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('single-select mode collapses modifiers', () => {
    const { ctl } = setup({ multi: false });
    ctl.click('a', {});
    ctl.click('b', { ctrl: true });
    expect(ctl.detail()).toEqual({ ids: ['b'], primaryId: 'b' });
  });

  it('set() is silent and filters ineligible ids', () => {
    const { ctl, emit } = setup();
    ctl.set(['a', 'nope', 'c'], 'a');
    expect(ctl.detail()).toEqual({ ids: ['a', 'c'], primaryId: 'a' });
    ctl.set(['b']);
    expect(ctl.primaryId).toBe('b');
    expect(emit).not.toHaveBeenCalled();
  });

  it('reconcile drops ids that disappeared and emits once', () => {
    const { ctl, emit, selectable } = setup();
    ctl.set(['a', 'b'], 'b');
    selectable.delete('b');
    ctl.reconcile();
    expect(ctl.detail()).toEqual({ ids: ['a'], primaryId: 'a' });
    expect(emit).toHaveBeenCalledTimes(1);
    ctl.reconcile();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('keyboard toggle/replace/add', () => {
    const { ctl } = setup();
    ctl.keyboard('a', 'toggle');
    ctl.keyboard('b', 'add');
    expect(ctl.detail()).toEqual({ ids: ['a', 'b'], primaryId: 'b' });
    ctl.keyboard('a', 'toggle');
    expect(ctl.detail()).toEqual({ ids: ['b'], primaryId: 'b' });
    ctl.keyboard('c', 'replace');
    expect(ctl.detail()).toEqual({ ids: ['c'], primaryId: 'c' });
  });
});
