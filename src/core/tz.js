/**
 * Time-zone utilities built only on `Intl.DateTimeFormat`.
 *
 * Internally the timeline works in epoch milliseconds (UTC). The configured
 * IANA time zone is used solely to compute calendar boundaries (midnight,
 * start of week/month/quarter/year) and to format labels. Iterating calendar
 * units through these helpers is correct across daylight-saving transitions:
 * a "day" may be 23 or 25 hours long and is rendered proportionally.
 */

import { ErrorCodes, fail } from './errors.js';

/** @type {Map<string, Intl.DateTimeFormat>} */
const partsFormatterCache = new Map();

/** @type {Record<string, number>} */
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Validate an IANA time zone name. Returns the canonical name.
 * @param {string | undefined | null} timeZone
 */
export function resolveTimeZone(timeZone) {
  if (timeZone === undefined || timeZone === null) return 'UTC';
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    fail(ErrorCodes.INVALID_CONFIG, `timeZone must be a non-empty IANA string (received ${String(timeZone)})`);
  }
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return fail(ErrorCodes.INVALID_CONFIG, `Unknown time zone "${timeZone}"`, { timeZone });
  }
}

/** @param {string} timeZone */
function partsFormatter(timeZone) {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * @typedef {object} LocalParts
 * @property {number} year
 * @property {number} month 1-12
 * @property {number} day 1-31
 * @property {number} hour 0-23
 * @property {number} minute
 * @property {number} second
 * @property {number} millisecond
 * @property {number} weekday 0 (Sunday) - 6 (Saturday)
 */

/**
 * Calendar parts of `epochMs` in `timeZone`.
 * @param {number} epochMs
 * @param {string} timeZone
 * @returns {LocalParts}
 */
export function toParts(epochMs, timeZone) {
  const parts = partsFormatter(timeZone).formatToParts(epochMs);
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  let year = Number(map.year);
  if (map.era && /^B/.test(map.era)) year = 1 - year;
  return {
    year,
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
    millisecond: ((epochMs % 1000) + 1000) % 1000,
    weekday: WEEKDAYS[map.weekday] ?? 0,
  };
}

/**
 * Offset of `timeZone` from UTC at `epochMs`, in ms (positive east of UTC).
 * @param {number} epochMs
 * @param {string} timeZone
 */
export function getOffset(epochMs, timeZone) {
  if (timeZone === 'UTC') return 0;
  const p = toParts(epochMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond);
  return asUtc - epochMs;
}

/**
 * Epoch ms for local calendar parts in `timeZone`.
 * Non-existent local times (spring-forward gap) resolve forward; ambiguous
 * local times (fall-back overlap) resolve to the earlier instant.
 *
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number, millisecond?: number }} parts
 * @param {string} timeZone
 */
export function fromParts(parts, timeZone) {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    parts.millisecond ?? 0,
  );
  if (timeZone === 'UTC') return guess;
  const off1 = getOffset(guess, timeZone);
  const c1 = guess - off1;
  const off2 = getOffset(c1, timeZone);
  if (off2 === off1) return c1;
  const c2 = guess - off2;
  const back1 = getOffset(c1, timeZone) === off1;
  const back2 = getOffset(c2, timeZone) === off2;
  if (back1 && back2) return Math.min(c1, c2); // overlap: earlier instant
  if (back2) return c2;
  if (back1) return c1;
  return Math.max(c1, c2); // gap: move forward
}

/**
 * @param {number} epochMs
 * @param {string} timeZone
 */
export function startOfDay(epochMs, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/**
 * @param {number} epochMs
 * @param {string} timeZone
 * @param {number} [weekStartsOn=1] 0 = Sunday, 1 = Monday.
 */
export function startOfWeek(epochMs, timeZone, weekStartsOn = 1) {
  const p = toParts(epochMs, timeZone);
  const diff = (p.weekday - weekStartsOn + 7) % 7;
  return fromParts({ year: p.year, month: p.month, day: p.day - diff }, timeZone);
}

/**
 * @param {number} epochMs
 * @param {string} timeZone
 */
export function startOfMonth(epochMs, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ year: p.year, month: p.month, day: 1 }, timeZone);
}

