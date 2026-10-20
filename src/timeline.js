/**
 * Public facade. Owns configuration, lifecycle, data state and render
 * scheduling, and wires the DOM-free core to the DOM/Canvas modules and the
 * interaction controllers.
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
  clampViewport,
} from './core/viewport.js';
import { timeToX } from './core/time-scale.js';
import { generateTicks } from './core/ticks.js';
import { createFormatter } from './core/format.js';
import { createEmitter, EVENTS } from './core/emitter.js';
import { ensureStyles } from './dom/styles.js';
import { buildLayout } from './dom/layout.js';
import { createLabelColumn } from './dom/labels.js';
import { createTooltip, describeItem } from './dom/tooltip.js';
import { createA11y } from './dom/a11y.js';
import { createLayer, readTheme } from './rendering/layers.js';
import { renderAxis } from './rendering/axis-renderer.js';
import { renderData, visibleRows } from './rendering/data-renderer.js';
import { renderOverlay } from './rendering/overlay-renderer.js';
import { createSelectionController } from './interaction/selection-controller.js';
import { createIntervalEditor } from './interaction/interval-editor.js';
import { attachPointerController } from './interaction/pointer-controller.js';
import { attachKeyboardController } from './interaction/keyboard-controller.js';
import { attachHScrollController } from './interaction/hscroll-controller.js';

/**
 * @typedef {import('./core/validation.js').TimelineOptions} TimelineOptions
 * @typedef {import('./core/validation.js').NormalizedOptions} NormalizedOptions
 * @typedef {import('./core/validation.js').NormalizedData} NormalizedData
 * @typedef {import('./core/validation.js').NormalizedTrack} NormalizedTrack
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
 * @typedef {object} TimelinePatch
 * @property {object[]} [tracks]
 * @property {object[]} [intervals]
 * @property {object[]} [events]
 * @property {{ tracks?: unknown[], intervals?: unknown[], events?: unknown[] }} [remove]
 * @property {Record<string, string|number>} [replaceIds] temporary id → final id
 */

