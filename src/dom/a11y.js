/**
 * Accessible representation of the Canvas content.
 *
 * The scroller is a focusable `role="application"` element. An offscreen
 * `role="listbox"` holds one `role="option"` per item currently in the
 * viewport (bounded), plus the focused item; `aria-activedescendant` on the
 * scroller points at the focused option, and a polite live region announces
 * focus changes. Descriptions are textual (label, track, dates, duration) so
 * nothing depends on Canvas pixels or hover.
 */

import { describeItemText } from './tooltip.js';

const MAX_OPTIONS = 400;
let counter = 0;

/**
 * @param {object} deps
 * @param {import('../timeline.js').Timeline} deps.timeline
 */
export function createA11y({ timeline }) {
  const { scroller, a11y, live } = timeline.nodes;
  const prefix = `tl-${++counter}`;
  /** @type {Map<string, HTMLElement>} */
  const nodes = new Map();
  /** @type {string | null} */
  let lastAnnounced = null;
  /** @type {string | null} */
  let lastFocus = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let pending = null;
  /** @type {(() => ReturnType<import('../timeline.js').Timeline['frame']>) | null} */
  let pendingFrame = null;
  let lastSelectionVersion = -1;

  /**
   * Schedule a listbox refresh. Viewport changes during scrolling are
   * coalesced (assistive technology does not need per-frame updates); a focus
   * change is applied immediately so `aria-activedescendant` is never stale.
   * @param {() => ReturnType<import('../timeline.js').Timeline['frame']>} getFrame
   * @param {string | null} focusId
   * @param {number} selectionVersion
   */
  function schedule(getFrame, focusId, selectionVersion) {
    const selectionChanged = selectionVersion !== lastSelectionVersion;
    lastSelectionVersion = selectionVersion;
    if (nodes.size === 0 || selectionChanged || focusId !== lastFocus || (focusId && !nodes.has(focusId))) {
      if (pending) clearTimeout(pending);
      pending = null;
      render(getFrame(), focusId);
      return;
    }
    pendingFrame = getFrame;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (pendingFrame) render(pendingFrame(), lastFocus);
    }, 150);
  }

  /**
   * @param {ReturnType<import('../timeline.js').Timeline['frame']>} f
   * @param {string | null} focusId
   */
  function render(f, focusId) {
    lastFocus = focusId;
    /** @type {Array<import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent>} */
    const items = [];
    for (let row = f.geometry.firstRow; row <= f.geometry.lastRow && items.length < MAX_OPTIONS; row++) {
      const track = f.rows[row];
      if (!track) continue;
      const { intervals, events } = f.index.queryRow(track.id, f.viewStart, f.viewEnd);
      items.push(...intervals, ...events);
    }
    const g = f.index.queryGlobal(f.viewStart, f.viewEnd);
    items.push(...g.points, ...g.ranges);
    const focused = focusId ? (f.index.intervalById.get(focusId) ?? f.index.eventById.get(focusId)) : null;
    if (focused && !items.includes(focused)) items.unshift(focused);
    const keep = new Set();
    const doc = a11y.ownerDocument;
    for (const it of items.slice(0, MAX_OPTIONS)) {
      keep.add(it.id);
      let node = nodes.get(it.id);
      if (!node) {
        node = doc.createElement('div');
        node.setAttribute('role', 'option');
        node.id = `${prefix}-${nodes.size}-${encodeURIComponent(it.id)}`;
        a11y.appendChild(node);
        nodes.set(it.id, node);
        const track = it.trackId ? f.index.trackById.get(it.trackId) : null;
        node.textContent = describeItemText(it, track, f.formatter);
      }
      node.setAttribute('aria-selected', String(f.selection.has(it.id)));
    }
    for (const [id, node] of nodes) {
      if (!keep.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    const focusNode = focusId ? nodes.get(focusId) : null;
    if (focusNode) {
      scroller.setAttribute('aria-activedescendant', focusNode.id);
      if (lastAnnounced !== focusId) {
        lastAnnounced = focusId;
        live.textContent = focusNode.textContent;
      }
    } else {
      scroller.removeAttribute('aria-activedescendant');
      lastAnnounced = null;
    }
    const total = f.index.intervalById.size + f.index.eventById.size;
    scroller.setAttribute('aria-description', `${f.rows.length} tracks, ${total} items. Use arrow keys to move between items, Space to select, Enter to activate.`);
  }

  /** Reset per-item text (data changed). */
  function reset() {
    for (const node of nodes.values()) node.remove();
    nodes.clear();
  }

  function dispose() {
    if (pending) clearTimeout(pending);
    pending = null;
    reset();
  }

  /** @param {string} text */
  function announce(text) {
    live.textContent = text;
  }

  return { render, schedule, reset, dispose, announce };
}
