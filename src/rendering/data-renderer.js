/**
 * Data layer: grid, track lines, interval bars, track markers and global
 * markers for the visible rows only. Everything is clipped to the viewport
 * and drawn through the shared time scale.
 *
 * Paint order: background -> global range bands -> grid -> track lines ->
 * intervals -> track events -> global point markers -> today line.
 *
 * The renderer consumes per-row item lists from `index.queryRow`, which is
 * the seam where density aggregation (heatmap) could be plugged in later.
 */

import { timeToX, clipRange } from '../core/time-scale.js';

/**
 * @typedef {object} RowGeometry
 * @property {number} rowHeight
 * @property {number} barHeight
 * @property {number} markerSize
 * @property {number} scrollTop
 * @property {number} firstRow
 * @property {number} lastRow inclusive
 */

/**
 * @typedef {object} DataFrame
 * @property {import('../core/time-scale.js').TimeScale} scale
 * @property {number} width
 * @property {number} height
 * @property {number} viewStart
 * @property {number} viewEnd
 * @property {import('../core/validation.js').NormalizedTrack[]} rows
 * @property {import('../core/data-index.js').DataIndex} index
 * @property {import('../core/ticks.js').Ticks} ticks
 * @property {import('./layers.js').Theme} theme
 * @property {RowGeometry} geometry
 * @property {{ showGrid: boolean, showTrackLines: boolean, showToday: boolean }} flags
 * @property {Set<string>} [hiddenIds] intervals currently represented by an edit preview
 * @property {number} now
 */

/**
 * Visible row range for a scroll position.
 * @param {number} scrollTop
 * @param {number} height
 * @param {number} rowHeight
 * @param {number} rowCount
 */
export function visibleRows(scrollTop, height, rowHeight, rowCount) {
  if (rowCount === 0 || height <= 0) return { firstRow: 0, lastRow: -1 };
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight));
  const lastRow = Math.min(rowCount - 1, Math.ceil((scrollTop + height) / rowHeight));
  return { firstRow, lastRow };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
