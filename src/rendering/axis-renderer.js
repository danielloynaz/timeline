/**
 * Date axis: major spans (e.g. months) labelled and centred within their
 * visible portion, minor ticks (e.g. weeks) with short labels to their right.
 */

import { timeToX } from '../core/time-scale.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} frame
 * @param {import('../core/time-scale.js').TimeScale} frame.scale
 * @param {number} frame.width
 * @param {number} frame.height
 * @param {import('../core/ticks.js').Ticks} frame.ticks
 * @param {import('./layers.js').Theme} frame.theme
 */
export function renderAxis(ctx, { scale, width, height, ticks, theme }) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.axisBg;
  ctx.fillRect(0, 0, width, height);
  ctx.font = theme.font;
  ctx.textBaseline = 'middle';

  const hasMajor = ticks.major.length > 0;
  const majorY = height * 0.3;
  const minorY = hasMajor ? height * 0.72 : height * 0.5;
  const tickTop = hasMajor ? height * 0.5 : height * 0.25;

  // Major spans: boundary lines and centred, clamped labels.
  if (hasMajor) {
    ctx.fillStyle = theme.fg;
    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 1;
    for (const span of ticks.major) {
      const xs = timeToX(scale, span.start);
      const xe = timeToX(scale, span.end);
      const x0 = Math.max(0, xs);
      const x1 = Math.min(width, xe);
      if (xs >= 0 && xs <= width) {
        ctx.beginPath();
        ctx.moveTo(Math.round(xs) + 0.5, 0);
        ctx.lineTo(Math.round(xs) + 0.5, height);
        ctx.stroke();
      }
      const tw = ctx.measureText(span.label).width;
      if (x1 - x0 < tw + 8) continue; // not enough room in the visible slice
      ctx.textAlign = 'center';
      ctx.fillText(span.label, (x0 + x1) / 2, majorY);
    }
  }

  // Minor ticks.
  ctx.strokeStyle = theme.gridMajor;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'left';
  let lastLabelEnd = -Infinity;
  for (const tick of ticks.minor) {
    const x = timeToX(scale, tick.time);
    if (x < -1 || x > width + 1) continue;
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, tickTop);
    ctx.lineTo(px, height);
    ctx.stroke();
    const tw = ctx.measureText(tick.label).width;
    if (x + 4 > lastLabelEnd && x + 4 + tw < width) {
      ctx.fillText(tick.label, x + 4, minorY);
      lastLabelEnd = x + 4 + tw + 6;
    }
  }

  // Baseline.
  ctx.strokeStyle = theme.gridMajor;
  ctx.beginPath();
  ctx.moveTo(0, height - 0.5);
  ctx.lineTo(width, height - 0.5);
  ctx.stroke();
}
