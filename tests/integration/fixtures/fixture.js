import { Timeline, TimelineError, ErrorCodes } from '@itech/timeline';

const D = (month, day, hour = 0) => Date.UTC(2026, month - 1, day, hour);

/** Deterministic data used by every integration spec. */
export const DATA = {
  tracks: [
    { id: 'phone-1', label: '9373064574' },
    { id: 'phone-2', label: '7575859695' },
    { id: 'phone-3', label: '9378312462' },
    { id: 'locked', label: 'locked track', editable: false },
  ],
  intervals: [
    { id: 'iv-a', trackId: 'phone-3', start: new Date(D(3, 10)).toISOString(), end: new Date(D(3, 20)).toISOString(), editable: true, metadata: { category: 'activity' } },
    { id: 'iv-b', trackId: 'phone-3', start: new Date(D(4, 1)).toISOString(), end: new Date(D(4, 15)).toISOString(), editable: true },
    { id: 'iv-locked', trackId: 'phone-1', start: new Date(D(3, 5)).toISOString(), end: new Date(D(3, 8)).toISOString(), editable: false },
    { id: 'iv-long', trackId: 'phone-2', start: new Date(D(2, 1)).toISOString(), end: new Date(D(6, 1)).toISOString() },
  ],
  events: [
    { id: 'ev-dot', trackId: 'phone-2', date: new Date(D(3, 25)).toISOString(), type: 'call', marker: 'dot', label: 'Call' },
    { id: 'ev-global', scope: 'global', date: new Date(D(3, 15)).toISOString(), type: 'alert', marker: 'line', label: 'Alert' },
    { id: 'ev-range', scope: 'global', start: new Date(D(4, 20)).toISOString(), end: new Date(D(4, 25)).toISOString(), type: 'maintenance' },
  ],
};

export const BASE_OPTIONS = {
  startDate: '2026-02-01T00:00:00Z',
  endDate: '2026-06-30T23:59:59Z',
  theme: 'dark',
  editable: true,
  selectable: true,
  showToday: false,
  locale: 'en-US',
  timeZone: 'UTC',
  rowHeight: 40,
  labelWidth: 160,
  barHeight: 8,
  zoom: { initial: 'week', min: 'day', max: 'quarter' },
};

