/**
 * Snapping of timestamps to a configurable increment.
 *
 * Increments are anchored to local midnight of the configured time zone so
 * that e.g. a 1 hour increment yields whole local hours and a 1 day increment
 * yields local midnights, even across daylight-saving transitions.
 */

import { ErrorCodes, fail } from './errors.js';
import { MS } from './time-scale.js';
import { startOfDay, addDays } from './tz.js';

const UNIT_RE = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)\s*$/i;

/** @type {Record<string, number>} */
const UNIT_MS = { ms: 1, s: MS.second, m: MS.minute, h: MS.hour, d: MS.day, w: MS.week };

/**
 * Parse a snap increment: a number of ms, or a string such as `'15m'`, `'1h'`, `'1d'`.
 * @param {number | string | null | undefined} increment
 * @returns {number} increment in ms, or 0 when snapping is disabled.
 */
export function parseIncrement(increment) {
  if (increment === null || increment === undefined || increment === 0) return 0;
  if (typeof increment === 'number') {
    if (!Number.isFinite(increment) || increment < 0) {
      fail(ErrorCodes.INVALID_CONFIG, `snap increment must be a non-negative finite number (received ${increment})`);
    }
    return increment;
  }
  if (typeof increment === 'string') {
    const m = UNIT_RE.exec(increment);
    if (!m) fail(ErrorCodes.INVALID_CONFIG, `Invalid snap increment "${increment}" (expected e.g. "15m", "1h", "1d")`);
    return Number(m[1]) * UNIT_MS[m[2].toLowerCase()];
  }
  return fail(ErrorCodes.INVALID_CONFIG, `Invalid snap increment type ${typeof increment}`);
}

/**
 * @param {number} ms
 * @param {number} incrementMs
 * @param {string} timeZone
 * @param {'round'|'floor'|'ceil'} [mode='round']
 */
export function snapTime(ms, incrementMs, timeZone, mode = 'round') {
  if (!(incrementMs > 0)) return ms;
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  if (incrementMs % MS.day === 0) {
    // Whole days: snap to local midnights (DST-safe).
    const days = incrementMs / MS.day;
    const dayStart = startOfDay(ms, timeZone);
    const next = addDays(dayStart, days, timeZone);
    if (mode === 'floor') return dayStart;
    if (mode === 'ceil') return ms === dayStart ? dayStart : next;
    return ms - dayStart < next - ms ? dayStart : next;
  }
  const origin = startOfDay(ms, timeZone);
  return origin + fn((ms - origin) / incrementMs) * incrementMs;
}

/**
 * Build a snapper function for the given configuration.
 * @param {{ increment?: number | string | null, timeZone: string }} cfg
 * @returns {(ms: number, mode?: 'round'|'floor'|'ceil') => number}
 */
export function createSnapper({ increment, timeZone }) {
  const inc = parseIncrement(increment);
  if (inc === 0) return (ms) => ms;
  return (ms, mode = 'round') => snapTime(ms, inc, timeZone, mode);
}
