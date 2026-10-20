/**
 * Viewport state: which slice of the configured time domain is visible and at
 * what scale. All functions are pure and return a new, clamped state.
 *
 * Invariants guaranteed by `clampViewport`:
 *  - minPxPerMs <= pxPerMs <= maxPxPerMs
 *  - the visible duration never exceeds the domain duration
 *  - domainStart <= start and end <= domainEnd
 */

import { MS, createTimeScale, pxPerMsForRange } from './time-scale.js';

/**
 * Zoom presets expressed in pixels per day. A preset is an anchor for
 * `pxPerMs`, not a constraint: wheel zoom moves continuously between them.
 * @type {Readonly<Record<string, number>>}
 */
export const ZOOM_PRESETS = Object.freeze({
  hour: 1440,
  day: 60,
  week: 12,
  month: 3,
  quarter: 1,
  year: 0.25,
});

/** Ordered from most zoomed-in to most zoomed-out. */
export const ZOOM_ORDER = Object.freeze(['hour', 'day', 'week', 'month', 'quarter', 'year']);

/**
 * @param {string} name
 * @param {Readonly<Record<string, number>>} [presets]
 */
export function presetToPxPerMs(name, presets = ZOOM_PRESETS) {
  const pxPerDay = presets[name];
  if (!(pxPerDay > 0)) throw new TypeError(`viewport: unknown zoom preset "${name}"`);
  return pxPerDay / MS.day;
}

/**
 * Name of the preset whose scale is closest (in log space) to `pxPerMs`.
 * @param {number} pxPerMs
 * @param {Readonly<Record<string, number>>} [presets]
 */
export function nearestPreset(pxPerMs, presets = ZOOM_PRESETS) {
  /** @type {string | null} */
  let best = null;
  let bestDist = Infinity;
  for (const [name, pxPerDay] of Object.entries(presets)) {
    const d = Math.abs(Math.log(pxPerDay / MS.day) - Math.log(pxPerMs));
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return /** @type {string} */ (best);
}

/**
 * @typedef {object} ViewportState
 * @property {number} domainStart
 * @property {number} domainEnd
 * @property {number} start visible start (ms)
 * @property {number} pxPerMs
 * @property {number} width drawing width in CSS px (>= 1)
 * @property {number} minPxPerMs most zoomed-out allowed
 * @property {number} maxPxPerMs most zoomed-in allowed
 */

/**
 * @param {ViewportState} s
 */
export function viewportEnd(s) {
  return s.start + s.width / s.pxPerMs;
}

/**
 * @param {ViewportState} s
 * @returns {ViewportState}
 */
export function clampViewport(s) {
  const width = Math.max(1, s.width);
  const domainDuration = s.domainEnd - s.domainStart;
  // Never show more than the whole domain.
  const minByDomain = width / domainDuration;
  const lo = Math.max(s.minPxPerMs, minByDomain);
  const hi = Math.max(lo, s.maxPxPerMs);
  let pxPerMs = Math.min(hi, Math.max(lo, s.pxPerMs));
  if (!Number.isFinite(pxPerMs) || pxPerMs <= 0) pxPerMs = lo;
  const visible = width / pxPerMs;
  let start = s.start;
  if (!Number.isFinite(start)) start = s.domainStart;
  if (start + visible > s.domainEnd) start = s.domainEnd - visible;
  if (start < s.domainStart) start = s.domainStart;
  return Object.freeze({ ...s, width, pxPerMs, start });
}

/**
 * @param {object} init
 * @param {number} init.domainStart
 * @param {number} init.domainEnd
 * @param {number} init.width
 * @param {number} init.pxPerMs
 * @param {number} [init.start]
 * @param {number} [init.minPxPerMs]
 * @param {number} [init.maxPxPerMs]
 * @returns {ViewportState}
 */
export function createViewportState({ domainStart, domainEnd, width, pxPerMs, start, minPxPerMs = 0, maxPxPerMs = Infinity }) {
  if (!(domainEnd > domainStart)) throw new TypeError('viewport: domainEnd must be after domainStart');
  return clampViewport({
    domainStart,
    domainEnd,
    start: start ?? domainStart,
    pxPerMs,
    width,
    minPxPerMs,
    maxPxPerMs,
  });
}

/**
 * Show `[start, end]` as exactly as the bounds allow.
 * @param {ViewportState} s
 * @param {number} start
 * @param {number} end
 */
export function setRange(s, start, end) {
  if (!(end > start)) throw new TypeError('viewport: range end must be after start');
  const pxPerMs = pxPerMsForRange(start, end, Math.max(1, s.width));
  return clampViewport({ ...s, start, pxPerMs });
}

/**
 * Multiply the scale by `factor`, keeping the time under `anchorX` fixed.
 * @param {ViewportState} s
 * @param {number} factor > 1 zooms in
 * @param {number} [anchorX] pixel offset from the viewport's left edge; defaults to the centre
 */
export function zoomBy(s, factor, anchorX = s.width / 2) {
  if (!(factor > 0)) throw new TypeError('viewport: zoom factor must be > 0');
  const anchorTime = s.start + anchorX / s.pxPerMs;
  const next = clampViewport({ ...s, pxPerMs: s.pxPerMs * factor });
  const start = anchorTime - anchorX / next.pxPerMs;
  return clampViewport({ ...next, start });
}

/**
 * Set an absolute scale keeping the centre fixed.
 * @param {ViewportState} s
 * @param {number} pxPerMs
 * @param {number} [anchorX]
 */
export function setScale(s, pxPerMs, anchorX = s.width / 2) {
  return zoomBy(s, pxPerMs / s.pxPerMs, anchorX);
}

/**
 * Pan by a pixel delta. Positive `dx` moves the view later in time.
 * @param {ViewportState} s
 * @param {number} dx
 */
export function panByPixels(s, dx) {
  return clampViewport({ ...s, start: s.start + dx / s.pxPerMs });
}

/**
 * @param {ViewportState} s
 * @param {number} ms positive moves later in time
 */
export function panByTime(s, ms) {
  return clampViewport({ ...s, start: s.start + ms });
}

/**
 * Keep `start` and scale while the drawing width changes.
 * @param {ViewportState} s
 * @param {number} width
 */
export function resizeViewport(s, width) {
  return clampViewport({ ...s, width });
}

/**
 * @param {ViewportState} s
 * @param {number} minPxPerMs
 * @param {number} maxPxPerMs
 */
export function setBounds(s, minPxPerMs, maxPxPerMs) {
  return clampViewport({ ...s, minPxPerMs, maxPxPerMs });
}

/**
 * Fit `[start, end]` with optional padding (fraction of the range on each side).
 * @param {ViewportState} s
 * @param {number} start
 * @param {number} end
 * @param {number} [paddingFraction=0.02]
 */
export function fitRange(s, start, end, paddingFraction = 0.02) {
  let duration = end - start;
  if (!(duration > 0)) {
    // A single instant: show one day around it.
    duration = MS.day;
    start -= duration / 2;
    end = start + duration;
  }
  const pad = duration * paddingFraction;
  return setRange(s, start - pad, end + pad);
}

/**
 * @param {ViewportState} s
 * @param {number} [origin=0]
 */
export function toTimeScale(s, origin = 0) {
  return createTimeScale({ start: s.start, pxPerMs: s.pxPerMs, origin });
}

/**
 * @param {ViewportState} a
 * @param {ViewportState} b
 */
export function sameView(a, b) {
  return a.start === b.start && a.pxPerMs === b.pxPerMs && a.width === b.width;
}
