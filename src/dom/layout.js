/**
 * Builds the DOM owned by the library inside the host container.
 *
 *   .tl-root (grid: labels | data ; axis / scroller / hscroll)
 *     .tl-corner            optional header above the label column
 *     .tl-axis > canvas     date axis (fixed while scrolling vertically)
 *     .tl-scroller          native vertical scroll container (focusable)
 *        .tl-spacer         sets scrollHeight = rows * rowHeight
 *        .tl-sticky         viewport-sized layer that stays in view
 *           .tl-labels      virtualized track labels
 *           .tl-canvas-area > canvas.data, canvas.overlay
 *     .tl-hscroll > .tl-hscroll-thumb   virtual horizontal scrollbar
 *     .tl-tooltip
 *     .tl-a11y              offscreen listbox for assistive technology
 */

/**
 * @param {HTMLElement} container
 * @param {{ labelWidth: number, axisHeight: number, rowHeight: number, theme: string, ariaLabel: string }} opts
 */
export function buildLayout(container, opts) {
  const doc = container.ownerDocument;
  /** @param {string} cls @param {string} [tag] */
  const el = (cls, tag = 'div') => {
    const e = doc.createElement(tag);
    e.className = cls;
    return e;
  };

  const root = el('tl-root');
  root.setAttribute('data-tl-theme', opts.theme);
  root.style.setProperty('--tl-label-width', `${opts.labelWidth}px`);
  root.style.setProperty('--tl-axis-height', `${opts.axisHeight}px`);
  root.style.setProperty('--tl-row-height', `${opts.rowHeight}px`);

  const corner = el('tl-corner');
  const axis = el('tl-axis');
  const axisCanvas = /** @type {HTMLCanvasElement} */ (el('tl-axis-canvas', 'canvas'));
  axisCanvas.setAttribute('aria-hidden', 'true');
  axis.appendChild(axisCanvas);

  const scroller = el('tl-scroller');
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'application');
  scroller.setAttribute('aria-label', opts.ariaLabel);
  scroller.setAttribute('aria-roledescription', 'timeline');
  const spacer = el('tl-spacer');
  const sticky = el('tl-sticky');
  const labels = el('tl-labels');
  labels.setAttribute('aria-hidden', 'true');
  const canvasArea = el('tl-canvas-area');
  const dataCanvas = /** @type {HTMLCanvasElement} */ (el('tl-data-canvas', 'canvas'));
  const overlayCanvas = /** @type {HTMLCanvasElement} */ (el('tl-overlay-canvas', 'canvas'));
  dataCanvas.setAttribute('aria-hidden', 'true');
  overlayCanvas.setAttribute('aria-hidden', 'true');
  canvasArea.append(dataCanvas, overlayCanvas);
  sticky.append(labels, canvasArea);
  scroller.append(spacer, sticky);

  const hscroll = el('tl-hscroll');
  hscroll.setAttribute('aria-hidden', 'true');
  const hthumb = el('tl-hscroll-thumb');
  hscroll.appendChild(hthumb);

  const tooltip = el('tl-tooltip');
  tooltip.setAttribute('role', 'tooltip');
  const a11y = el('tl-a11y');
  a11y.setAttribute('role', 'listbox');
  a11y.setAttribute('aria-label', `${opts.ariaLabel} items`);
  const live = el('tl-a11y');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');

  root.append(corner, axis, scroller, hscroll, tooltip, a11y, live);
  container.appendChild(root);

  return { root, corner, axis, axisCanvas, scroller, spacer, sticky, labels, canvasArea, dataCanvas, overlayCanvas, hscroll, hthumb, tooltip, a11y, live };
}

/** @typedef {ReturnType<typeof buildLayout>} LayoutNodes */
