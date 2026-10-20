/**
 * Keyboard access. Only active while the timeline scroller has focus, and
 * only keys the timeline handles are prevented, so host shortcuts keep working.
 *
 *   ← / →            previous / next item on the focused track
 *   ↑ / ↓            nearest item on the previous / next track
 *   Home / End       first / last item on the focused track
 *   Shift + ← / →    pan by 10 % of the visible range
 *   + / = / -        zoom in / out (centre)
 *   Space            toggle selection of the focused item
 *   Enter            select the focused item and emit `eventActivate`
 *   Escape           cancel an in-progress edit or gesture, otherwise clear focus
 */

/**
 * @param {object} deps
 * @param {import('../timeline.js').Timeline} deps.timeline
 * @param {ReturnType<typeof import('./selection-controller.js').createSelectionController>} deps.selection
 * @param {ReturnType<typeof import('./interval-editor.js').createIntervalEditor>} deps.editor
 * @param {{ cancelGesture: () => boolean }} deps.pointer
 * @param {{ getFocus: () => string | null, setFocus: (id: string | null) => void }} deps.focus
 * @param {AbortSignal} deps.signal
 */
export function attachKeyboardController({ timeline, selection, editor, pointer, focus, signal }) {
  const scroller = timeline.nodes.scroller;

  /** @type {Map<string, Array<import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent>>} */
  let orderCache = new Map();
  let cacheIndex = timeline.index;

  /** @param {string} trackId */
  const itemsOnTrack = (trackId) => {
    if (cacheIndex !== timeline.index) {
      orderCache = new Map();
      cacheIndex = timeline.index;
    }
    let list = orderCache.get(trackId);
    if (!list) {
      const b = timeline.index.byTrack.get(trackId);
      list = b ? [...b.intervals.items, ...b.events.items].sort((a, b2) => timeOf(a) - timeOf(b2) || (a.id < b2.id ? -1 : 1)) : [];
      orderCache.set(trackId, list);
    }
    return list;
  };
  /** @param {{ kind: string, start?: number, time?: number }} it */
  const timeOf = (it) => (it.kind === 'interval' ? /** @type {number} */ (it.start) : /** @type {number} */ (it.time));

  /** @param {string | null} id */
  const resolve = (id) => (id ? (timeline.index.intervalById.get(id) ?? timeline.index.eventById.get(id) ?? null) : null);

  /**
   * Make an item visible (row + time) and set focus on it.
   * @param {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent} it
   */
  const focusItem = (it) => {
    const row = it.trackId ? timeline.frame().rowOfTrack.get(it.trackId) : undefined;
    if (row !== undefined) timeline.scrollRowIntoView(row);
    timeline.ensureTimeVisible(it.start, it.end);
    focus.setFocus(it.id);
  };

  /** First item visible in the viewport, scanning rows from the top. */
  const firstVisibleItem = () => {
    const f = timeline.frame();
    for (let row = f.geometry.firstRow; row <= f.geometry.lastRow; row++) {
      const track = f.rows[row];
      if (!track) continue;
      const { intervals, events } = f.index.queryRow(track.id, f.viewStart, f.viewEnd);
      const items = [...intervals, ...events].sort((a, b) => timeOf(a) - timeOf(b));
      if (items.length) return items[0];
    }
    const g = f.index.queryGlobal(f.viewStart, f.viewEnd);
    return g.points[0] ?? g.ranges[0] ?? null;
  };

  /**
   * @param {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent} cur
   * @param {number} dir
   */
  const siblingOnTrack = (cur, dir) => {
    if (!cur.trackId) return null;
    const list = itemsOnTrack(cur.trackId);
    const i = list.findIndex((x) => x.id === cur.id);
    const next = list[i + dir];
    return next ?? null;
  };

  /**
   * @param {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent} cur
   * @param {number} dir
   */
  const nearestOnAdjacentTrack = (cur, dir) => {
    const f = timeline.frame();
    const t = timeOf(cur);
    let row = cur.trackId ? (f.rowOfTrack.get(cur.trackId) ?? -1) : -1;
    for (let guard = 0; guard < f.rows.length; guard++) {
      row += dir;
      if (row < 0 || row >= f.rows.length) return null;
      const list = itemsOnTrack(f.rows[row].id);
      if (!list.length) continue;
      let best = list[0];
      let bestD = Math.abs(timeOf(best) - t);
      for (const it of list) {
        const d = Math.abs(timeOf(it) - t);
        if (d < bestD) {
          best = it;
          bestD = d;
        }
      }
      return best;
    }
    return null;
  };

  scroller.addEventListener(
    'keydown',
    (e) => {
      delete scroller.dataset.tlPointerFocus;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const cur = resolve(focus.getFocus());
      const v = timeline.getViewport();
      const visible = v.end - v.start;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight': {
          const dir = e.key === 'ArrowRight' ? 1 : -1;
          if (e.shiftKey) {
            timeline.pan(dir * visible * 0.1);
            break;
          }
          const next = cur ? siblingOnTrack(cur, dir) : firstVisibleItem();
          if (next) focusItem(next);
          break;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          if (e.shiftKey) {
            handled = false;
            break;
          }
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          const next = cur ? nearestOnAdjacentTrack(cur, dir) : firstVisibleItem();
          if (next) focusItem(next);
          break;
        }
        case 'Home':
        case 'End': {
          if (!cur?.trackId) {
            handled = false;
            break;
          }
          const list = itemsOnTrack(cur.trackId);
          const next = e.key === 'Home' ? list[0] : list[list.length - 1];
          if (next) focusItem(next);
          break;
        }
        case '+':
        case '=':
          timeline.zoom('in');
          break;
        case '-':
        case '_':
          timeline.zoom('out');
          break;
        case ' ':
          if (!cur) {
            handled = false;
            break;
          }
          selection.keyboard(cur.id, 'toggle');
          break;
        case 'Enter':
          if (!cur) {
            handled = false;
            break;
          }
          selection.keyboard(cur.id, e.shiftKey ? 'add' : 'replace');
          timeline.emit('eventActivate', { id: cur.id, kind: cur.kind, trackId: cur.trackId ?? null, source: 'keyboard' });
          break;
        case 'Escape':
          if (editor.isEditing) editor.cancel('escape');
          else if (!pointer.cancelGesture()) {
            if (cur) focus.setFocus(null);
            else handled = false;
          }
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    },
    { signal },
  );

  scroller.addEventListener(
    'blur',
    () => {
      delete scroller.dataset.tlPointerFocus;
      if (editor.isEditing) editor.cancel('blur');
    },
    { signal },
  );
}
