/**
 * Continuous time scale: the single source of truth for every conversion
 * between timestamps (epoch milliseconds) and horizontal pixel coordinates.
 *
 *   x = origin + (t - start) * pxPerMs
 *
 * Rendering, hit-testing and interval editing all go through these functions.
 */

/**
 * @typedef {object} TimeScale
 * @property {number} start   Timestamp (ms) rendered at `origin`.
 * @property {number} pxPerMs Pixels per millisecond (> 0).
 * @property {number} origin  Pixel offset of `start` inside the drawing surface.
 */

export const MS = Object.freeze({
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  /** Mean Gregorian month, used only for approximate density decisions. */
  month: 2_629_746_000,
  /** Mean Gregorian year, used only for approximate density decisions. */
  year: 31_556_952_000,
});

/**
 * @param {{ start: number, pxPerMs: number, origin?: number }} init
 * @returns {TimeScale}
 */
export function createTimeScale({ start, pxPerMs, origin = 0 }) {
  if (!Number.isFinite(start)) throw new TypeError('time-scale: start must be a finite number');
  if (!(pxPerMs > 0) || !Number.isFinite(pxPerMs)) throw new TypeError('time-scale: pxPerMs must be > 0');
  if (!Number.isFinite(origin)) throw new TypeError('time-scale: origin must be a finite number');
  return Object.freeze({ start, pxPerMs, origin });
}

/**
 * @param {TimeScale} scale
 * @param {number} time epoch ms
 * @returns {number} x in pixels
 */
export function timeToX(scale, time) {
  return scale.origin + (time - scale.start) * scale.pxPerMs;
}

/**
 * @param {TimeScale} scale
 * @param {number} x pixels
 * @returns {number} epoch ms
 */
export function xToTime(scale, x) {
  return scale.start + (x - scale.origin) / scale.pxPerMs;
}

/**
 * Width in pixels of a time span. Independent of position by construction.
 * @param {TimeScale} scale
 * @param {number} durationMs
 */
export function durationToWidth(scale, durationMs) {
  return durationMs * scale.pxPerMs;
}

/**
 * @param {TimeScale} scale
 * @param {number} widthPx
 */
export function widthToDuration(scale, widthPx) {
  return widthPx / scale.pxPerMs;
}

/**
 * Pixels-per-millisecond needed to show `[start, end]` in `widthPx`.
 * @param {number} start
 * @param {number} end
 * @param {number} widthPx
 */
export function pxPerMsForRange(start, end, widthPx) {
  const duration = end - start;
  if (!(duration > 0)) throw new TypeError('time-scale: range must have positive duration');
  if (!(widthPx > 0)) throw new TypeError('time-scale: width must be > 0');
  return widthPx / duration;
}

/**
 * Visible end timestamp for a scale drawn into `widthPx` pixels.
 * @param {TimeScale} scale
 * @param {number} widthPx
 */
export function visibleEnd(scale, widthPx) {
  return xToTime(scale, scale.origin + widthPx);
}

/**
 * Clip a time range to a pixel window. Returns `null` when nothing is visible,
 * otherwise `{ x0, x1, clippedStart, clippedEnd }` with `x0 <= x1` inside
 * `[minX, maxX]`. Source timestamps are never modified; only the drawn portion.
 *
 * @param {TimeScale} scale
 * @param {number} start
 * @param {number} end
 * @param {number} minX
 * @param {number} maxX
 */
export function clipRange(scale, start, end, minX, maxX) {
  const xs = timeToX(scale, start);
  const xe = timeToX(scale, end);
  if (xe < minX || xs > maxX) return null;
  const x0 = Math.max(xs, minX);
  const x1 = Math.min(xe, maxX);
  return {
    x0,
    x1,
    clippedStart: x0 === xs ? start : xToTime(scale, x0),
    clippedEnd: x1 === xe ? end : xToTime(scale, x1),
  };
}

/**
 * Whether `[start, end)` intersects `[rangeStart, rangeEnd)`.
 * Zero-width ranges (points) intersect when inside `[rangeStart, rangeEnd]`.
 * @param {number} start
 * @param {number} end
 * @param {number} rangeStart
 * @param {number} rangeEnd
 */
export function rangesOverlap(start, end, rangeStart, rangeEnd) {
  if (start === end) return start >= rangeStart && start <= rangeEnd;
  return start < rangeEnd && end > rangeStart;
}
