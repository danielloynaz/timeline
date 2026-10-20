/**
 * Data indexes for viewport queries and hit-testing.
 *
 * Intervals per track are sorted by start with a running "max end" prefix,
 * which answers "which intervals overlap [a, b)?" in O(log n + k) without an
 * interval tree. Events per track are sorted by time. Global items have their
 * own indexes. Everything here is DOM-free and pure.
 */

/**
 * First index whose value is >= `value`.
 * @param {ArrayLike<number>} arr sorted ascending
 * @param {number} value
 */
export function lowerBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * First index whose value is > `value`.
 * @param {ArrayLike<number>} arr sorted ascending
 * @param {number} value
 */
export function upperBound(arr, value) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @template {{ id: string, start: number, end: number }} T
 * @param {T[]} input
 */
export function buildRangeIndex(input) {
  const items = input.slice().sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = items.length;
  const starts = new Float64Array(n);
  const ends = new Float64Array(n);
  const maxEnd = new Float64Array(n);
  let running = -Infinity;
  for (let i = 0; i < n; i++) {
    starts[i] = items[i].start;
    ends[i] = items[i].end;
    running = Math.max(running, items[i].end);
    maxEnd[i] = running;
  }
  return {
    items,
    starts,
    ends,
    maxEnd,
    size: n,
    /**
     * Items intersecting `[a, b)` in ascending start order.
     * @param {number} a
     * @param {number} b
     * @returns {T[]}
     */
    query(a, b) {
      /** @type {T[]} */
      const out = [];
      if (n === 0 || b <= a) return out;
      let i = lowerBound(starts, b) - 1; // last item starting before b
      while (i >= 0 && maxEnd[i] > a) {
        if (ends[i] > a) out.push(items[i]);
        i--;
      }
      return out.reverse();
    },
  };
}

/**
 * @template {{ id: string, time: number }} T
 * @param {T[]} input
 */
export function buildPointIndex(input) {
  const items = input.slice().sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = items.length;
  const times = new Float64Array(n);
  for (let i = 0; i < n; i++) times[i] = items[i].time;
  return {
    items,
    times,
    size: n,
    /**
     * Items with `a <= time <= b` in ascending order.
     * @param {number} a
     * @param {number} b
     * @returns {T[]}
     */
    query(a, b) {
      if (n === 0 || b < a) return [];
      return items.slice(lowerBound(times, a), upperBound(times, b));
    },
  };
}

/** @typedef {import('./validation.js').NormalizedTrack} Track */
/** @typedef {import('./validation.js').NormalizedInterval} Interval */
/** @typedef {import('./validation.js').NormalizedEvent} Event */

/**
 * @typedef {object} TrackBucket
 * @property {ReturnType<typeof buildRangeIndex<Interval>>} intervals
 * @property {ReturnType<typeof buildPointIndex<Event>>} events
 * @property {number} first earliest timestamp on the track (Infinity when empty)
 * @property {number} last latest timestamp on the track (-Infinity when empty)
 */

/**
 * @param {{ tracks: Track[], intervals: Interval[], events: Event[] }} data normalized & filtered
 */
