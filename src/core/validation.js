/**
 * Configuration and data validation.
 *
 * `validateData` is pure and atomic: it either returns fully normalized copies
 * of the caller's tracks, intervals and events, or throws a `TimelineError`
 * describing every structural problem found. Caller objects are never mutated;
 * each normalized item keeps a `source` reference to the original.
 *
 * Items that reference an unknown track are *not* structural errors: they are
 * returned separately in `orphans` so the host can be notified via `dataError`
 * while valid items are still displayed.
 */

import { ErrorCodes, TimelineError, fail } from './errors.js';
import { ZOOM_PRESETS } from './viewport.js';
import { resolveTimeZone } from './tz.js';
import { parseIncrement } from './snapping.js';

/** @typedef {'dot'|'line'|'diamond'} MarkerShape */
export const MARKER_SHAPES = Object.freeze(['dot', 'line', 'diamond']);

/**
 * @typedef {object} TimelineOptions
 * @property {string|number|Date} startDate
 * @property {string|number|Date} endDate
 * @property {'dark'|'light'} [theme]
 * @property {'canvas'} [renderMode]
 * @property {boolean} [editable]
 * @property {boolean} [selectable]
 * @property {boolean} [multiSelect]
 * @property {boolean} [showGrid]
 * @property {boolean} [showToday]
 * @property {boolean} [showTrackLines]
 * @property {boolean} [showAxis]
 * @property {string} [locale]
 * @property {string} [timeZone]
 * @property {number} [rowHeight]
 * @property {number} [labelWidth]
 * @property {number} [axisHeight]
 * @property {number} [barHeight]
 * @property {number} [markerSize]
 * @property {{ initial?: string, min?: string, max?: string, presets?: Record<string, number>, wheelFactor?: number, stepFactor?: number }} [zoom]
 * @property {number|string|null} [snap]
 * @property {boolean} [hideEmptyTracks]
 * @property {'data'|'label'|'firstEvent'|'lastEvent'|((a: NormalizedTrack, b: NormalizedTrack) => number)} [trackOrder]
 * @property {number} [compactHeight]
 * @property {boolean} [injectStyles]
 * @property {number} [weekStartsOn]
 * @property {Record<string, Intl.DateTimeFormatOptions>} [formats]
 * @property {string} [ariaLabel]
 * @property {number} [minTickSpacing]
 * @property {number} [hitTolerance]
 * @property {boolean} [tooltips]
 */

export const DEFAULT_OPTIONS = Object.freeze({
  theme: 'dark',
  renderMode: 'canvas',
  editable: false,
  selectable: true,
  multiSelect: true,
  showGrid: true,
  showToday: true,
  showTrackLines: true,
  showAxis: true,
  locale: undefined,
  timeZone: 'UTC',
  rowHeight: 32,
  labelWidth: 160,
  axisHeight: 44,
  barHeight: 8,
  markerSize: 6,
  zoom: Object.freeze({ initial: 'week', min: 'day', max: 'quarter', presets: ZOOM_PRESETS, wheelFactor: 1.1, stepFactor: 1.5 }),
  snap: null,
  hideEmptyTracks: false,
  trackOrder: 'data',
  compactHeight: 150,
  injectStyles: true,
  weekStartsOn: 1,
  formats: Object.freeze({}),
  ariaLabel: 'Timeline',
  minTickSpacing: 48,
  hitTolerance: 4,
  tooltips: true,
});

/**
 * Parse an ISO 8601 string, epoch number or Date into epoch ms.
 * @param {unknown} value
 * @param {string} field
 * @param {string} [context]
 * @returns {number}
 */
export function toEpoch(value, field, context = '') {
  let ms;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'number') ms = value;
  else if (typeof value === 'string' && value.trim() !== '') ms = Date.parse(value);
  else ms = NaN;
  if (!Number.isFinite(ms)) {
    fail(ErrorCodes.INVALID_TIMESTAMP, `${context}${field} is not a valid ISO 8601 timestamp (received ${JSON.stringify(value)})`, {
      field,
      value,
    });
  }
  return ms;
}

/**
 * @param {unknown} id
 * @param {string} what
 * @returns {string}
 */
function normalizeId(id, what) {
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return fail(ErrorCodes.MISSING_FIELD, `${what} is missing a valid "id" (string or number)`, { id });
}

