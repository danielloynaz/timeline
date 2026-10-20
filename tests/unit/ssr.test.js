import { describe, it, expect } from 'vitest';

describe('server-side import safety', () => {
  it('imports without touching browser APIs and fails gracefully on construction', async () => {
    expect(typeof window).toBe('undefined');
    const mod = await import('../../src/index.js');
    expect(typeof mod.Timeline).toBe('function');
    expect(mod.EVENTS.selectionChange).toBe('timeline:selection-change');
    let err;
    try {
      new mod.Timeline(/** @type {any} */ ({}), { startDate: '2026-01-01', endDate: '2026-02-01' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(mod.TimelineError);
    expect(err.code).toBe(mod.ErrorCodes.UNSUPPORTED_ENVIRONMENT);
  });
});
