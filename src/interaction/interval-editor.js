/**
 * Transactional interval editing.
 *
 *   idle ──begin──▶ previewing ──commit──▶ pending ──data applied / reject──▶ idle
 *                       │                     │
 *                       └──── cancel ─────────┘
 *
 * The editor never mutates data. While `previewing` the proposed interval is
 * drawn on the overlay; on `commit` an `intervalEditCommit` event is emitted
 * and the preview stays (dashed) as `pending` until the host applies data that
 * contains the interval id (or the final id from `replaceIds`), or calls
 * `rejectEdit(id)`.
 */

import { createSnapper } from '../core/snapping.js';
import { ErrorCodes, fail } from '../core/errors.js';

/** @typedef {'create'|'move'|'resize-start'|'resize-end'} EditOperation */

/**
 * @typedef {object} EditSession
 * @property {EditOperation} operation
 * @property {string} intervalId temp id for create
 * @property {string} trackId
 * @property {boolean} isNew
 * @property {{ start: number, end: number } | null} original
 * @property {number} start proposed
 * @property {number} end proposed
 * @property {number} anchorTime pointer time at begin
 * @property {number} grabOffset ms between pointer and interval start at begin (move)
 * @property {boolean} valid
 * @property {string | null} reason
 */

/**
 * @param {object} deps
 * @param {() => import('../core/validation.js').NormalizedOptions} deps.options
 * @param {() => import('../core/data-index.js').DataIndex} deps.index
 * @param {(name: string, detail: Record<string, unknown>) => void} deps.emit
 * @param {() => void} deps.invalidate
 * @param {() => ReturnType<typeof import('../core/format.js').createFormatter>} deps.formatter
 */