export function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  if (radius <= 0.5) {
    ctx.rect(x, y, w, h);
    return;
  }
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Draw a marker centred at (x, cy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {'dot'|'line'|'diamond'} shape
 * @param {number} x
 * @param {number} cy
 * @param {number} size
 * @param {number} lineHeight full height for 'line' markers
 */
export function drawMarker(ctx, shape, x, cy, size, lineHeight) {
  const half = size / 2;
  switch (shape) {
    case 'dot':
      ctx.beginPath();
      ctx.arc(x, cy, half, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(x, cy - half - 1);
      ctx.lineTo(x + half + 1, cy);
      ctx.lineTo(x, cy + half + 1);
      ctx.lineTo(x - half - 1, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case 'line':
    default:
      ctx.fillRect(Math.round(x) - 1, cy - lineHeight / 2, 2, lineHeight);
      break;
  }
}

/**
 * Pixel rectangle of an interval bar inside the data canvas, or null if clipped out.
 * @param {import('../core/validation.js').NormalizedInterval} it
 * @param {number} row
 * @param {import('../core/time-scale.js').TimeScale} scale
 * @param {number} width
 * @param {RowGeometry} g
 */
export function intervalRect(it, row, scale, width, g) {
  const clipped = clipRange(scale, it.start, it.end, -2, width + 2);
  if (!clipped) return null;
  const x = clipped.x0;
  const w = Math.max(2, clipped.x1 - clipped.x0);
  const y = row * g.rowHeight - g.scrollTop + (g.rowHeight - g.barHeight) / 2;
  return { x, y, w, h: g.barHeight, clippedLeft: clipped.x0 !== timeToX(scale, it.start), clippedRight: clipped.x1 !== timeToX(scale, it.end) };
}

/**
 * Draw a row's intervals. Consecutive bars that overlap (or touch) and share
 * a colour are coalesced into one run: the union of same-height, same-colour
 * bars is pixel-identical to drawing them individually, and dense overlapping
 * data collapses from thousands of fills to a handful per row. Bars are
 * sorted by start, so a single pass suffices.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../core/validation.js').NormalizedInterval[]} intervals sorted by start
 * @param {number} row
 * @param {import('../core/validation.js').NormalizedTrack} track
 * @param {DataFrame} f
 * @param {number} width
 */
export function drawIntervalRuns(ctx, intervals, row, track, f, width) {
  const g = f.geometry;
  const radius = f.theme.barRadius;
  const fallback = track.color ?? f.theme.accent;
  /** @type {{ x0: number, x1: number, y: number, color: string } | null} */
  let run = null;
  const flush = () => {
    if (!run) return;
    ctx.fillStyle = run.color;
    roundedRect(ctx, run.x0, run.y, Math.max(2, run.x1 - run.x0), g.barHeight, radius);
    ctx.fill();
    run = null;
  };
  for (const it of intervals) {
    if (f.hiddenIds && f.hiddenIds.has(it.id)) continue;
    const r = intervalRect(it, row, f.scale, width, g);
    if (!r) continue;
    const color = it.color ?? fallback;
    const x1 = r.x + r.w;
    if (run && color === run.color && r.x <= run.x1 + 0.5) {
      if (x1 > run.x1) run.x1 = x1;
      continue;
    }
    flush();
    run = { x0: r.x, x1, y: r.y, color };
  }
  flush();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {DataFrame} f
 */
export function renderData(ctx, f) {
  const { scale, width, height, rows, index, ticks, theme, geometry: g, flags } = f;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  if (width <= 0 || height <= 0) return;

  const global = index.queryGlobal(f.viewStart, f.viewEnd);

  // Global range bands (behind everything).
  for (const ev of global.ranges) {
    const c = clipRange(scale, ev.start, ev.end, 0, width);
    if (!c) continue;
    ctx.globalAlpha = theme.globalRangeAlpha;
    ctx.fillStyle = ev.color ?? theme.accent;
    ctx.fillRect(c.x0, 0, Math.max(1, c.x1 - c.x0), height);
    ctx.globalAlpha = 1;
  }

  // Grid.
  if (flags.showGrid) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (const t of ticks.minor) {
      const x = Math.round(timeToX(scale, t.time)) + 0.5;
      if (x < 0 || x > width) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.strokeStyle = theme.gridMajor;
    ctx.beginPath();
    for (const m of ticks.major) {
      const x = Math.round(timeToX(scale, m.start)) + 0.5;
      if (x < 0 || x > width) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
  }

  // Track lines.
  if (flags.showTrackLines && g.lastRow >= g.firstRow) {
    ctx.strokeStyle = theme.trackLine;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (let row = g.firstRow; row <= g.lastRow; row++) {
      const y = Math.round(row * g.rowHeight - g.scrollTop + g.rowHeight / 2) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Intervals and track events, row by row.
  for (let row = g.firstRow; row <= g.lastRow; row++) {
    const track = rows[row];
    if (!track) continue;
    const { intervals, events } = index.queryRow(track.id, f.viewStart, f.viewEnd);
    const cy = row * g.rowHeight - g.scrollTop + g.rowHeight / 2;
    drawIntervalRuns(ctx, intervals, row, track, f, width);
    for (const ev of events) {
      const x = timeToX(scale, ev.time);
      if (x < -g.markerSize || x > width + g.markerSize) continue;
      ctx.fillStyle = ev.color ?? track.color ?? theme.accent;
      drawMarker(ctx, ev.marker, x, cy, g.markerSize, g.rowHeight - 6);
    }
  }

  // Global point markers: a line across all rows plus the shape at the top.
  for (const ev of global.points) {
    const x = timeToX(scale, ev.time);
    if (x < -g.markerSize || x > width + g.markerSize) continue;
    ctx.fillStyle = ev.color ?? theme.accent;
    ctx.fillRect(Math.round(x) - 1, 0, 2, height);
    if (ev.marker !== 'line') drawMarker(ctx, ev.marker, x, g.markerSize, g.markerSize + 2, height);
  }

  // Today.
  if (flags.showToday && f.now >= f.viewStart && f.now <= f.viewEnd) {
    const x = Math.round(timeToX(scale, f.now)) + 0.5;
    ctx.strokeStyle = theme.today;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