/**
 * @param {unknown} v
 * @param {string} name
 * @param {number} [min]
 */
function positiveNumber(v, name, min = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
    fail(ErrorCodes.INVALID_CONFIG, `options.${name} must be a number >= ${min} (received ${String(v)})`);
  }
  return v;
}

/**
 * @param {unknown} v
 * @param {string} name
 */
function bool(v, name) {
  if (typeof v !== 'boolean') fail(ErrorCodes.INVALID_CONFIG, `options.${name} must be a boolean (received ${String(v)})`);
  return v;
}

/**
 * Validate and fill in defaults. Throws `TimelineError(INVALID_CONFIG)`.
 * @param {TimelineOptions} options
 */
export function normalizeOptions(options) {
  if (!options || typeof options !== 'object') fail(ErrorCodes.INVALID_CONFIG, 'options object is required');
  const o = { ...DEFAULT_OPTIONS, ...options, zoom: { ...DEFAULT_OPTIONS.zoom, ...(options.zoom ?? {}) } };

  if (options.startDate === undefined || options.endDate === undefined) {
    fail(ErrorCodes.INVALID_CONFIG, 'options.startDate and options.endDate are required');
  }
  const domainStart = toEpoch(options.startDate, 'startDate', 'options.');
  const domainEnd = toEpoch(options.endDate, 'endDate', 'options.');
  if (!(domainEnd > domainStart)) fail(ErrorCodes.INVALID_CONFIG, 'options.endDate must be after options.startDate');

  if (o.renderMode !== 'canvas') {
    fail(ErrorCodes.INVALID_CONFIG, `options.renderMode "${o.renderMode}" is not supported in this version (use "canvas")`);
  }
  if (o.theme !== 'dark' && o.theme !== 'light') fail(ErrorCodes.INVALID_CONFIG, `options.theme must be "dark" or "light"`);
  for (const k of ['editable', 'selectable', 'multiSelect', 'showGrid', 'showToday', 'showTrackLines', 'showAxis', 'hideEmptyTracks', 'injectStyles', 'tooltips']) {
    bool(o[k], k);
  }
  for (const k of ['rowHeight', 'labelWidth', 'axisHeight', 'barHeight', 'markerSize', 'compactHeight', 'minTickSpacing', 'hitTolerance']) {
    positiveNumber(o[k], k, k === 'rowHeight' || k === 'barHeight' ? 1 : 0);
  }
  if (o.barHeight > o.rowHeight) fail(ErrorCodes.INVALID_CONFIG, 'options.barHeight cannot exceed options.rowHeight');
  if (!Number.isInteger(o.weekStartsOn) || o.weekStartsOn < 0 || o.weekStartsOn > 6) {
    fail(ErrorCodes.INVALID_CONFIG, 'options.weekStartsOn must be an integer 0-6');
  }
  if (o.locale !== undefined && typeof o.locale !== 'string') fail(ErrorCodes.INVALID_CONFIG, 'options.locale must be a string');
  if (o.locale !== undefined) {
    try {
      new Intl.DateTimeFormat(o.locale);
    } catch {
      fail(ErrorCodes.INVALID_CONFIG, `Unknown locale "${o.locale}"`);
    }
  }
  const timeZone = resolveTimeZone(o.timeZone);
  parseIncrement(o.snap);

  const presets = { ...ZOOM_PRESETS, ...(o.zoom.presets ?? {}) };
  for (const [name, v] of Object.entries(presets)) {
    if (!(typeof v === 'number' && v > 0)) fail(ErrorCodes.INVALID_CONFIG, `options.zoom.presets.${name} must be a positive number`);
  }
  for (const k of ['initial', 'min', 'max']) {
    const name = o.zoom[k];
    if (!presets[name]) {
      fail(ErrorCodes.INVALID_CONFIG, `options.zoom.${k} "${name}" is not a zoom preset (${Object.keys(presets).join(', ')})`);
    }
  }
  if (presets[o.zoom.min] < presets[o.zoom.max]) {
    fail(ErrorCodes.INVALID_CONFIG, 'options.zoom.min must be a finer (more zoomed-in) preset than options.zoom.max');
  }
  if (presets[o.zoom.initial] > presets[o.zoom.min] || presets[o.zoom.initial] < presets[o.zoom.max]) {
    fail(ErrorCodes.INVALID_CONFIG, 'options.zoom.initial must lie between options.zoom.min and options.zoom.max');
  }
  positiveNumber(o.zoom.wheelFactor, 'zoom.wheelFactor', 1.0001);
  positiveNumber(o.zoom.stepFactor, 'zoom.stepFactor', 1.0001);

  const order = o.trackOrder;
  if (typeof order !== 'function' && !['data', 'label', 'firstEvent', 'lastEvent'].includes(/** @type {string} */ (order))) {
    fail(ErrorCodes.INVALID_CONFIG, 'options.trackOrder must be "data", "label", "firstEvent", "lastEvent" or a comparator');
  }
  if (o.formats && typeof o.formats !== 'object') fail(ErrorCodes.INVALID_CONFIG, 'options.formats must be an object');

  return Object.freeze({
    ...o,
    timeZone,
    domainStart,
    domainEnd,
    zoom: Object.freeze({ ...o.zoom, presets: Object.freeze(presets) }),
  });
}

