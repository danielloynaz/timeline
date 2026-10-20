/**
 * Virtual horizontal scrollbar: dragging the thumb pans the viewport, clicking
 * the track pages by one viewport width.
 */

/**
 * @param {object} deps
 * @param {import('../timeline.js').Timeline} deps.timeline
 * @param {AbortSignal} deps.signal
 */
export function attachHScrollController({ timeline, signal }) {
  const { hscroll, hthumb } = timeline.nodes;
  /** @type {{ pointerId: number, startX: number, startViewStart: number } | null} */
  let drag = null;

  hthumb.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      drag = { pointerId: e.pointerId, startX: e.clientX, startViewStart: timeline.getViewport().start };
      hthumb.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  hthumb.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const v = timeline.getViewport();
      const trackW = hscroll.clientWidth;
      const domain = v.domainEnd - v.domainStart;
      const visible = v.end - v.start;
      const thumbW = Math.max(16, (trackW * visible) / domain);
      const range = Math.max(1, trackW - thumbW);
      const ms = ((e.clientX - drag.startX) / range) * (domain - visible);
      timeline.setViewportStart(drag.startViewStart + ms);
    },
    { signal },
  );
  const end = (/** @type {PointerEvent} */ e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
  };
  hthumb.addEventListener('pointerup', end, { signal });
  hthumb.addEventListener('pointercancel', end, { signal });

  hscroll.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || e.target === hthumb) return;
      const rect = hthumb.getBoundingClientRect();
      timeline.pan(e.clientX < rect.left ? -(timeline.getViewport().end - timeline.getViewport().start) : timeline.getViewport().end - timeline.getViewport().start);
    },
    { signal },
  );
}
