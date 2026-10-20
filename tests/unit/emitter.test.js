import { describe, it, expect, vi } from 'vitest';
import { EVENTS, toDomEventName, toApiEventName, createEmitter } from '../../src/core/emitter.js';

describe('emitter', () => {
  it('maps camelCase, kebab and prefixed names to one DOM type', () => {
    expect(toDomEventName('selectionChange')).toBe('timeline:selection-change');
    expect(toDomEventName('selection-change')).toBe('timeline:selection-change');
    expect(toDomEventName('timeline:selection-change')).toBe('timeline:selection-change');
    expect(toDomEventName('intervalEditCommit')).toBe(EVENTS.intervalEditCommit);
    expect(toApiEventName('timeline:interval-edit-commit')).toBe('intervalEditCommit');
    expect(() => toDomEventName('')).toThrow();
  });

  it('dispatches bubbling CustomEvents and supports on/off', () => {
    const target = new EventTarget();
    const em = createEmitter(target);
    const cb = vi.fn();
    em.on('selectionChange', cb);
    const ok = em.emit('selectionChange', { ids: ['a'] });
    expect(ok).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    const ev = cb.mock.calls[0][0];
    expect(ev.type).toBe('timeline:selection-change');
    expect(ev.bubbles).toBe(true);
    expect(ev.detail).toMatchObject({ type: 'selectionChange', ids: ['a'] });
    expect(typeof ev.detail.timestamp).toBe('number');
    em.off('selection-change', cb);
    em.emit('selectionChange');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(() => em.on('x', /** @type {any} */ (null))).toThrow();
  });

  it('reports preventDefault on cancelable events', () => {
    const target = new EventTarget();
    const em = createEmitter(target);
    em.on('contextMenu', (e) => e.preventDefault());
    expect(em.emit('contextMenu', {}, { cancelable: true })).toBe(false);
  });
});