/** @typedef {ReturnType<typeof normalizeOptions>} NormalizedOptions */

/**
 * @typedef {object} NormalizedTrack
 * @property {string} id
 * @property {string} label
 * @property {number} order
 * @property {boolean} visible
 * @property {boolean|undefined} editable
 * @property {string|undefined} color
 * @property {Record<string, unknown>} metadata
 * @property {object} source
 */

/**
 * @typedef {object} NormalizedInterval
 * @property {'interval'} kind
 * @property {string} id
 * @property {string} trackId
 * @property {number} start
 * @property {number} end
 * @property {string|undefined} label
 * @property {string|undefined} color
 * @property {boolean|undefined} editable
 * @property {Record<string, unknown>} metadata
 * @property {object} source
 */

/**
 * @typedef {object} NormalizedEvent
 * @property {'event'} kind
 * @property {string} id
 * @property {string} type
 * @property {'track'|'global'} scope
 * @property {string|null} trackId
 * @property {number} time
 * @property {number} start
 * @property {number} end
 * @property {boolean} isRange
 * @property {string|undefined} label
 * @property {string|undefined} color
 * @property {MarkerShape} marker
 * @property {Record<string, unknown>} metadata
 * @property {object} source
 */

/**
 * @typedef {object} NormalizedData
 * @property {NormalizedTrack[]} tracks
 * @property {NormalizedInterval[]} intervals
 * @property {NormalizedEvent[]} events
 * @property {{ intervals: NormalizedInterval[], events: NormalizedEvent[] }} orphans
 */

/**
 * @param {unknown} v
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function metadata(v, what) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object') fail(ErrorCodes.INVALID_TYPE, `${what}.metadata must be an object`);
  return /** @type {Record<string, unknown>} */ (v);
}

/**
 * @param {unknown} v
 * @param {string} what
 */
function optionalString(v, what) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') fail(ErrorCodes.INVALID_TYPE, `${what} must be a string`);
  return v;
}

/**
 * @param {unknown} v
 * @param {string} what
 */
function optionalBool(v, what) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') fail(ErrorCodes.INVALID_TYPE, `${what} must be a boolean`);
  return v;
}

/**
 * @param {unknown} list
 * @param {string} name
 * @returns {object[]}
 */
function arrayOf(list, name) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) fail(ErrorCodes.INVALID_TYPE, `data.${name} must be an array`);
  return list;
}

/**
 * @param {object} raw
 * @param {number} index
 * @returns {NormalizedTrack}
 */
export function normalizeTrack(raw, index) {
  if (!raw || typeof raw !== 'object') fail(ErrorCodes.INVALID_TYPE, `tracks[${index}] must be an object`);
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = normalizeId(r.id, `tracks[${index}]`);
  const what = `track "${id}"`;
  const label = r.label === undefined || r.label === null ? id : String(r.label);
  let order = index;
  if (r.order !== undefined && r.order !== null) {
    if (typeof r.order !== 'number' || !Number.isFinite(r.order)) fail(ErrorCodes.INVALID_TYPE, `${what}.order must be a number`);
    order = r.order;
  }
  return {
    id,
    label,
    order,
    visible: optionalBool(r.visible, `${what}.visible`) ?? true,
    editable: optionalBool(r.editable, `${what}.editable`),
    color: optionalString(r.color, `${what}.color`),
    metadata: metadata(r.metadata, what),
    source: raw,
  };
}

