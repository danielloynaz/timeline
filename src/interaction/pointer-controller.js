/**
 * Pointer gestures on the data canvas.
 *
 * pointerdown resolution (first match wins):
 *   right button, or shift+left         → range marquee (emits `rangeSelect`)
 *   left on a resize handle (editable)  → resize
 *   left on an editable interval        → move
 *   left on an empty editable track     → create (after a 3 px drag)
 *   otherwise                           → pan (horizontal + vertical)
 *   no drag (< 3 px)                    → click: selection + `itemClick`
 *
 * wheel: ctrl/meta (and trackpad pinch) → pointer-centred zoom; shift or
 * horizontal delta → pan; plain vertical wheel → native vertical scrolling.
 * Hover is throttled to animation frames and never scans the full dataset.
 */

import { hitTest } from '../rendering/hit-testing.js';
import { xToTime } from '../core/time-scale.js';

const DRAG_THRESHOLD = 3;

/**
 * @param {object} deps
 * @param {import('../timeline.js').Timeline} deps.timeline
 * @param {ReturnType<typeof import('../interaction/selection-controller.js').createSelectionController>} deps.selection
 * @param {ReturnType<typeof import('../interaction/interval-editor.js').createIntervalEditor>} deps.editor
 * @param {{ setHover: (id: string | null) => void, setMarquee: (m: { start: number, end: number } | null) => void }} deps.overlay
 * @param {{ show: (id: string, hit: import('../rendering/hit-testing.js').HitResult, x: number, y: number) => void, move: (x: number, y: number) => void, hide: () => void }} deps.tooltip
 * @param {AbortSignal} deps.signal
 */