const TL = {
  Timeline,
  TimelineError,
  ErrorCodes,
  /** @type {Timeline | null} */
  instance: null,
  /** @type {Array<{ name: string, detail: any }>} */
  events: [],
  DATA,
  BASE_OPTIONS,

  /**
   * @param {object} [options]
   * @param {object | null} [data] null = no data
   * @param {{ start: string, end: string } | null} [viewport]
   */
  create(options = {}, data = DATA, viewport = { start: '2026-03-01T00:00:00Z', end: '2026-04-30T00:00:00Z' }) {
    this.destroy();
    this.events = [];
    const host = /** @type {HTMLElement} */ (document.querySelector('#host'));
    const t = new Timeline(host, { ...BASE_OPTIONS, ...options });
    for (const name of Object.values(await_events)) {
      t.on(name, (e) => {
        const d = { ...e.detail };
        delete d.originalEvent;
        this.events.push({ name: d.type, detail: d });
      });
    }
    if (data) t.setData(data);
    if (viewport) t.setViewport(viewport);
    t.flush();
    this.instance = t;
    return this.summary();
  },

  destroy() {
    this.instance?.destroy();
    this.instance = null;
  },

  /** Serialisable state snapshot. */
  summary() {
    const t = /** @type {Timeline} */ (this.instance);
    return {
      viewport: t.getViewport(),
      selection: t.getSelection(),
      labels: [...t.nodes.labels.querySelectorAll('.tl-label')].map((n) => n.textContent),
      rootCount: document.querySelectorAll('#host .tl-root').length,
      pending: t.getPendingEdits(),
    };
  },

  /** Events of one type (or all). */
  eventsOf(name) {
    return this.events.filter((e) => !name || e.name === name);
  },
  clearEvents() {
    this.events = [];
  },

  /** Page coordinates of the top-left corner of the data canvas. */
  canvasOrigin() {
    const r = /** @type {Timeline} */ (this.instance).nodes.canvasArea.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  },

  /** Page-space centre of an interval bar. */
  barCenter(id) {
    const t = /** @type {Timeline} */ (this.instance);
    const it = t.index.intervalById.get(id);
    if (!it) throw new Error(`no interval ${id}`);
    const o = this.canvasOrigin();
    const row = t.rowOf(it.trackId);
    const x0 = Math.max(0, t.timeToX(it.start));
    const x1 = Math.min(o.width, t.timeToX(it.end));
    const y = row * t.options.rowHeight - t.nodes.scroller.scrollTop + t.options.rowHeight / 2;
    return { x: o.left + (x0 + x1) / 2, y: o.top + y, left: o.left + t.timeToX(it.start), right: o.left + t.timeToX(it.end), localX: (x0 + x1) / 2, localY: y };
  },

  /** Page-space position of an event marker. */
  eventPoint(id) {
    const t = /** @type {Timeline} */ (this.instance);
    const ev = t.index.eventById.get(id);
    if (!ev) throw new Error(`no event ${id}`);
    const o = this.canvasOrigin();
    const row = ev.trackId ? t.rowOf(ev.trackId) : 0;
    const y = row * t.options.rowHeight - t.nodes.scroller.scrollTop + t.options.rowHeight / 2;
    return { x: o.left + t.timeToX(ev.time), y: o.top + y };
  },

  /** Page-space point in the empty area of a track row at a time. */
  trackPoint(trackId, iso) {
    const t = /** @type {Timeline} */ (this.instance);
    const o = this.canvasOrigin();
    const row = t.rowOf(trackId);
    const y = row * t.options.rowHeight - t.nodes.scroller.scrollTop + t.options.rowHeight / 2;
    return { x: o.left + t.timeToX(iso), y: o.top + y };
  },

  /**
   * RGBA at a CSS-pixel position of a layer canvas.
   * @param {'data'|'overlay'|'axis'} layer
   * @param {number} x local css px
   * @param {number} y local css px
   */
  pixel(layer, x, y) {
    const t = /** @type {Timeline} */ (this.instance);
    const canvas = layer === 'data' ? t.nodes.dataCanvas : layer === 'overlay' ? t.nodes.overlayCanvas : t.nodes.axisCanvas;
    const dpr = canvas.width / canvas.clientWidth;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  },

  /** Count non-transparent pixels in a local rect of a layer. */
  paintedCount(layer, x, y, w, h) {
    const t = /** @type {Timeline} */ (this.instance);
    const canvas = layer === 'data' ? t.nodes.dataCanvas : layer === 'overlay' ? t.nodes.overlayCanvas : t.nodes.axisCanvas;
    const dpr = canvas.width / canvas.clientWidth;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const d = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr))).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  },

  /** Whether a pixel is "orange" (accent-like). */
  isOrange([r, g, b, a]) {
    return a > 200 && r > 180 && g > 90 && g < 200 && b < 90;
  },
};

const await_events = {
  selectionChange: 'selectionChange',
  eventActivate: 'eventActivate',
  viewportChange: 'viewportChange',
  intervalEditStart: 'intervalEditStart',
  intervalEditPreview: 'intervalEditPreview',
  intervalEditCommit: 'intervalEditCommit',
  intervalEditCancel: 'intervalEditCancel',
  rangeSelect: 'rangeSelect',
  hover: 'hover',
  itemClick: 'itemClick',
  itemDoubleClick: 'itemDoubleClick',
  contextMenu: 'contextMenu',
  dataError: 'dataError',
  destroy: 'destroy',
};

// @ts-ignore
window.TL = TL;