/**
 * @param {object} raw
 * @param {number} index
 * @returns {NormalizedInterval}
 */
export function normalizeInterval(raw, index) {
  if (!raw || typeof raw !== 'object') fail(ErrorCodes.INVALID_TYPE, `intervals[${index}] must be an object`);
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = normalizeId(r.id, `intervals[${index}]`);
  const what = `interval "${id}"`;
  if (r.trackId === undefined || r.trackId === null || r.trackId === '') {
    fail(ErrorCodes.MISSING_FIELD, `${what} is missing "trackId"`, { id });
  }
  const start = toEpoch(r.start, 'start', `${what}: `);
  const end = toEpoch(r.end, 'end', `${what}: `);
  if (!(start < end)) {
    fail(ErrorCodes.INVALID_RANGE, `${what}: start must be strictly earlier than end`, { id, start: r.start, end: r.end });
  }
  return {
    kind: 'interval',
    id,
    trackId: String(r.trackId),
    start,
    end,
    label: optionalString(r.label, `${what}.label`),
    color: optionalString(r.color, `${what}.color`),
    editable: optionalBool(r.editable, `${what}.editable`),
    metadata: metadata(r.metadata, what),
    source: raw,
  };
}

/**
 * @param {object} raw
 * @param {number} index
 * @returns {NormalizedEvent}
 */
export function normalizeEvent(raw, index) {
  if (!raw || typeof raw !== 'object') fail(ErrorCodes.INVALID_TYPE, `events[${index}] must be an object`);
  const r = /** @type {Record<string, unknown>} */ (raw);
  const id = normalizeId(r.id, `events[${index}]`);
  const what = `event "${id}"`;
  const scope = r.scope === undefined || r.scope === null ? (r.trackId ? 'track' : 'global') : r.scope;
  if (scope !== 'track' && scope !== 'global') fail(ErrorCodes.INVALID_TYPE, `${what}.scope must be "track" or "global"`, { id });
  if (scope === 'track' && (r.trackId === undefined || r.trackId === null || r.trackId === '')) {
    fail(ErrorCodes.MISSING_FIELD, `${what} has scope "track" but no "trackId"`, { id });
  }
  const type = r.type === undefined || r.type === null ? 'default' : String(r.type);
  const marker = r.marker === undefined || r.marker === null ? 'dot' : r.marker;
  if (!MARKER_SHAPES.includes(/** @type {MarkerShape} */ (marker))) {
    fail(ErrorCodes.INVALID_TYPE, `${what}.marker must be one of ${MARKER_SHAPES.join(', ')}`, { id });
  }

  let time;
  let start;
  let end;
  let isRange = false;
  if (r.date !== undefined && r.date !== null) {
    time = toEpoch(r.date, 'date', `${what}: `);
    start = end = time;
  } else if (r.start !== undefined || r.end !== undefined) {
    if (scope !== 'global') fail(ErrorCodes.INVALID_TYPE, `${what}: only global events may have start/end; track events need "date"`, { id });
    start = toEpoch(r.start, 'start', `${what}: `);
    end = toEpoch(r.end, 'end', `${what}: `);
    if (!(start < end)) fail(ErrorCodes.INVALID_RANGE, `${what}: start must be strictly earlier than end`, { id });
    time = start;
    isRange = true;
  } else {
    fail(ErrorCodes.MISSING_FIELD, `${what} is missing "date" (or "start"/"end" for a global range)`, { id });
  }

  return {
    kind: 'event',
    id,
    type,
    scope,
    trackId: scope === 'track' ? String(r.trackId) : null,
    time: /** @type {number} */ (time),
    start: /** @type {number} */ (start),
    end: /** @type {number} */ (end),
    isRange,
    label: optionalString(r.label, `${what}.label`),
    color: optionalString(r.color, `${what}.color`),
    marker: /** @type {MarkerShape} */ (marker),
    metadata: metadata(r.metadata, what),
    source: raw,
  };
}

