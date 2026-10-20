/**
 * Overlay layer: hover highlight, selection outlines, keyboard focus ring,
 * interval edit previews and the range marquee. Redrawn independently of the
 * (expensive) data layer.
 */

import { timeToX, clipRange } from '../core/time-scale.js';
import { intervalRect, roundedRect, drawMarker } from './data-renderer.js';

/**
 * @typedef {object} OverlayState
 * @property {string | null} hoverId
 * @property {string | null} focusId
 * @property {{ start: number, end: number } | null} marquee
 * @property {Array<{ trackId: string, start: number, end: number, label: string, pending: boolean, id: string | null }>} previews
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import('../timeline.js').Timeline['frame']>} f
 * @param {OverlayState} state
 */
export function renderOverlay(ctx, f, state) {
  const { width, height, theme, geometry: g } = f;
  if (width <= 0 || height <= 0) return;
  ctx.font = theme.font;

  /**
   * Draw an outline around an item by id.
   * @param {string} id
   * @param {string} color
   * @param {number} lineWidth
   * @param {boolean} [glow]
   */
  const outline = (id, color, lineWidth, glow = false) => {
    const it = f.index.intervalById.get(id);
    if (it) {
      const row = f.rowOfTrack.get(it.trackId);
      if (row === undefined || row < g.firstRow || row > g.lastRow) return;
      const r = intervalRect(it, row, f.scale, width, g);
      if (!r) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (glow) {
        ctx.fillStyle = theme.hover;
        roundedRect(ctx, r.x - 2, r.y - 3, r.w + 4, r.h + 6, theme.barRadius + 2);
        ctx.fill();
      }
      roundedRect(ctx, r.x - 1.5, r.y - 2.5, r.w + 3, r.h + 5, theme.barRadius + 1);
      ctx.stroke();
      return;
    }
    const ev = f.index.eventById.get(id);
    if (!ev) return;
    const x = timeToX(f.scale, ev.time);
    if (ev.scope === 'global') {
      if (ev.isRange) {
        const c = clipRange(f.scale, ev.start, ev.end, 0, width);
        if (!c) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(c.x0 + 0.5, 0.5, Math.max(1, c.x1 - c.x0) - 1, height - 1);
        return;
      }
      if (x < -4 || x > width + 4) return;
      ctx.fillStyle = color;
      ctx.globalAlpha = glow ? 0.35 : 0.8;
      ctx.fillRect(Math.round(x) - 2 - lineWidth / 2, 0, 4 + lineWidth, height);
      ctx.globalAlpha = 1;
      return;
    }
    const row = f.rowOfTrack.get(/** @type {string} */ (ev.trackId));
    if (row === undefined || row < g.firstRow || row > g.lastRow) return;
    if (x < -g.markerSize || x > width + g.markerSize) return;
    const cy = row * g.rowHeight - g.scrollTop + g.rowHeight / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (ev.marker === 'line') ctx.strokeRect(Math.round(x) - 3.5, cy - (g.rowHeight - 6) / 2 - 2.5, 7, g.rowHeight - 6 + 5);
    else {
      ctx.beginPath();
      ctx.arc(x, cy, g.markerSize / 2 + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  // Hover
  if (state.hoverId && !f.selection.has(state.hoverId)) outline(state.hoverId, theme.hover, 1.5, true);
  // Selection
  for (const id of f.selection) outline(id, theme.selection, id === f.primaryId ? 2 : 1.5);
  // Keyboard focus
  if (state.focusId) outline(state.focusId, theme.focus, 2);

  // Edit previews
  for (const p of state.previews) {
    const row = f.rowOfTrack.get(p.trackId);
    if (row === undefined) continue;
    const c = clipRange(f.scale, p.start, p.end, -2, width + 2);
    if (!c) continue;
    const y = row * g.rowHeight - g.scrollTop + (g.rowHeight - g.barHeight) / 2;
    const w = Math.max(2, c.x1 - c.x0);
    ctx.save();
    ctx.globalAlpha = p.pending ? 0.5 : 0.85;
    ctx.fillStyle = theme.accent;
    roundedRect(ctx, c.x0, y, w, g.barHeight, theme.barRadius);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.preview;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(p.pending ? [4, 3] : []);
    roundedRect(ctx, c.x0 - 1.5, y - 2.5, w + 3, g.barHeight + 5, theme.barRadius + 1);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!p.pending && p.label) {
      ctx.fillStyle = theme.fg;
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'center';
      const tw = ctx.measureText(p.label).width;
      const lx = Math.min(width - tw / 2 - 4, Math.max(tw / 2 + 4, (c.x0 + c.x1) / 2));
      ctx.fillText(p.label, lx, y - 6);
    }
    ctx.restore();
  }

  // Marquee
  if (state.marquee) {
    const c = clipRange(f.scale, Math.min(state.marquee.start, state.marquee.end), Math.max(state.marquee.start, state.marquee.end), 0, width);
    if (c) {
      ctx.fillStyle = theme.marquee;
      ctx.fillRect(c.x0, 0, Math.max(1, c.x1 - c.x0), height);
      ctx.strokeStyle = theme.focus;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(c.x0) + 0.5, 0);
      ctx.lineTo(Math.round(c.x0) + 0.5, height);
      ctx.moveTo(Math.round(c.x1) - 0.5, 0);
      ctx.lineTo(Math.round(c.x1) - 0.5, height);
      ctx.stroke();
    }
  }

  // Marker legend hint for a11y: nothing drawn; shapes already differ.
  void drawMarker;
}