/**
 * @param {number} epochMs
 * @param {string} timeZone
 */
export function startOfQuarter(epochMs, timeZone) {
  const p = toParts(epochMs, timeZone);
  const month = Math.floor((p.month - 1) / 3) * 3 + 1;
  return fromParts({ year: p.year, month, day: 1 }, timeZone);
}

/**
 * @param {number} epochMs
 * @param {string} timeZone
 */
export function startOfYear(epochMs, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ year: p.year, month: 1, day: 1 }, timeZone);
}

/**
 * Start of the hour/minute boundary that is a multiple of `step` units
 * since local midnight.
 * @param {number} epochMs
 * @param {string} timeZone
 * @param {'hour'|'minute'} unit
 * @param {number} step
 */
export function floorToSubDay(epochMs, timeZone, unit, step) {
  const day = startOfDay(epochMs, timeZone);
  const unitMs = unit === 'hour' ? 3_600_000 : 60_000;
  const stepMs = unitMs * step;
  return day + Math.floor((epochMs - day) / stepMs) * stepMs;
}

/**
 * Add calendar days keeping the local wall time (DST aware).
 * @param {number} epochMs
 * @param {number} days
 * @param {string} timeZone
 */
export function addDays(epochMs, days, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ ...p, day: p.day + days }, timeZone);
}

/**
 * Add calendar months keeping the day-of-month (Date.UTC overflow rules apply).
 * @param {number} epochMs
 * @param {number} months
 * @param {string} timeZone
 */
export function addMonths(epochMs, months, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ ...p, month: p.month + months }, timeZone);
}

/**
 * @param {number} epochMs
 * @param {number} years
 * @param {string} timeZone
 */
export function addYears(epochMs, years, timeZone) {
  const p = toParts(epochMs, timeZone);
  return fromParts({ ...p, year: p.year + years }, timeZone);
}

/** @typedef {'minute'|'hour'|'day'|'week'|'month'|'quarter'|'year'} CalendarUnit */

/**
 * Floor `epochMs` to the start of a calendar unit.
 * @param {number} epochMs
 * @param {CalendarUnit} unit
 * @param {string} timeZone
 * @param {{ step?: number, weekStartsOn?: number }} [opts]
 */
export function floorToUnit(epochMs, unit, timeZone, opts = {}) {
  const step = opts.step ?? 1;
  switch (unit) {
    case 'minute':
    case 'hour':
      return floorToSubDay(epochMs, timeZone, unit, step);
    case 'day':
      return startOfDay(epochMs, timeZone);
    case 'week':
      return startOfWeek(epochMs, timeZone, opts.weekStartsOn ?? 1);
    case 'month': {
      const m = startOfMonth(epochMs, timeZone);
      if (step === 1) return m;
      const p = toParts(m, timeZone);
      const month = Math.floor((p.month - 1) / step) * step + 1;
      return fromParts({ year: p.year, month, day: 1 }, timeZone);
    }
    case 'quarter':
      return startOfQuarter(epochMs, timeZone);
    case 'year':
      return startOfYear(epochMs, timeZone);
    default:
      throw new TypeError(`tz: unknown unit "${unit}"`);
  }
}

/**
 * Add `step` calendar units.
 * @param {number} epochMs
 * @param {CalendarUnit} unit
 * @param {number} step
 * @param {string} timeZone
 */
export function addUnit(epochMs, unit, step, timeZone) {
  switch (unit) {
    case 'minute':
      return epochMs + step * 60_000;
    case 'hour':
      return epochMs + step * 3_600_000;
    case 'day':
      return addDays(epochMs, step, timeZone);
    case 'week':
      return addDays(epochMs, 7 * step, timeZone);
    case 'month':
      return addMonths(epochMs, step, timeZone);
    case 'quarter':
      return addMonths(epochMs, 3 * step, timeZone);
    case 'year':
      return addYears(epochMs, step, timeZone);
    default:
      throw new TypeError(`tz: unknown unit "${unit}"`);
  }
}