/**
 * @typedef {object} TimelineFilters
 * @property {string[] | ((track: NormalizedTrack) => boolean) | null} [tracks] visible track IDs or predicate
 * @property {((interval: import('./core/validation.js').NormalizedInterval) => boolean) | null} [intervals]
 * @property {((event: import('./core/validation.js').NormalizedEvent) => boolean) | null} [events]
 * @property {string[] | null} [eventTypes] only show these event types
 */

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
  /** @type {ReturnType<typeof createTooltip>} */
  #tooltip;
  /** @type {ReturnType<typeof createA11y>} */
  #a11y;
  /** @type {ReturnType<typeof createSelectionController>} */
  #selection;
  /** @type {ReturnType<typeof createIntervalEditor>} */
  #editor;
  /** @type {ReturnType<typeof attachPointerController>} */
  #pointer;

  /** @type {{ tracks: object[], intervals: object[], events: object[] }} */
  #raw = { tracks: [], intervals: [], events: [] };
  /** @type {NormalizedData} */
  #data = { tracks: [], intervals: [], events: [], orphans: { intervals: [], events: [] } };
  /** @type {TimelineFilters} */
  #filters = {};
  /** @type {DataIndex} */
  #index;
  /** @type {NormalizedTrack[]} */
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

  /** @type {{ hoverId: string | null, focusId: string | null, marquee: { start: number, end: number } | null }} */
  #overlay = { hoverId: null, focusId: null, marquee: null };

  #dirty = { axis: true, data: true, overlay: true, labels: true };
  #raf = 0;
  #destroyed = false;
  #abort = new AbortController();
  /** @type {ResizeObserver | null} */
  #resizeObserver = null;
  /** @type {MutationObserver | null} */
  #themeObserver = null;
  #compact = false;

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

    if (o.injectStyles) {
      const rootNode = container.getRootNode();
      ensureStyles(rootNode instanceof ShadowRoot ? rootNode : container.ownerDocument);
    }
    this.#nodes = buildLayout(container, o);
    this.#emitter = createEmitter(this.#nodes.root);
    this.#layers = {
      axis: createLayer(this.#nodes.axisCanvas),
      data: createLayer(this.#nodes.dataCanvas),
      overlay: createLayer(this.#nodes.overlayCanvas),
    };
    this.#labels = createLabelColumn(this.#nodes.labels);
    this.#tooltip = createTooltip(this.#nodes.tooltip, this.#nodes.root);
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

    this.#selection = createSelectionController({
      isSelectable: (id) => this.#isSelectable(id),
      multiSelect: () => this.#options.multiSelect,
      emit: (detail) => this.#emitter.emit('selectionChange', detail),
      invalidate: () => this.#invalidate({ overlay: true, labels: true }),
    });
    this.#editor = createIntervalEditor({
      options: () => this.#options,
      index: () => this.#index,
      emit: (name, detail) => this.#emitter.emit(name, detail),
      invalidate: () => this.#invalidate({ overlay: true }),
      formatter: () => this.#formatter,
    });
    for (const name of ['intervalEditStart', 'intervalEditCommit', 'intervalEditCancel']) {
      this.#emitter.on(name, () => this.#invalidate({ data: true, overlay: true }));
    }
    this.#a11y = createA11y({ timeline: this });

    const signal = this.#abort.signal;
    this.#pointer = attachPointerController({
      timeline: this,
      selection: this.#selection,
      editor: this.#editor,
      overlay: {
        setHover: (id) => {
          this.#overlay.hoverId = id;
          this.#invalidate({ overlay: true });
        },
        setMarquee: (m) => {
          this.#overlay.marquee = m;
          this.#invalidate({ overlay: true });
        },
      },
      tooltip: {
        show: (id, hit, x, y) => {
          if (!hit.item) return;
          const track = hit.item.trackId ? this.#index.trackById.get(hit.item.trackId) : null;
          const offsetX = this.#nodes.canvasArea.offsetLeft;
          const offsetY = this.#nodes.scroller.offsetTop;
          this.#tooltip.show(id, describeItem(hit.item, track, this.#formatter), x + offsetX, y + offsetY);
        },
        move: (x, y) => this.#tooltip.move(x, y),
        hide: () => this.#tooltip.hide(),
      },
      signal,
    });
    attachKeyboardController({
      timeline: this,
      selection: this.#selection,
      editor: this.#editor,
      pointer: this.#pointer,
      focus: {
        getFocus: () => this.#overlay.focusId,
        setFocus: (id) => {
          this.#overlay.focusId = id;
          this.#invalidate({ overlay: true });
        },
      },
      signal,
    });
    attachHScrollController({ timeline: this, signal });

    this.#bindEnvironment();
    this.#measure();
    this.#scheduleRender();
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /** Whether `destroy()` has been called. */
  get destroyed() {
    return this.#destroyed;
  }

  /** Root element created by the library (dispatch target for `timeline:*` events). */
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
    this.#editor.dispose();
    this.#emitter.emit('destroy');
    this.#destroyed = true;
    this.#abort.abort();
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#themeObserver?.disconnect();
    this.#themeObserver = null;
    this.#labels.clear();
    this.#a11y.dispose();
    this.#nodes.root.remove();
    // Drop heavy state so a host that keeps a reference to the destroyed
    // instance does not keep the data set alive.
    this.#raw = { tracks: [], intervals: [], events: [] };
    this.#data = { tracks: [], intervals: [], events: [], orphans: { intervals: [], events: [] } };
    this.#index = buildDataIndex(this.#data);
    this.#rows = [];
    this.#rowOfTrack = new Map();
    this.#ticks = null;
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

  /**
   * Dispatch a library event. Used by controllers; hosts normally only listen.
   * @param {string} name
   * @param {Record<string, unknown>} [detail]
   * @param {{ cancelable?: boolean }} [opts]
   * @returns {boolean} false when a listener called `preventDefault()`
   */
  emit(name, detail, opts) {
    return this.#emitter.emit(name, detail, opts);
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
    this.#editor.onDataApplied(undefined, true);
  }

  /**
   * Apply an incremental patch: upsert by id, remove by id and rename
   * temporary IDs. The resulting data set is validated as a whole before
   * anything is applied.
   * @param {TimelinePatch} patch
   */
  updateData(patch) {
    this.#assertAlive();
    const raw = applyPatch(this.#raw, patch);
    const normalized = validateData(raw);
    this.#raw = raw;
    this.#applyData(normalized);
    this.#editor.onDataApplied(patch.replaceIds, false);
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
    this.#a11y.reset();
    this.#selection.reconcile();
    if (this.#overlay.focusId && !this.#index.intervalById.has(this.#overlay.focusId) && !this.#index.eventById.has(this.#overlay.focusId)) {
      this.#overlay.focusId = null;
    }
    this.#invalidate({ data: true, overlay: true, labels: true });
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
    this.#a11y.reset();
    this.#selection.reconcile();
    this.#invalidate({ data: true, overlay: true, labels: true });
  }

  /** Current filters. */
  getFilters() {
    return { ...this.#filters };
  }

  // ───────────────────────── selection ─────────────────────────

  /**
   * Programmatic selection. IDs that don't exist or aren't selectable are ignored.
   * Does not emit `selectionChange`.
   * @param {Iterable<string|number> | string | number | null} ids
   * @param {{ primary?: string|number|null }} [opts]
   */
  setSelection(ids, opts = {}) {
    this.#assertAlive();
    const list = ids === null || ids === undefined ? [] : typeof ids === 'string' || typeof ids === 'number' ? [ids] : [...ids];
    this.#selection.set(
      list.map(String),
      opts.primary !== undefined && opts.primary !== null ? String(opts.primary) : null,
    );
  }

  /** Selected item IDs (intervals and events) plus the primary one. */
  getSelection() {
    return this.#selection.detail();
  }

  /** @param {string} id */
  #isSelectable(id) {
    if (!this.#options.selectable) return false;
    const it = this.#index.intervalById.get(id) ?? this.#index.eventById.get(id);
    if (!it) return false;
    if (it.kind === 'event' && it.scope === 'global') return true;
    this.#ensureRows();
    return this.#rowOfTrack.has(/** @type {string} */ (it.trackId));
  }

  // ───────────────────────── editing ─────────────────────────

  /**
   * Reject a committed edit: removes the pending preview and restores the original.
   * @param {string|number} id interval id, or the temporary id of a new interval
   */
  rejectEdit(id) {
    this.#assertAlive();
    this.#editor.reject(String(id));
  }

  /** Cancel an in-progress edit interaction, if any. */
  cancelEdit() {
    this.#assertAlive();
    if (this.#editor.isEditing) this.#editor.cancel('api');
    this.#pointer.cancelGesture();
  }

  /** IDs of intervals with a committed edit awaiting host data. */
  getPendingEdits() {
    return [...this.#editor.pendingIds()];
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
   * Move the visible start without changing the scale.
   * @param {number} startMs
   */
  setViewportStart(startMs) {
    this.#assertAlive();
    this.#applyViewport(clampViewport({ ...this.#viewport, start: startMs }));
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
   * Pan by a quarter of the visible range (`'left'`/`'right'`) or by milliseconds.
   * @param {'left'|'right'|number} amount
   */
  pan(amount) {
    this.#assertAlive();
    const visible = viewportEnd(this.#viewport) - this.#viewport.start;
    const ms = amount === 'left' ? -visible / 4 : amount === 'right' ? visible / 4 : amount;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) fail(ErrorCodes.INVALID_TYPE, 'pan() expects "left", "right" or a number of ms');
    this.#applyViewport(panByTime(this.#viewport, ms));
  }

  /**
   * Pan by a pixel delta (used by pointer/wheel controllers).
   * @param {number} dx positive moves later in time
   */
  panByPixels(dx) {
    this.#applyViewport(panByPixels(this.#viewport, dx));
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
   * Pan the minimum amount so `[start, end]` is visible (scale unchanged).
   * @param {number} start
   * @param {number} end
   */
  ensureTimeVisible(start, end) {
    const v = this.#viewport;
    const vEnd = viewportEnd(v);
    const pad = (vEnd - v.start) * 0.05;
    if (start < v.start) this.#applyViewport(clampViewport({ ...v, start: start - pad }));
    else if (end > vEnd) this.#applyViewport(clampViewport({ ...v, start: end + pad - (vEnd - v.start) }));
  }

  /**
   * Scroll vertically the minimum amount so `row` is fully visible.
   * @param {number} row
   */
  scrollRowIntoView(row) {
    const s = this.#nodes.scroller;
    const rh = this.#options.rowHeight;
    const top = row * rh;
    const bottom = top + rh;
    if (top < s.scrollTop) s.scrollTop = top;
    else if (bottom > s.scrollTop + s.clientHeight) s.scrollTop = bottom - s.clientHeight;
  }

  /**
   * @param {ViewportState} next
   */
  #applyViewport(next) {
    if (sameView(next, this.#viewport)) return;
    this.#viewport = next;
    this.#invalidate({ axis: true, data: true, overlay: true, labels: this.#options.hideEmptyTracks });
    this.#emitter.emit('viewportChange', this.#viewportDetail(next));
  }

  // ───────────────────────── geometry (read by controllers) ─────────────────────────

  /** Current time scale with origin 0 at the left edge of the data area. */
  get scale() {
    return toTimeScale(this.#viewport, 0);
  }

  /** The (filtered) data index. */
  get index() {
    return this.#index;
  }

  /** Locale/time-zone formatter shared with tooltips and accessibility. */
  get formatter() {
    return this.#formatter;
  }

  /** Library DOM nodes. */
  get nodes() {
    return this.#nodes;
  }

  /**
   * Pixel x of a timestamp inside the data area (convenience for hosts
   * positioning their own overlays).
   * @param {string|number|Date} time
   */
  timeToX(time) {
    return timeToX(this.scale, toEpoch(time, 'time', 'timeToX(): '));
  }

  /**
   * Row index of a track in the current layout, or -1 if hidden/filtered.
   * @param {string|number} trackId
   */
  rowOf(trackId) {
    this.#ensureRows();
    return this.#rowOfTrack.get(String(trackId)) ?? -1;
  }

  #ensureRows() {
    const o = this.#options;
    const v = this.#viewport;
    const tf = this.#filters.tracks;
    const key = `${this.#dataVersion}|${Array.isArray(tf) ? tf.join(',') : typeof tf === 'function' ? 'fn' : ''}|${o.hideEmptyTracks ? `${v.start}|${v.pxPerMs}|${v.width}` : ''}`;
    if (key === this.#rowsKey) return;
    /** @type {((t: NormalizedTrack) => boolean) | null} */
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
    this.#themeObserver = new MutationObserver(() => {
      this.#theme = null;
      this.#invalidate({ axis: true, data: true, overlay: true });
    });
    this.#themeObserver.observe(this.#nodes.root, { attributes: true, attributeFilter: ['data-tl-theme', 'style', 'class'] });
    this.#watchDpr();
  }

  #watchDpr() {
    if (this.#destroyed || typeof matchMedia !== 'function') return;
    const dpr = window.devicePixelRatio || 1;
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener(
      'change',
      () => {
        if (this.#destroyed) return;
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

  #scheduleRender() {
    if (this.#raf || this.#destroyed) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      if (!this.#destroyed) this.#render();
    });
  }

  /** Synchronously flush pending rendering (tests, benchmarks, theme switches). */
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

  /** Snapshot of everything a renderer or hit-tester needs for the current frame. */
  frame() {
    this.#ensureRows();
    const v = this.#viewport;
    const o = this.#options;
    const scrollTop = this.#nodes.scroller.scrollTop;
    const width = this.#layers.data.width;
    const height = this.#layers.data.height;
    const { firstRow, lastRow } = visibleRows(scrollTop, height, o.rowHeight, this.#rows.length);
    return {
      scale: toTimeScale(v, 0),
      viewStart: v.start,
      viewEnd: viewportEnd(v),
      width,
      height,
      rows: this.#rows,
      rowOfTrack: this.#rowOfTrack,
      index: this.#index,
      ticks: this.#currentTicks(),
      theme: this.#theme ?? (this.#theme = readTheme(this.#nodes.root)),
      geometry: { rowHeight: o.rowHeight, barHeight: o.barHeight, markerSize: o.markerSize, scrollTop, firstRow, lastRow },
      selection: this.#selection.ids,
      primaryId: this.#selection.primaryId,
      options: o,
      formatter: this.#formatter,
      now: Date.now(),
    };
  }

  #render() {
    const f = this.frame();
    const o = this.#options;
    const hidden = this.#editor.pendingIds();
    const active = this.#editor.active;
    if (active && !active.isNew) hidden.add(active.intervalId);

    if (this.#dirty.axis && !this.#compact && o.showAxis) {
      renderAxis(this.#layers.axis.ctx, { scale: f.scale, width: this.#layers.axis.width, height: this.#layers.axis.height, ticks: f.ticks, theme: f.theme });
    }
    if (this.#dirty.data) {
      renderData(this.#layers.data.ctx, { ...f, hiddenIds: hidden, flags: { showGrid: o.showGrid, showTrackLines: o.showTrackLines, showToday: o.showToday } });
    }
    if (this.#dirty.labels || this.#dirty.data) {
      const primary = f.primaryId ? (this.#index.intervalById.get(f.primaryId) ?? this.#index.eventById.get(f.primaryId)) : null;
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
      renderOverlay(this.#layers.overlay.ctx, f, { ...this.#overlay, previews: this.#editor.previews() });
      this.#a11y.schedule(() => this.frame(), this.#overlay.focusId, this.#selection.version);
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
    const w = Math.min(trackW, Math.max(16, (trackW * visible) / domain));
    const range = domain - visible;
    const left = range > 0 ? ((trackW - w) * (v.start - v.domainStart)) / range : 0;
    n.hthumb.style.width = `${w}px`;
    n.hthumb.style.transform = `translateX(${Math.max(0, Math.min(trackW - w, left))}px)`;
  }
}

export { TimelineError, ErrorCodes, EVENTS };
