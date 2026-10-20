/**
 * Public facade. Owns configuration, lifecycle, data state and render
 * scheduling, and wires the DOM-free core to the DOM/Canvas modules.
 */

import { ErrorCodes, TimelineError, fail } from './core/errors.js';
import { normalizeOptions, validateData, applyPatch, toEpoch } from './core/validation.js';
import { buildDataIndex, computeTrackRows } from './core/data-index.js';
import {
  createViewportState,
  viewportEnd,
  setRange,
  zoomBy,
  panByTime,
  panByPixels,
  resizeViewport,
  fitRange,
  toTimeScale,
  presetToPxPerMs,
  nearestPreset,
  sameView,
  setScale,
} from './core/viewport.js';
import { generateTicks } from './core/ticks.js';
import { createFormatter } from './core/format.js';
import { createEmitter, EVENTS } from './core/emitter.js';
import { ensureStyles } from './dom/styles.js';
import { buildLayout } from './dom/layout.js';
import { createLabelColumn } from './dom/labels.js';
import { createLayer, readTheme } from './rendering/layers.js';
import { renderAxis } from './rendering/axis-renderer.js';
import { renderData, visibleRows } from './rendering/data-renderer.js';

/**
 * @typedef {import('./core/validation.js').TimelineOptions} TimelineOptions
 * @typedef {import('./core/validation.js').NormalizedOptions} NormalizedOptions
 * @typedef {import('./core/validation.js').NormalizedData} NormalizedData
 * @typedef {import('./core/data-index.js').DataIndex} DataIndex
 * @typedef {import('./core/viewport.js').ViewportState} ViewportState
 */

/**
 * @typedef {object} TimelineData
 * @property {object[]} [tracks]
 * @property {object[]} [intervals]
 * @property {object[]} [events]
 */

/**
 * @typedef {object} TimelineFilters
 * @property {string[] | ((track: import('./core/validation.js').NormalizedTrack) => boolean) | null} [tracks] visible track IDs or predicate
 * @property {((interval: import('./core/validation.js').NormalizedInterval) => boolean) | null} [intervals]
 * @property {((event: import('./core/validation.js').NormalizedEvent) => boolean) | null} [events]
 * @property {string[] | null} [eventTypes] only show these event types
 */

const HSCROLL_HEIGHT = 10;

/**
 * Throws when a browser feature the library depends on is missing.
 */
function assertEnvironment() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    fail(ErrorCodes.UNSUPPORTED_ENVIRONMENT, 'Timeline requires a browser environment (window/document)');
  }
  if (typeof ResizeObserver === 'undefined') fail(ErrorCodes.UNSUPPORTED_ENVIRONMENT, 'ResizeObserver is required');
  if (typeof PointerEvent === 'undefined') fail(ErrorCodes.UNSUPPORTED_ENVIRONMENT, 'Pointer events are required');
  const probe = document.createElement('canvas');
  if (typeof probe.getContext !== 'function' || !probe.getContext('2d')) {
    fail(ErrorCodes.UNSUPPORTED_ENVIRONMENT, 'Canvas 2D rendering is required');
  }
}

export class Timeline {
  /** @type {HTMLElement} */
  #container;
  /** @type {NormalizedOptions} */
  #options;
  /** @type {import('./dom/layout.js').LayoutNodes} */
  #nodes;
  /** @type {{ axis: import('./rendering/layers.js').Layer, data: import('./rendering/layers.js').Layer, overlay: import('./rendering/layers.js').Layer }} */
  #layers;
  /** @type {ReturnType<typeof createLabelColumn>} */
  #labels;
  /** @type {ReturnType<typeof createEmitter>} */
  #emitter;
  /** @type {ReturnType<typeof createFormatter>} */
  #formatter;