/**
 * Validate a complete data set. Pure; never mutates `input`.
 *
 * ID rules: track IDs are unique among tracks; interval and event IDs share a
 * single namespace (so selection can address both) and must be unique there.
 *
 * @param {{ tracks?: object[], intervals?: object[], events?: object[] } | null | undefined} input
 * @returns {NormalizedData}
 */
export function validateData(input) {
  if (input === null || input === undefined) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) fail(ErrorCodes.INVALID_TYPE, 'setData() expects an object { tracks, intervals, events }');

  const tracks = arrayOf(input.tracks, 'tracks').map(normalizeTrack);
  const intervals = arrayOf(input.intervals, 'intervals').map(normalizeInterval);
  const events = arrayOf(input.events, 'events').map(normalizeEvent);

  /** @type {Set<string>} */
  const trackIds = new Set();
  /** @type {string[]} */
  const dupTracks = [];
  for (const t of tracks) {
    if (trackIds.has(t.id)) dupTracks.push(t.id);
    trackIds.add(t.id);
  }
  /** @type {Set<string>} */
  const itemIds = new Set();
  /** @type {string[]} */
  const dupItems = [];
  for (const it of [...intervals, ...events]) {
    if (itemIds.has(it.id)) dupItems.push(it.id);
    itemIds.add(it.id);
  }
  if (dupTracks.length || dupItems.length) {
    const parts = [];
    if (dupTracks.length) parts.push(`tracks: ${dupTracks.join(', ')}`);
    if (dupItems.length) parts.push(`intervals/events: ${dupItems.join(', ')}`);
    throw new TimelineError(ErrorCodes.DUPLICATE_ID, `Duplicate IDs found (${parts.join('; ')})`, { tracks: dupTracks, items: dupItems });
  }

  const orphans = { intervals: /** @type {NormalizedInterval[]} */ ([]), events: /** @type {NormalizedEvent[]} */ ([]) };
  const validIntervals = intervals.filter((i) => (trackIds.has(i.trackId) ? true : (orphans.intervals.push(i), false)));
  const validEvents = events.filter((e) => (e.scope === 'global' || trackIds.has(/** @type {string} */ (e.trackId)) ? true : (orphans.events.push(e), false)));

  return { tracks, intervals: validIntervals, events: validEvents, orphans };
}

/**
 * Apply an incremental patch to the *raw* collections and return new raw
 * collections, ready to be passed through `validateData`. Items are matched
 * by `id`; `remove` lists IDs; `replaceIds` maps temporary IDs to final ones.
 *
 * @param {{ tracks: object[], intervals: object[], events: object[] }} current raw sources
 * @param {{ tracks?: object[], intervals?: object[], events?: object[], remove?: { tracks?: unknown[], intervals?: unknown[], events?: unknown[] }, replaceIds?: Record<string, string|number> }} patch
 */
export function applyPatch(current, patch) {
  if (!patch || typeof patch !== 'object') fail(ErrorCodes.INVALID_TYPE, 'updateData() expects a patch object');
  const replace = patch.replaceIds ?? {};
  /**
   * @param {object[]} list
   * @param {object[] | undefined} upserts
   * @param {unknown[] | undefined} removals
   * @param {boolean} items whether replaceIds applies
   */
  const merge = (list, upserts, removals, items) => {
    const removeSet = new Set((removals ?? []).map(String));
    /** @type {Map<string, object>} */
    const byId = new Map();
    for (let raw of list) {
      const r = /** @type {Record<string, unknown>} */ (raw);
      let id = String(r.id);
      if (items && Object.prototype.hasOwnProperty.call(replace, id)) {
        id = String(replace[id]);
        raw = { ...r, id: replace[/** @type {string} */ (r.id)] };
      }
      if (!removeSet.has(id)) byId.set(id, raw);
    }
    for (const raw of arrayOf(upserts, 'patch')) {
      const r = /** @type {Record<string, unknown>} */ (raw);
      byId.set(String(r.id), raw);
    }
    return [...byId.values()];
  };
  return {
    tracks: merge(current.tracks, patch.tracks, patch.remove?.tracks, false),
    intervals: merge(current.intervals, patch.intervals, patch.remove?.intervals, true),
    events: merge(current.events, patch.events, patch.remove?.events, true),
  };
}