export function createIntervalEditor({ options, index, emit, invalidate, formatter }) {
  /** @type {EditSession | null} */
  let session = null;
  /** @type {Map<string, EditSession>} */
  const pending = new Map();
  let tempCounter = 0;
  let snapper = createSnapper({ increment: options().snap, timeZone: options().timeZone });
  let snapKey = `${options().snap}|${options().timeZone}`;

  const refreshSnapper = () => {
    const key = `${options().snap}|${options().timeZone}`;
    if (key !== snapKey) {
      snapper = createSnapper({ increment: options().snap, timeZone: options().timeZone });
      snapKey = key;
    }
  };

  /**
   * @param {import('../core/validation.js').NormalizedInterval} it
   */
  const isEditable = (it) => {
    const o = options();
    if (!o.editable || it.editable === false) return false;
    const track = index().trackById.get(it.trackId);
    return !!track && track.editable !== false;
  };

  /**
   * @param {import('../core/validation.js').NormalizedTrack} track
   */
  const isTrackEditable = (track) => options().editable && track.editable !== false;

  /** @param {EditSession} s */
  const validate = (s) => {
    const o = options();
    s.valid = true;
    s.reason = null;
    if (!(s.end > s.start)) {
      s.valid = false;
      s.reason = 'Interval must have a positive duration';
    } else if (s.start < o.domainStart || s.end > o.domainEnd) {
      s.valid = false;
      s.reason = 'Interval must stay within the configured date range';
    } else if (!index().trackById.has(s.trackId)) {
      s.valid = false;
      s.reason = 'Track no longer exists';
    }
  };

  /** @param {EditSession} s */
  const payload = (s) => ({
    operation: s.operation,
    intervalId: s.isNew ? null : s.intervalId,
    tempId: s.isNew ? s.intervalId : null,
    isNew: s.isNew,
    trackId: s.trackId,
    start: s.start,
    end: s.end,
    original: s.original ? { ...s.original } : null,
    valid: s.valid,
    reason: s.reason,
  });

  /** @param {EditSession} s */
  const previewLabel = (s) => {
    const f = formatter();
    return `${f.format(s.start, 'dateTime')} → ${f.format(s.end, 'dateTime')} (${f.duration(s.end - s.start)})`;
  };

  return {
    get active() {
      return session;
    },
    get isEditing() {
      return session !== null;
    },
    isEditable,
    isTrackEditable,
    /** @param {string} id */
    isPending(id) {
      return pending.has(id);
    },
    /** Previews for the overlay painter. */
    previews() {
      /** @type {import('../rendering/overlay-renderer.js').OverlayState['previews']} */
      const out = [];
      for (const s of pending.values()) out.push({ trackId: s.trackId, start: s.start, end: s.end, label: '', pending: true, id: s.intervalId });
      if (session) out.push({ trackId: session.trackId, start: session.start, end: session.end, label: previewLabel(session), pending: false, id: session.intervalId });
      return out;
    },
    /** Interval ids whose committed edit is pending (drawn as preview, original hidden). */
    pendingIds() {
      return new Set(pending.keys());
    },

    /**
     * Start editing an existing interval.
     * @param {import('../core/validation.js').NormalizedInterval} it
     * @param {'move'|'resize-start'|'resize-end'} operation
     * @param {number} pointerTime
     */
    beginExisting(it, operation, pointerTime) {
      if (session) this.cancel('restart');
      if (!isEditable(it)) return false;
      refreshSnapper();
      session = {
        operation,
        intervalId: it.id,
        trackId: it.trackId,
        isNew: false,
        original: { start: it.start, end: it.end },
        start: it.start,
        end: it.end,
        anchorTime: pointerTime,
        grabOffset: pointerTime - it.start,
        valid: true,
        reason: null,
      };
      emit('intervalEditStart', payload(session));
      invalidate();
      return true;
    },

    /**
     * Start creating an interval on a track by dragging.
     * @param {import('../core/validation.js').NormalizedTrack} track
     * @param {number} pointerTime
     */
    beginCreate(track, pointerTime) {
      if (session) this.cancel('restart');
      if (!isTrackEditable(track)) return false;
      refreshSnapper();
      const anchor = snapper(pointerTime);
      tempCounter += 1;
      session = {
        operation: 'create',
        intervalId: `tmp-${tempCounter}`,
        trackId: track.id,
        isNew: true,
        original: null,
        start: anchor,
        end: anchor,
        anchorTime: anchor,
        grabOffset: 0,
        valid: false,
        reason: 'Interval must have a positive duration',
      };
      emit('intervalEditStart', payload(session));
      invalidate();
      return true;
    },

    /**
     * Update the proposal from the current pointer time.
     * @param {number} pointerTime
     */
    update(pointerTime) {
      if (!session) return;
      const s = session;
      const o = options();
      const minDuration = Math.max(1, 0); // positive duration required
      switch (s.operation) {
        case 'create': {
          const t = snapper(pointerTime);
          s.start = Math.min(s.anchorTime, t);
          s.end = Math.max(s.anchorTime, t);
          break;
        }
        case 'move': {
          const orig = /** @type {{ start: number, end: number }} */ (s.original);
          const duration = orig.end - orig.start;
          let start = snapper(pointerTime - s.grabOffset);
          // keep inside the domain while preserving duration
          if (start < o.domainStart) start = o.domainStart;
          if (start + duration > o.domainEnd) start = o.domainEnd - duration;
          s.start = start;
          s.end = start + duration;
          break;
        }
        case 'resize-start': {
          const orig = /** @type {{ start: number, end: number }} */ (s.original);
          s.start = Math.min(snapper(pointerTime), orig.end - minDuration);
          s.end = orig.end;
          break;
        }
        case 'resize-end': {
          const orig = /** @type {{ start: number, end: number }} */ (s.original);
          s.end = Math.max(snapper(pointerTime), orig.start + minDuration);
          s.start = orig.start;
          break;
        }
      }
      validate(s);
      emit('intervalEditPreview', payload(s));
      invalidate();
    },

    /**
     * Finish the interaction. Emits `intervalEditCommit` when the proposal is
     * valid and differs from the original; otherwise cancels.
     */
    commit() {
      if (!session) return;
      const s = session;
      session = null;
      const unchanged = s.original && s.original.start === s.start && s.original.end === s.end;
      if (!s.valid || unchanged) {
        emit('intervalEditCancel', { ...payload(s), reason: unchanged ? 'unchanged' : (s.reason ?? 'invalid') });
        invalidate();
        return;
      }
      pending.set(s.intervalId, s);
      emit('intervalEditCommit', payload(s));
      invalidate();
    },

    /**
     * Abort the live interaction (Escape, pointercancel, blur, destroy).
     * @param {string} reason
     */
    cancel(reason = 'cancelled') {
      if (!session) return;
      const s = session;
      session = null;
      emit('intervalEditCancel', { ...payload(s), reason });
      invalidate();
    },

    /**
     * Host rejected a committed proposal: drop the pending preview and restore the original.
     * @param {string} id interval id or temp id
     */
    reject(id) {
      const key = String(id);
      const s = pending.get(key);
      if (!s) fail(ErrorCodes.UNKNOWN_ID, `rejectEdit(): no pending edit for "${key}"`, { id });
      pending.delete(key);
      emit('intervalEditCancel', { ...payload(s), reason: 'rejected' });
      invalidate();
    },

    /**
     * Called after the host applied data. Pending edits whose id (or renamed id)
     * is present in the new data are resolved. A full `setData` resolves everything.
     * @param {Record<string, string|number> | undefined} replaceIds
     * @param {boolean} fullReplace
     */
    onDataApplied(replaceIds, fullReplace) {
      if (fullReplace) {
        pending.clear();
        if (session) this.cancel('data-replaced');
        invalidate();
        return;
      }
      const idx = index();
      for (const [key, s] of pending) {
        const finalId = replaceIds && Object.prototype.hasOwnProperty.call(replaceIds, key) ? String(replaceIds[key]) : key;
        const applied = idx.intervalById.get(finalId);
        if (applied || (replaceIds && key in replaceIds)) pending.delete(key);
        else if (!s.isNew && !idx.intervalById.has(key)) pending.delete(key); // interval removed by host
      }
      if (session && !session.isNew && !idx.intervalById.has(session.intervalId)) this.cancel('interval-removed');
      invalidate();
    },

    /** Drop everything (destroy). */
    dispose() {
      if (session) this.cancel('destroyed');
      pending.clear();
    },
  };
}