export function buildDataIndex({ tracks, intervals, events }) {
  /** @type {Map<string, Track>} */
  const trackById = new Map();
  for (const t of tracks) trackById.set(t.id, t);
  /** @type {Map<string, Interval>} */
  const intervalById = new Map();
  /** @type {Map<string, Event>} */
  const eventById = new Map();

  /** @type {Map<string, Interval[]>} */
  const intervalsByTrack = new Map();
  /** @type {Map<string, Event[]>} */
  const eventsByTrack = new Map();
  /** @type {Event[]} */
  const globalPointList = [];
  /** @type {Event[]} */
  const globalRangeList = [];

  let dataStart = Infinity;
  let dataEnd = -Infinity;

  for (const it of intervals) {
    intervalById.set(it.id, it);
    let list = intervalsByTrack.get(it.trackId);
    if (!list) intervalsByTrack.set(it.trackId, (list = []));
    list.push(it);
    if (it.start < dataStart) dataStart = it.start;
    if (it.end > dataEnd) dataEnd = it.end;
  }
  for (const ev of events) {
    eventById.set(ev.id, ev);
    if (ev.scope === 'global') (ev.isRange ? globalRangeList : globalPointList).push(ev);
    else {
      const tid = /** @type {string} */ (ev.trackId);
      let list = eventsByTrack.get(tid);
      if (!list) eventsByTrack.set(tid, (list = []));
      list.push(ev);
    }
    if (ev.start < dataStart) dataStart = ev.start;
    if (ev.end > dataEnd) dataEnd = ev.end;
  }

  /** @type {Map<string, TrackBucket>} */
  const byTrack = new Map();
  const emptyRange = buildRangeIndex(/** @type {Interval[]} */ ([]));
  const emptyPoint = buildPointIndex(/** @type {Event[]} */ ([]));
  for (const t of tracks) {
    const iv = intervalsByTrack.get(t.id);
    const evs = eventsByTrack.get(t.id);
    const intervalsIdx = iv ? buildRangeIndex(iv) : emptyRange;
    const eventsIdx = evs ? buildPointIndex(evs) : emptyPoint;
    let first = Infinity;
    let last = -Infinity;
    if (intervalsIdx.size) {
      first = intervalsIdx.starts[0];
      last = intervalsIdx.maxEnd[intervalsIdx.size - 1];
    }
    if (eventsIdx.size) {
      first = Math.min(first, eventsIdx.times[0]);
      last = Math.max(last, eventsIdx.times[eventsIdx.size - 1]);
    }
    byTrack.set(t.id, { intervals: intervalsIdx, events: eventsIdx, first, last });
  }

  const globalPoints = buildPointIndex(globalPointList);
  const globalRanges = buildRangeIndex(globalRangeList);

  return {
    tracks,
    trackById,
    intervalById,
    eventById,
    byTrack,
    globalPoints,
    globalRanges,
    /** `null` when there is no time-bearing data. */
    dataRange: dataStart <= dataEnd ? { start: dataStart, end: dataEnd } : null,
    /**
     * Items of one track intersecting `[start, end]`.
     * @param {string} trackId
     * @param {number} start
     * @param {number} end
     */
    queryRow(trackId, start, end) {
      const b = byTrack.get(trackId);
      if (!b) return { intervals: /** @type {Interval[]} */ ([]), events: /** @type {Event[]} */ ([]) };
      return { intervals: b.intervals.query(start, end), events: b.events.query(start, end) };
    },
    /**
     * Global items intersecting `[start, end]`.
     * @param {number} start
     * @param {number} end
     */
    queryGlobal(start, end) {
      return { points: globalPoints.query(start, end), ranges: globalRanges.query(start, end) };
    },
    /**
     * Whether the track has any item intersecting `[start, end]`.
     * @param {string} trackId
     * @param {number} start
     * @param {number} end
     */
    trackHasItems(trackId, start, end) {
      const b = byTrack.get(trackId);
      if (!b || b.first > end || b.last < start) return false;
      if (b.events.size && lowerBound(b.events.times, start) < upperBound(b.events.times, end)) return true;
      return b.intervals.query(start, end).length > 0;
    },
    /**
     * Sub-lane of an interval. Always 0 in this version; reserved for stacking.
     * @param {string} _intervalId
     */
    laneOf(_intervalId) {
      return 0;
    },
    /**
     * Number of lanes a track occupies. Always 1 in this version.
     * @param {string} _trackId
     */
    laneCount(_trackId) {
      return 1;
    },
  };
}

/** @typedef {ReturnType<typeof buildDataIndex>} DataIndex */

/**
 * Order and filter tracks into rows.
 *
 * @param {object} args
 * @param {DataIndex} args.index
 * @param {import('./validation.js').NormalizedOptions['trackOrder']} args.trackOrder
 * @param {boolean} args.hideEmptyTracks
 * @param {number} args.viewStart
 * @param {number} args.viewEnd
 * @param {((track: Track) => boolean) | null} [args.trackFilter]
 * @returns {{ rows: Track[], rowOfTrack: Map<string, number> }}
 */
export function computeTrackRows({ index, trackOrder, hideEmptyTracks, viewStart, viewEnd, trackFilter = null }) {
  let rows = index.tracks.filter((t) => t.visible && (!trackFilter || trackFilter(t)));
  if (hideEmptyTracks) rows = rows.filter((t) => index.trackHasItems(t.id, viewStart, viewEnd));

  /** @type {(a: Track, b: Track) => number} */
  let cmp;
  const byData = (/** @type {Track} */ a, /** @type {Track} */ b) => a.order - b.order || index.tracks.indexOf(a) - index.tracks.indexOf(b);
  if (typeof trackOrder === 'function') cmp = trackOrder;
  else if (trackOrder === 'label') cmp = (a, b) => a.label.localeCompare(b.label) || byData(a, b);
  else if (trackOrder === 'firstEvent') {
    cmp = (a, b) => (index.byTrack.get(a.id)?.first ?? Infinity) - (index.byTrack.get(b.id)?.first ?? Infinity) || byData(a, b);
  } else if (trackOrder === 'lastEvent') {
    cmp = (a, b) => (index.byTrack.get(b.id)?.last ?? -Infinity) - (index.byTrack.get(a.id)?.last ?? -Infinity) || byData(a, b);
  } else cmp = byData;

  rows = rows.slice().sort(cmp);
  /** @type {Map<string, number>} */
  const rowOfTrack = new Map();
  rows.forEach((t, i) => rowOfTrack.set(t.id, i));
  return { rows, rowOfTrack };
}
