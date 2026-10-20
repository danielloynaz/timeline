/**
 * Deterministic hit-testing over the data index. Priority (first match wins):
 *
 *   1. resize handle of an interval (pointer within `tolerance` px of an edge)
 *   2. track-scoped event marker (nearest within `tolerance` px)
 *   3. interval containing x (the one with the latest start, i.e. drawn on top)
 *   4. global point marker (nearest within `tolerance` px) or global range band
 *   5. the empty track row under the pointer
 *
 * Coordinates are in CSS pixels relative to the data canvas.
 */

import { xToTime, timeToX } from '../core/time-scale.js';
import { intervalRect } from './data-renderer.js';

/**
 * @typedef {object} HitResult
 * @property {'interval'|'event'|'track'|null} kind
 * @property {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent | null} item
 * @property {import('../core/validation.js').NormalizedTrack | null} track
 * @property {number} row -1 when outside rows
 * @property {'start'|'end'|null} handle
 * @property {number} time timestamp under the pointer
 */

/**
 * @param {ReturnType<import('../timeline.js').Timeline['frame']>} f
 * @param {number} x
 * @param {number} y
 * @param {number} tolerance px
 * @param {{ handles?: boolean }} [opts] whether to report resize handles
 * @returns {HitResult}
 */
export function hitTest(f, x, y, tolerance, opts = {}) {
  const g = f.geometry;
  const time = xToTime(f.scale, x);
  const tolMs = tolerance / f.scale.pxPerMs;
  const row = Math.floor((y + g.scrollTop) / g.rowHeight);
  const track = row >= 0 && row < f.rows.length ? f.rows[row] : null;
  /** @type {HitResult} */
  const miss = { kind: null, item: null, track, row: track ? row : -1, handle: null, time };

  if (track) {
    const { intervals, events } = f.index.queryRow(track.id, time - tolMs, time + tolMs);
    const cy = row * g.rowHeight - g.scrollTop + g.rowHeight / 2;

    // 1. handles
    if (opts.handles !== false) {
      /** @type {{ it: import('../core/validation.js').NormalizedInterval, handle: 'start'|'end', d: number } | null} */
      let best = null;
      for (const it of intervals) {
        const r = intervalRect(it, row, f.scale, f.width, g);
        if (!r || Math.abs(y - cy) > Math.max(g.barHeight, tolerance * 2)) continue;
        const xs = timeToX(f.scale, it.start);
        const xe = timeToX(f.scale, it.end);
        if (r.w < tolerance * 3) continue; // too thin to expose handles
        if (!r.clippedLeft && Math.abs(x - xs) <= tolerance) best = { it, handle: /** @type {'start'} */ ('start'), d: Math.abs(x - xs) };
        if (!r.clippedRight && Math.abs(x - xe) <= tolerance && (!best || Math.abs(x - xe) < best.d)) {
          best = { it, handle: /** @type {'end'} */ ('end'), d: Math.abs(x - xe) };
        }
      }
      if (best) return { kind: 'interval', item: best.it, track, row, handle: best.handle, time };
    }

    // 2. track events
    /** @type {import('../core/validation.js').NormalizedEvent | null} */
    let nearest = null;
    let nearestD = Infinity;
    for (const ev of events) {
      const d = Math.abs(timeToX(f.scale, ev.time) - x);
      const reach = ev.marker === 'line' ? Math.max(tolerance, 2) : Math.max(tolerance, g.markerSize / 2 + 1);
      if (d <= reach && d < nearestD && Math.abs(y - cy) <= g.rowHeight / 2) {
        nearest = ev;
        nearestD = d;
      }
    }
    if (nearest) return { kind: 'event', item: nearest, track, row, handle: null, time };

    // 3. intervals containing x (latest start wins; index order is by start asc)
    for (let i = intervals.length - 1; i >= 0; i--) {
      const it = intervals[i];
      const r = intervalRect(it, row, f.scale, f.width, g);
      if (!r) continue;
      if (x >= r.x - 1 && x <= r.x + r.w + 1 && y >= r.y - tolerance && y <= r.y + r.h + tolerance) {
        return { kind: 'interval', item: it, track, row, handle: null, time };
      }
    }
  }

  // 4. global markers
  const global = f.index.queryGlobal(time - tolMs, time + tolMs);
  /** @type {import('../core/validation.js').NormalizedEvent | null} */
  let nearest = null;
  let nearestD = Infinity;
  for (const ev of global.points) {
    const d = Math.abs(timeToX(f.scale, ev.time) - x);
    if (d <= Math.max(tolerance, 2) && d < nearestD) {
      nearest = ev;
      nearestD = d;
    }
  }
  if (nearest) return { kind: 'event', item: nearest, track, row: track ? row : -1, handle: null, time };
  for (let i = global.ranges.length - 1; i >= 0; i--) {
    const ev = global.ranges[i];
    if (time >= ev.start && time <= ev.end) return { kind: 'event', item: ev, track, row: track ? row : -1, handle: null, time };
  }

  // 5. empty row
  if (track) return { kind: 'track', item: null, track, row, handle: null, time };
  return miss;
}