  /** @type {{ tracks: object[], intervals: object[], events: object[] }} */
  #raw = { tracks: [], intervals: [], events: [] };
  /** @type {NormalizedData} */
  #data = { tracks: [], intervals: [], events: [], orphans: { intervals: [], events: [] } };
  /** @type {TimelineFilters} */
  #filters = {};
  /** @type {DataIndex} */
  #index;
  /** @type {import('./core/validation.js').NormalizedTrack[]} */
  #rows = [];
  /** @type {Map<string, number>} */
  #rowOfTrack = new Map();
  #rowsKey = '';
  #dataVersion = 0;

  /** @type {ViewportState} */
  #viewport;
  /** @type {import('./core/ticks.js').Ticks | null} */
  #ticks = null;
  #ticksKey = '';
  /** @type {import('./rendering/layers.js').Theme | null} */
  #theme = null;

  #dirty = { axis: true, data: true, overlay: true, labels: true };
  #raf = 0;
  #destroyed = false;
  #abort = new AbortController();
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {MediaQueryList | null} */
  #dprQuery = null;
  #dpr = 1;
  #compact = false;

  /** @type {Set<string>} */
  #selection = new Set();
  /** @type {string | null} */
  #primaryId = null;

  /**
   * @param {HTMLElement} container Host element; the library appends one root node inside it.
   * @param {TimelineOptions} options
   */
  constructor(container, options) {
    assertEnvironment();
    if (!(container instanceof HTMLElement)) {
      fail(ErrorCodes.INVALID_CONFIG, 'Timeline container must be an HTMLElement', { container });
    }
    this.#container = container;
    this.#options = normalizeOptions(options);
    const o = this.#options;
    this.#formatter = createFormatter(o.locale, o.timeZone, o.formats);

    if (o.injectStyles) ensureStyles(container.getRootNode() instanceof ShadowRoot ? /** @type {ShadowRoot} */ (container.getRootNode()) : container.ownerDocument);
    this.#nodes = buildLayout(container, o);
    this.#emitter = createEmitter(this.#nodes.root);
    this.#layers = {
      axis: createLayer(this.#nodes.axisCanvas),
      data: createLayer(this.#nodes.dataCanvas),
      overlay: createLayer(this.#nodes.overlayCanvas),
    };
    this.#labels = createLabelColumn(this.#nodes.labels);
    this.#index = buildDataIndex(this.#data);

    const width = Math.max(1, this.#nodes.canvasArea.clientWidth || this.#container.clientWidth - o.labelWidth);
    this.#viewport = createViewportState({
      domainStart: o.domainStart,
      domainEnd: o.domainEnd,
      width,
      pxPerMs: presetToPxPerMs(o.zoom.initial, o.zoom.presets),
      minPxPerMs: presetToPxPerMs(o.zoom.max, o.zoom.presets),
      maxPxPerMs: presetToPxPerMs(o.zoom.min, o.zoom.presets),
    });

    this.#bindEnvironment();
    this.#measure();
    this.#scheduleRender();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /** Whether `destroy()` has been called. */
  get destroyed() {
    return this.#destroyed;
  }

  /** Root element created by the library (the dispatch target for `timeline:*` events). */
  get element() {
    return this.#nodes.root;
  }

  /** Normalized, read-only configuration. */
  get options() {
    return this.#options;
  }

  /**
   * Release every resource and remove the library-owned DOM. The host
   * container itself is left untouched. The instance cannot be reused.
   */
  destroy() {
    if (this.#destroyed) return;
    this.#emitter.emit('destroy');
    this.#destroyed = true;
    this.#abort.abort();
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#dprQuery = null;
    this.#labels.clear();
    this.#nodes.root.remove();
  }

  #assertAlive() {
    if (this.#destroyed) fail(ErrorCodes.DESTROYED, 'This Timeline instance has been destroyed');
  }

  // ───────────────────────── events ─────────────────────────

  /**
   * Subscribe to a library event (`'selectionChange'`, `'selection-change'`
   * or `'timeline:selection-change'`). Equivalent to `addEventListener` on `element`.
   * @param {string} name
   * @param {(event: CustomEvent) => void} callback
   * @returns {this}
   */
  on(name, callback) {
    this.#emitter.on(name, callback);
    return this;
  }

  /**
   * @param {string} name
   * @param {(event: CustomEvent) => void} callback
   * @returns {this}
   */
  off(name, callback) {
    this.#emitter.off(name, callback);
    return this;
  }

  // ───────────────────────── data ─────────────────────────

  /**
   * Replace all tracks, intervals and events atomically. Structural errors
   * throw a `TimelineError` and leave the current data untouched; items that
   * reference unknown tracks are excluded and reported via `dataError`.
   * @param {TimelineData | null | undefined} data
   */
  setData(data) {
    this.#assertAlive();
    const normalized = validateData(data);
    this.#raw = {
      tracks: [...(data?.tracks ?? [])],
      intervals: [...(data?.intervals ?? [])],
      events: [...(data?.events ?? [])],
    };
    this.#applyData(normalized);
  }

  /**
   * Apply an incremental patch: upsert by id, remove by id and rename
   * temporary IDs. The resulting data set is validated as a whole before
   * anything is applied.
   * @param {{ tracks?: object[], intervals?: object[], events?: object[], remove?: { tracks?: unknown[], intervals?: unknown[], events?: unknown[] }, replaceIds?: Record<string, string|number> }} patch
   */
  updateData(patch) {
    this.#assertAlive();
    const raw = applyPatch(this.#raw, patch);
    const normalized = validateData(raw);
    this.#raw = raw;
    this.#applyData(normalized);
  }

  /** Shallow copies of the caller-supplied source objects currently held. */
  getData() {
    return { tracks: [...this.#raw.tracks], intervals: [...this.#raw.intervals], events: [...this.#raw.events] };
  }

  /**
   * @param {NormalizedData} normalized
   */
  #applyData(normalized) {
    this.#data = normalized;
    this.#dataVersion++;
    this.#rebuildIndex();
    this.#reconcileSelection();
    this.#invalidate({ axis: false, data: true, overlay: true, labels: true });
    const { intervals, events } = normalized.orphans;
    if (intervals.length || events.length) {
      this.#emitter.emit('dataError', {
        code: ErrorCodes.UNKNOWN_TRACK,
        message: `${intervals.length + events.length} item(s) reference unknown tracks and were excluded`,
        intervals: intervals.map((i) => ({ id: i.id, trackId: i.trackId, source: i.source })),
        events: events.map((e) => ({ id: e.id, trackId: e.trackId, source: e.source })),
      });
    }
  }

  #rebuildIndex() {
    const f = this.#filters;
    let intervals = this.#data.intervals;
    let events = this.#data.events;
    if (f.intervals) intervals = intervals.filter(f.intervals);
    if (f.events) events = events.filter(f.events);
    if (f.eventTypes) {
      const types = new Set(f.eventTypes);
      events = events.filter((e) => types.has(e.type));
    }
    this.#index = buildDataIndex({ tracks: this.#data.tracks, intervals, events });
    this.#rowsKey = '';
  }

  /**
   * Filter tracks and items. Pass `null`/`{}` to clear.
   * @param {TimelineFilters | null} filters
   */
  setFilters(filters) {
    this.#assertAlive();
    if (filters !== null && typeof filters !== 'object') fail(ErrorCodes.INVALID_TYPE, 'setFilters() expects an object or null');
    this.#filters = { ...(filters ?? {}) };
    this.#rebuildIndex();
    this.#reconcileSelection();
    this.#invalidate({ data: true, overlay: true, labels: true });
  }

  // ───────────────────────── selection (state only; interaction wired by controllers) ─────────────────────────

  /**
   * Programmatic selection. IDs that don't exist or aren't selectable are ignored.
   * Does not emit `selectionChange`.
   * @param {Iterable<string|number> | string | number | null} ids
   * @param {{ primary?: string|number|null }} [opts]
   */
  setSelection(ids, opts = {}) {
    this.#assertAlive();
    const list = ids === null || ids === undefined ? [] : typeof ids === 'string' || typeof ids === 'number' ? [ids] : [...ids];
    const next = new Set();
    for (const id of list) {
      const key = String(id);
      if (this.#isSelectable(key)) next.add(key);
    }
    this.#selection = next;
    const primary = opts.primary !== undefined && opts.primary !== null ? String(opts.primary) : null;
    this.#primaryId = primary && next.has(primary) ? primary : next.size ? [...next][next.size - 1] : null;
    this.#invalidate({ overlay: true, labels: true });
  }

  /** Selected item IDs (intervals and events) plus the primary one. */
  getSelection() {
    return { ids: [...this.#selection], primaryId: this.#primaryId };
  }

  /** @param {string} id */
  #isSelectable(id) {
    if (!this.#options.selectable) return false;
    const it = this.#index.intervalById.get(id) ?? this.#index.eventById.get(id);
    if (!it) return false;
    if (it.kind === 'event' && it.scope === 'global') return true;
    return this.#rowOfTrackLive().has(/** @type {string} */ (it.trackId));
  }

  #reconcileSelection() {
    this.#ensureRows();
    let changed = false;
    for (const id of [...this.#selection]) {
      if (!this.#isSelectable(id)) {
        this.#selection.delete(id);
        changed = true;
      }
    }
    if (this.#primaryId && !this.#selection.has(this.#primaryId)) {
      this.#primaryId = this.#selection.size ? [...this.#selection][this.#selection.size - 1] : null;
      changed = true;
    }
    if (changed) this.#emitSelection();
  }

  #emitSelection() {
    this.#emitter.emit('selectionChange', { ids: [...this.#selection], primaryId: this.#primaryId });
  }

  // ───────────────────────── viewport ─────────────────────────

  /** Visible range and scale. */
  getViewport() {
    return this.#viewportDetail(this.#viewport);
  }

  /** @param {ViewportState} v */
  #viewportDetail(v) {
    return {
      start: v.start,
      end: viewportEnd(v),
      pxPerMs: v.pxPerMs,
      zoom: nearestPreset(v.pxPerMs, this.#options.zoom.presets),
      domainStart: v.domainStart,
      domainEnd: v.domainEnd,
      width: v.width,
    };
  }

  /**
   * Navigate to a time range (clamped to the domain and zoom bounds).
   * @param {{ start: string|number|Date, end: string|number|Date }} range
   */
  setViewport(range) {
    this.#assertAlive();
    if (!range || typeof range !== 'object') fail(ErrorCodes.INVALID_TYPE, 'setViewport() expects { start, end }');
    const start = toEpoch(range.start, 'start', 'setViewport(): ');
    const end = toEpoch(range.end, 'end', 'setViewport(): ');
    if (!(end > start)) fail(ErrorCodes.INVALID_RANGE, 'setViewport(): end must be after start');
    this.#applyViewport(setRange(this.#viewport, start, end));
  }

  /**
   * Jump to a zoom preset, keeping the centre fixed.
   * @param {string} level e.g. `'day' | 'week' | 'month' | 'quarter'`
   */
  setZoom(level) {
    this.#assertAlive();
    if (!this.#options.zoom.presets[level]) {
      fail(ErrorCodes.INVALID_CONFIG, `Unknown zoom level "${level}" (${Object.keys(this.#options.zoom.presets).join(', ')})`);
    }
    this.#applyViewport(setScale(this.#viewport, presetToPxPerMs(level, this.#options.zoom.presets)));
  }

  /**
   * Zoom in/out by the configured step factor, or by an explicit factor (> 1 zooms in).
   * @param {'in'|'out'|number} direction
   * @param {number} [anchorX] pixel offset inside the data area to keep fixed
   */
  zoom(direction, anchorX) {
    this.#assertAlive();
    const step = this.#options.zoom.stepFactor;
    const factor = direction === 'in' ? step : direction === 'out' ? 1 / step : direction;
    if (!(typeof factor === 'number' && factor > 0)) fail(ErrorCodes.INVALID_TYPE, 'zoom() expects "in", "out" or a positive factor');
    this.#applyViewport(zoomBy(this.#viewport, factor, anchorX));
  }

  /**
   * Pan by a fraction of the visible range (`'left'`/`'right'` = 25%) or by milliseconds.
   * @param {'left'|'right'|number} amount
   */
  pan(amount) {
    this.#assertAlive();
    const visible = viewportEnd(this.#viewport) - this.#viewport.start;
    const ms = amount === 'left' ? -visible / 4 : amount === 'right' ? visible / 4 : amount;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) fail(ErrorCodes.INVALID_TYPE, 'pan() expects "left", "right" or a number of ms');
    this.#applyViewport(panByTime(this.#viewport, ms));
  }

  /** Fit the view to the extent of the current data (within domain and zoom bounds). */
  fitToData() {
    this.#assertAlive();
    const r = this.#index.dataRange;
    if (!r) {
      this.#applyViewport(setRange(this.#viewport, this.#viewport.domainStart, this.#viewport.domainEnd));
      return;
    }
    this.#applyViewport(fitRange(this.#viewport, r.start, r.end));
  }

  /**
   * @param {ViewportState} next
   * @param {boolean} [silent]
   */
  #applyViewport(next, silent = false) {
    if (sameView(next, this.#viewport)) return;
    this.#viewport = next;
    this.#invalidate({ axis: true, data: true, overlay: true, labels: this.#options.hideEmptyTracks });
    if (!silent) this.#emitter.emit('viewportChange', this.#viewportDetail(next));
  }

  /**
   * Pan by a pixel delta (used by pointer/wheel controllers).
   * @param {number} dx positive moves later in time
   */
  panByPixels(dx) {
    this.#applyViewport(panByPixels(this.#viewport, dx));
  }

  // ───────────────────────── geometry ─────────────────────────

  /** Current time scale with origin 0 at the left edge of the data area. */
  get scale() {
    return toTimeScale(this.#viewport, 0);
  }

  /** Visible rows and their geometry for the current scroll position. */
  get rowGeometry() {
    this.#ensureRows();
    const o = this.#options;
    const scrollTop = this.#nodes.scroller.scrollTop;
    const height = this.#layers.data.height;
    const { firstRow, lastRow } = visibleRows(scrollTop, height, o.rowHeight, this.#rows.length);
    return { rows: this.#rows, rowOfTrack: this.#rowOfTrack, rowHeight: o.rowHeight, barHeight: o.barHeight, markerSize: o.markerSize, scrollTop, firstRow, lastRow, width: this.#layers.data.width, height };
  }

  /** The data index (read-only use by controllers). */
  get index() {
    return this.#index;
  }

  /** Locale/time-zone formatter shared with tooltips and accessibility. */
  get formatter() {
    return this.#formatter;
  }

  /** Library DOM nodes (read-only use by controllers). */
  get nodes() {
    return this.#nodes;
  }

  #rowOfTrackLive() {
    this.#ensureRows();
    return this.#rowOfTrack;
  }

  #ensureRows() {
    const o = this.#options;
    const v = this.#viewport;
    const key = `${this.#dataVersion}|${JSON.stringify(this.#filters.tracks ?? null)}|${o.hideEmptyTracks ? `${v.start}|${v.pxPerMs}|${v.width}` : ''}`;
    if (key === this.#rowsKey) return;
    const tf = this.#filters.tracks;
    /** @type {((t: import('./core/validation.js').NormalizedTrack) => boolean) | null} */
    let trackFilter = null;
    if (Array.isArray(tf)) {
      const allowed = new Set(tf.map(String));
      trackFilter = (t) => allowed.has(t.id);
    } else if (typeof tf === 'function') trackFilter = tf;
    const { rows, rowOfTrack } = computeTrackRows({
      index: this.#index,
      trackOrder: o.trackOrder,
      hideEmptyTracks: o.hideEmptyTracks,
      viewStart: v.start,
      viewEnd: viewportEnd(v),
      trackFilter,
    });
    this.#rows = rows;
    this.#rowOfTrack = rowOfTrack;
    this.#rowsKey = key;
    this.#nodes.spacer.style.height = `${rows.length * o.rowHeight}px`;
  }

  // ───────────────────────── environment bindings ─────────────────────────

  #bindEnvironment() {
    const signal = this.#abort.signal;
    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#destroyed) return;
      this.#measure();
      this.#scheduleRender();
    });
    this.#resizeObserver.observe(this.#nodes.root);
    this.#resizeObserver.observe(this.#nodes.canvasArea);
    this.#nodes.scroller.addEventListener('scroll', () => this.#invalidate({ data: true, overlay: true, labels: true }), { signal, passive: true });
    this.#watchDpr();
  }

  #watchDpr() {
    if (this.#destroyed || typeof matchMedia !== 'function') return;
    this.#dpr = window.devicePixelRatio || 1;
    this.#dprQuery = matchMedia(`(resolution: ${this.#dpr}dppx)`);
    this.#dprQuery.addEventListener(
      'change',
      () => {
        this.#measure();
        this.#scheduleRender();
        this.#watchDpr();
      },
      { once: true, signal: this.#abort.signal },
    );
  }

  #measure() {
    const n = this.#nodes;
    const rootHeight = n.root.clientHeight;
    const compact = rootHeight > 0 && rootHeight < this.#options.compactHeight;
    if (compact !== this.#compact) {
      this.#compact = compact;
      n.root.setAttribute('data-tl-compact', String(compact));
    }
    const dpr = window.devicePixelRatio || 1;
    const dataW = n.canvasArea.clientWidth;
    const dataH = n.canvasArea.clientHeight;
    const axisH = compact ? 0 : n.axis.clientHeight;
    const changedData = this.#layers.data.resize(dataW, dataH, dpr);
    this.#layers.overlay.resize(dataW, dataH, dpr);
    const changedAxis = this.#layers.axis.resize(dataW, axisH, dpr);
    this.#theme = null;
    if (dataW > 0 && dataW !== this.#viewport.width) {
      const prev = this.#viewport;
      this.#viewport = resizeViewport(prev, dataW);
      if (!sameView(prev, this.#viewport)) this.#emitter.emit('viewportChange', this.#viewportDetail(this.#viewport));
    }
    if (changedData || changedAxis) this.#invalidate({ axis: true, data: true, overlay: true, labels: true });
  }

  // ───────────────────────── rendering ─────────────────────────

  /**
   * @param {Partial<{ axis: boolean, data: boolean, overlay: boolean, labels: boolean }>} flags
   */
  #invalidate(flags) {
    if (flags.axis) this.#dirty.axis = true;
    if (flags.data) this.#dirty.data = true;
    if (flags.overlay) this.#dirty.overlay = true;
    if (flags.labels) this.#dirty.labels = true;
    this.#scheduleRender();
  }

  /** Request a redraw of the overlay layer (hover/selection/preview). */
  invalidateOverlay() {
    this.#invalidate({ overlay: true });
  }

  #scheduleRender() {
    if (this.#raf || this.#destroyed) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      if (!this.#destroyed) this.#render();
    });
  }

  /** Synchronously flush pending rendering (tests, benchmarks). */
  flush() {
    if (this.#destroyed) return;
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#render();
  }

  #currentTicks() {
    const v = this.#viewport;
    const key = `${v.start}|${v.pxPerMs}|${v.width}`;
    if (!this.#ticks || key !== this.#ticksKey) {
      const o = this.#options;
      this.#ticks = generateTicks({
        start: v.start,
        end: viewportEnd(v),
        pxPerMs: v.pxPerMs,
        timeZone: o.timeZone,
        formatter: this.#formatter,
        minSpacingPx: o.minTickSpacing,
        weekStartsOn: o.weekStartsOn,
      });
      this.#ticksKey = key;
    }
    return this.#ticks;
  }

  /** @type {Array<(frame: ReturnType<Timeline['frame']>) => void>} */
  #overlayPainters = [];

  /**
   * Register an overlay painter (controllers draw hover/selection/previews).
   * @param {(frame: ReturnType<Timeline['frame']>) => void} painter
   */
  addOverlayPainter(painter) {
    this.#overlayPainters.push(painter);
  }

  /** Snapshot of everything a renderer or hit-tester needs for the current frame. */
  frame() {
    this.#ensureRows();
    const v = this.#viewport;
    const g = this.rowGeometry;
    return {
      scale: toTimeScale(v, 0),
      viewStart: v.start,
      viewEnd: viewportEnd(v),
      width: g.width,
      height: g.height,
      rows: g.rows,
      rowOfTrack: g.rowOfTrack,
      index: this.#index,
      ticks: this.#currentTicks(),
      theme: this.#theme ?? (this.#theme = readTheme(this.#nodes.root)),
      geometry: { rowHeight: g.rowHeight, barHeight: g.barHeight, markerSize: g.markerSize, scrollTop: g.scrollTop, firstRow: g.firstRow, lastRow: g.lastRow },
      selection: this.#selection,
      primaryId: this.#primaryId,
      options: this.#options,
      formatter: this.#formatter,
      now: Date.now(),
    };
  }

  #render() {
    const f = this.frame();
    const o = this.#options;
    if (this.#dirty.axis && !this.#compact && o.showAxis) {
      renderAxis(this.#layers.axis.ctx, { scale: f.scale, width: this.#layers.axis.width, height: this.#layers.axis.height, ticks: f.ticks, theme: f.theme });
    }
    if (this.#dirty.data) {
      renderData(this.#layers.data.ctx, { ...f, flags: { showGrid: o.showGrid, showTrackLines: o.showTrackLines, showToday: o.showToday } });
    }
    if (this.#dirty.labels || this.#dirty.data) {
      const primary = this.#primaryId ? (this.#index.intervalById.get(this.#primaryId) ?? this.#index.eventById.get(this.#primaryId)) : null;
      this.#labels.render({
        rows: f.rows,
        firstRow: f.geometry.firstRow,
        lastRow: f.geometry.lastRow,
        rowHeight: o.rowHeight,
        scrollTop: f.geometry.scrollTop,
        selectedTrackId: primary?.trackId ?? null,
      });
    }
    if (this.#dirty.overlay || this.#dirty.data) {
      this.#layers.overlay.clear();
      for (const painter of this.#overlayPainters) painter(f);
    }
    this.#updateHScroll();
    this.#dirty = { axis: false, data: false, overlay: false, labels: false };
  }

  #updateHScroll() {
    const v = this.#viewport;
    const n = this.#nodes;
    const trackW = n.hscroll.clientWidth;
    if (trackW <= 0) return;
    const domain = v.domainEnd - v.domainStart;
    const visible = viewportEnd(v) - v.start;
    const w = Math.max(16, (trackW * visible) / domain);
    const left = ((trackW - w) * (v.start - v.domainStart)) / Math.max(1, domain - visible);
    n.hthumb.style.width = `${Math.min(trackW, w)}px`;
    n.hthumb.style.transform = `translateX(${Number.isFinite(left) ? Math.max(0, left) : 0}px)`;
  }

  /** @returns {number} height reserved for the horizontal scrollbar */
  static get HSCROLL_HEIGHT() {
    return HSCROLL_HEIGHT;
  }
}

export { TimelineError, ErrorCodes, EVENTS };
