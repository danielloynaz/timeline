/**
 * Locale-aware formatting helpers (labels, tooltips, accessible descriptions).
 * All formatters are cached per (locale, timeZone, format name).
 */

import { MS } from './time-scale.js';

/** @type {Record<string, Intl.DateTimeFormatOptions>} */
export const DEFAULT_FORMATS = Object.freeze({
  time: { hour: '2-digit', minute: '2-digit' },
  timeSeconds: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  dateTime: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  date: { weekday: 'short', month: 'short', day: 'numeric' },
  dayOfMonth: { day: 'numeric' },
  monthYear: { month: 'long', year: 'numeric' },
  monthShort: { month: 'short' },
  year: { year: 'numeric' },
  full: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
  fullDate: { year: 'numeric', month: 'short', day: 'numeric' },
});

/**
 * @param {string | undefined} locale
 * @param {string} timeZone
 * @param {Record<string, Intl.DateTimeFormatOptions>} [overrides]
 */
export function createFormatter(locale, timeZone, overrides = {}) {
  /** @type {Record<string, Intl.DateTimeFormatOptions>} */
  const formats = { ...DEFAULT_FORMATS, ...overrides };
  /** @type {Map<string, Intl.DateTimeFormat>} */
  const cache = new Map();
  /** @param {string} name */
  const get = (name) => {
    let fmt = cache.get(name);
    if (!fmt) {
      const opts = formats[name] ?? formats.full;
      fmt = new Intl.DateTimeFormat(locale, { ...opts, timeZone });
      cache.set(name, fmt);
    }
    return fmt;
  };
  return {
    locale,
    timeZone,
    formats,
    /**
     * @param {number} time epoch ms
     * @param {string} name format key
     */
    format(time, name) {
      return get(name).format(time);
    },
    /** @param {number} ms */
    duration(ms) {
      return formatDuration(ms, locale);
    },
  };
}

/** @type {Map<string, Intl.NumberFormat>} */
const numberFormatCache = new Map();

/**
 * Compact human readable duration such as "3d 4h" or "45m".
 * @param {number} ms
 * @param {string} [locale]
 */
export function formatDuration(ms, locale) {
  const abs = Math.abs(ms);
  const key = locale ?? '';
  let nf = numberFormatCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    numberFormatCache.set(key, nf);
  }
  if (abs < MS.minute) return `${nf.format(Math.round(abs / MS.second))}s`;
  if (abs < MS.hour) return `${nf.format(Math.floor(abs / MS.minute))}m`;
  if (abs < MS.day) {
    const h = Math.floor(abs / MS.hour);
    const m = Math.floor((abs % MS.hour) / MS.minute);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(abs / MS.day);
  const h = Math.floor((abs % MS.day) / MS.hour);
  return h ? `${nf.format(d)}d ${h}h` : `${nf.format(d)}d`;
}