export function attachPointerController({ timeline, selection, editor, overlay, tooltip, signal }) {
  const area = timeline.nodes.canvasArea;
  const scroller = timeline.nodes.scroller;
  const o = () => timeline.options;

  /**
   * @typedef {object} Gesture
   * @property {number} pointerId
   * @property {number} startX
   * @property {number} startY
   * @property {number} lastX
   * @property {number} lastY
   * @property {number} startScrollTop
   * @property {'pending'|'pan'|'marquee'|'edit'} mode
   * @property {import('../rendering/hit-testing.js').HitResult} hit
   * @property {number} button
   * @property {boolean} shift
   */
  /** @type {Gesture | null} */
  let gesture = null;
  /** @type {string | null} */
  let hoverId = null;
  let hoverRaf = 0;
  /** @type {{ x: number, y: number } | null} */
  let pendingHover = null;

  /** @param {PointerEvent | MouseEvent} e */
  const local = (e) => {
    const r = area.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** @param {PointerEvent | MouseEvent | WheelEvent | KeyboardEvent} e */
  const mods = (e) => ({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
  /** @param {import('../rendering/hit-testing.js').HitResult} hit */
  const idOf = (hit) => (hit.item ? hit.item.id : null);

  /** @param {string} cursor */
  const setCursor = (cursor) => {
    if (area.dataset.tlCursor !== cursor) area.dataset.tlCursor = cursor;
  };

  /**
   * @param {string} name
   * @param {import('../rendering/hit-testing.js').HitResult} hit
   * @param {PointerEvent | MouseEvent} e
   * @param {{ x: number, y: number }} p
   * @param {boolean} [cancelable]
   */
  const emitLowLevel = (name, hit, e, p, cancelable = false) =>
    timeline.emit(
      name,
      {
        ids: hit.item ? [hit.item.id] : [],
        kind: hit.kind,
        trackId: hit.track?.id ?? hit.item?.trackId ?? null,
        time: hit.time,
        x: p.x,
        y: p.y,
        modifiers: mods(e),
        originalEvent: e,
      },
      { cancelable },
    );

  /** @param {{ x: number, y: number }} p */
  const hitAt = (p) => hitTest(timeline.frame(), p.x, p.y, o().hitTolerance, { handles: o().editable });

  /** @param {PointerEvent} e */
  const updateHover = (e) => {
    pendingHover = { ...local(e), ...{ event: e } };
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      if (!pendingHover || gesture) return;
      const p = pendingHover;
      const hit = hitAt(p);
      const id = idOf(hit);
      if (hit.kind === 'interval' && hit.handle && hit.item && editor.isEditable(/** @type {any} */ (hit.item))) setCursor('ew-resize');
      else if (hit.kind === 'interval' && hit.item && editor.isEditable(/** @type {any} */ (hit.item))) setCursor('move');
      else if (hit.item) setCursor('pointer');
      else if (hit.track && editor.isTrackEditable(hit.track)) setCursor('crosshair');
      else setCursor('grab');
      if (id !== hoverId) {
        hoverId = id;
        overlay.setHover(id);
        timeline.emit('hover', {
          ids: id ? [id] : [],
          kind: hit.kind,
          trackId: hit.track?.id ?? hit.item?.trackId ?? null,
          time: hit.time,
          x: p.x,
          y: p.y,
        });
      }
      if (id && o().tooltips) tooltip.show(id, hit, p.x, p.y);
      else tooltip.hide();
    });
  };

  const clearHover = () => {
    pendingHover = null;
    if (hoverId !== null) {
      hoverId = null;
      overlay.setHover(null);
      timeline.emit('hover', { ids: [], kind: null, trackId: null, time: NaN, x: NaN, y: NaN });
    }
    tooltip.hide();
  };

  area.addEventListener(
    'pointerdown',
    (e) => {
      if (gesture) return;
      if (e.button !== 0 && e.button !== 2) return;
      const p = local(e);
      const hit = hitAt(p);
      gesture = { pointerId: e.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, startScrollTop: scroller.scrollTop, mode: 'pending', hit, button: e.button, shift: e.shiftKey };
      area.setPointerCapture(e.pointerId);
      tooltip.hide();
      if (e.button === 0) {
        scroller.dataset.tlPointerFocus = 'true'; // keyboard focus ring only for keyboard-initiated focus
        scroller.focus({ preventScroll: true });
      }
    },
    { signal },
  );

  area.addEventListener(
    'pointermove',
    (e) => {
      if (!gesture || e.pointerId !== gesture.pointerId) {
        if (!gesture) updateHover(e);
        return;
      }
      const g = gesture;
      const p = local(e);
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      if (g.mode === 'pending') {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.mode = resolveDrag(g);
        if (g.mode === 'pan') setCursor('grabbing');
      }
      const time = xToTime(timeline.scale, p.x);
      switch (g.mode) {
        case 'pan':
          timeline.panByPixels(g.lastX - p.x);
          scroller.scrollTop = g.startScrollTop - dy;
          break;
        case 'marquee':
          overlay.setMarquee({ start: xToTime(timeline.scale, g.startX), end: time });
          break;
        case 'edit':
          editor.update(time);
          break;
      }
      g.lastX = p.x;
      g.lastY = p.y;
    },
    { signal },
  );

  /** @param {Gesture} g @returns {Gesture['mode']} */
  const resolveDrag = (g) => {
    if (g.button === 2 || g.shift) return 'marquee';
    const hit = g.hit;
    if (hit.kind === 'interval' && hit.item && editor.isEditable(/** @type {any} */ (hit.item))) {
      const op = hit.handle === 'start' ? 'resize-start' : hit.handle === 'end' ? 'resize-end' : 'move';
      if (editor.beginExisting(/** @type {any} */ (hit.item), op, hit.time)) return 'edit';
    }
    if (hit.kind === 'track' && hit.track && editor.isTrackEditable(hit.track)) {
      if (editor.beginCreate(hit.track, hit.time)) return 'edit';
    }
    return 'pan';
  };

  /** @param {PointerEvent} e */
  const finish = (e) => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    gesture = null;
    try {
      area.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    const p = local(e);
    if (e.type === 'pointercancel') {
      if (g.mode === 'edit') editor.cancel('pointercancel');
      overlay.setMarquee(null);
      setCursor('grab');
      return;
    }
    switch (g.mode) {
      case 'pending': {
        if (g.button === 2) break; // context menu handled separately
        const id = idOf(g.hit);
        if (o().selectable) selection.click(id, mods(e));
        emitLowLevel('itemClick', g.hit, e, p);
        break;
      }
      case 'marquee': {
        const a = xToTime(timeline.scale, g.startX);
        const b = xToTime(timeline.scale, p.x);
        overlay.setMarquee(null);
        if (Math.abs(p.x - g.startX) >= DRAG_THRESHOLD) {
          timeline.emit('rangeSelect', { start: Math.min(a, b), end: Math.max(a, b), modifiers: mods(e) });
        }
        break;
      }
      case 'edit':
        editor.commit();
        break;
      case 'pan':
        break;
    }
    setCursor('grab');
    updateHover(e);
  };
  area.addEventListener('pointerup', finish, { signal });
  area.addEventListener('pointercancel', finish, { signal });
  area.addEventListener('lostpointercapture', (e) => {
    if (gesture && e.pointerId === gesture.pointerId) finish(new PointerEvent('pointercancel', e));
  }, { signal });
  area.addEventListener('pointerleave', () => {
    if (!gesture) clearHover();
  }, { signal });

  area.addEventListener(
    'dblclick',
    (e) => {
      const p = local(e);
      const hit = hitAt(p);
      emitLowLevel('itemDoubleClick', hit, e, p);
      if (hit.item) timeline.emit('eventActivate', { id: hit.item.id, kind: hit.kind, trackId: hit.track?.id ?? hit.item.trackId ?? null, source: 'pointer' });
    },
    { signal },
  );

  area.addEventListener(
    'contextmenu',
    (e) => {
      const p = local(e);
      const hit = hitAt(p);
      const allowed = emitLowLevel('contextMenu', hit, e, p, true);
      if (!allowed) e.preventDefault();
    },
    { signal },
  );

  area.addEventListener(
    'wheel',
    (e) => {
      const zoomGesture = e.ctrlKey || e.metaKey || o().wheelZoom === 'always';
      if (zoomGesture) {
        e.preventDefault();
        const p = local(e);
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        const factor = Math.pow(o().zoom.wheelFactor, -delta / 50);
        timeline.zoom(factor, p.x);
        updateHover(/** @type {PointerEvent} */ (/** @type {unknown} */ (e)));
        return;
      }
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        timeline.panByPixels(d);
      }
      // plain vertical wheel: let the scroller scroll natively
    },
    { signal, passive: false },
  );

  // Cancel an edit if the window loses focus mid-drag.
  window.addEventListener(
    'blur',
    () => {
      if (gesture?.mode === 'edit') editor.cancel('blur');
      if (gesture) {
        overlay.setMarquee(null);
        gesture = null;
      }
    },
    { signal },
  );

  setCursor('grab');
  signal.addEventListener('abort', () => {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    hoverRaf = 0;
    pendingHover = null;
  });

  return {
    get hoverId() {
      return hoverId;
    },
    /** Cancel any in-flight gesture (Escape). Returns true if something was cancelled. */
    cancelGesture() {
      if (!gesture) return false;
      const g = gesture;
      gesture = null;
      try {
        area.releasePointerCapture(g.pointerId);
      } catch {
        /* noop */
      }
      if (g.mode === 'edit') editor.cancel('escape');
      overlay.setMarquee(null);
      setCursor('grab');
      return true;
    },
    clearHover,
  };
}
