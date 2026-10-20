/**
 * Adaptive date tick generation. The visible pixel density selects a "level"
 * (minor unit + major grouping unit); boundaries are computed in the configured
 * time zone so that ticks fall on real local midnights/month starts.
 */

import { MS } from './time-scale.js';
import { floorToUnit, addUnit } from './tz.js';

/**
 * @typedef {object} TickLevel
 * @property {{ unit: import('./tz.js').CalendarUnit, step: number }} minor
 * @property {{ unit: import('./tz.js').CalendarUnit, step: number } | null} major
 * @property {string} minorFormat
 * @property {string | null} majorFormat
 * @property {number} approxMs approximate duration of one minor step
 */

/** @type {Omit<TickLevel, 'approxMs'>[]} */
const RAW_LEVELS = [
    { minor: { unit: 'minute', step: 1 }, major: { unit: 'hour', step: 1 }, minorFormat: 'time', majorFormat: 'dateTime' },
    { minor: { unit: 'minute', step: 5 }, major: { unit: 'hour', step: 1 }, minorFormat: 'time', majorFormat: 'dateTime' },
    { minor: { unit: 'minute', step: 15 }, major: { unit: 'hour', step: 1 }, minorFormat: 'time', majorFormat: 'dateTime' },
    { minor: { unit: 'minute', step: 30 }, major: { unit: 'hour', step: 1 }, minorFormat: 'time', majorFormat: 'dateTime' },
    { minor: { unit: 'hour', step: 1 }, major: { unit: 'day', step: 1 }, minorFormat: 'time', majorFormat: 'date' },
    { minor: { unit: 'hour', step: 3 }, major: { unit: 'day', step: 1 }, minorFormat: 'time', majorFormat: 'date' },
    { minor: { unit: 'hour', step: 6 }, major: { unit: 'day', step: 1 }, minorFormat: 'time', majorFormat: 'date' },
    { minor: { unit: 'hour', step: 12 }, major: { unit: 'day', step: 1 }, minorFormat: 'time', majorFormat: 'date' },
    { minor: { unit: 'day', step: 1 }, major: { unit: 'month', step: 1 }, minorFormat: 'dayOfMonth', majorFormat: 'monthYear' },
    { minor: { unit: 'week', step: 1 }, major: { unit: 'month', step: 1 }, minorFormat: 'dayOfMonth', majorFormat: 'monthYear' },
    { minor: { unit: 'month', step: 1 }, major: { unit: 'year', step: 1 }, minorFormat: 'monthShort', majorFormat: 'year' },
    { minor: { unit: 'month', step: 3 }, major: { unit: 'year', step: 1 }, minorFormat: 'monthShort', majorFormat: 'year' },
  { minor: { unit: 'year', step: 1 }, major: null, minorFormat: 'year', majorFormat: null },
];

/** @type {readonly TickLevel[]} */
export const TICK_LEVELS = Object.freeze(
  RAW_LEVELS.map((l) => Object.freeze({ ...l, approxMs: l.minor.step * MS[l.minor.unit === 'quarter' ? 'month' : l.minor.unit] })),
);

/**
 * Pick the finest level whose minor ticks are at least `minSpacingPx` apart.
 * @param {number} pxPerMs
 * @param {number} [minSpacingPx=48]
 * @returns {TickLevel}
 */
export function chooseTickLevel(pxPerMs, minSpacingPx = 48) {
  for (const level of TICK_LEVELS) {
    if (level.approxMs * pxPerMs >= minSpacingPx) return level;
  }
  return TICK_LEVELS[TICK_LEVELS.length - 1];
}

const MAX_TICKS = 5000;

/**
 * Generate boundaries of `unit` covering `[start, end]`, including one boundary
 * before `start` so spans can be clipped by the caller.
 * @param {number} start
 * @param {number} end
 * @param {import('./tz.js').CalendarUnit} unit
 * @param {number} step
 * @param {string} timeZone
 * @param {number} weekStartsOn
 * @returns {number[]}
 */
export function unitBoundaries(start, end, unit, step, timeZone, weekStartsOn) {
  const out = [];
  let t = floorToUnit(start, unit, timeZone, { step, weekStartsOn });
  let guard = 0;
  while (t <= end && guard++ < MAX_TICKS) {
    out.push(t);
    const next = addUnit(t, unit, step, timeZone);
    if (next <= t) break; // defensive: never loop on a non-advancing unit
    t = next;
  }
  out.push(t); // first boundary after `end` closes the last span
  return out;
}

/**
 * @typedef {object} Ticks
 * @property {TickLevel} level
 * @property {{ time: number, label: string }[]} minor
 * @property {{ start: number, end: number, label: string }[]} major
 */

/**
 * @param {object} args
 * @param {number} args.start visible start (ms)
 * @param {number} args.end visible end (ms)
 * @param {number} args.pxPerMs
 * @param {string} args.timeZone
 * @param {ReturnType<typeof import('./format.js').createFormatter>} args.formatter
 * @param {number} [args.minSpacingPx]
 * @param {number} [args.weekStartsOn]
 * @param {TickLevel} [args.level] force a level (tests)
 * @returns {Ticks}
 */
export function generateTicks({ start, end, pxPerMs, timeZone, formatter, minSpacingPx = 48, weekStartsOn = 1, level }) {
  const lvl = level ?? chooseTickLevel(pxPerMs, minSpacingPx);
  const minorBounds = unitBoundaries(start, end, lvl.minor.unit, lvl.minor.step, timeZone, weekStartsOn);
  const minor = [];
  for (const t of minorBounds) {
    if (t >= start && t <= end) minor.push({ time: t, label: formatter.format(t, lvl.minorFormat) });
  }
  const major = [];
  if (lvl.major) {
    const bounds = unitBoundaries(start, end, lvl.major.unit, lvl.major.step, timeZone, weekStartsOn);
    for (let i = 0; i < bounds.length - 1; i++) {
      const s = bounds[i];
      const e = bounds[i + 1];
      if (e <= start || s > end) continue;
      major.push({ start: s, end: e, label: formatter.format(s, /** @type {string} */ (lvl.majorFormat)) });
    }
  }
  return { level: lvl, minor, major };
}
