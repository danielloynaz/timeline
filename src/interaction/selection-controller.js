/**
 * Selection state and pointer/keyboard selection semantics.
 *
 *  - click:            single select (replaces)
 *  - ctrl/meta+click:  toggle
 *  - shift+click:      add
 *  - click on empty:   clear (unless ctrl/meta)
 *
 * `set()` is the programmatic path and does not emit; user-driven changes emit
 * `selectionChange`. `reconcile()` drops ids that no longer exist or are no
 * longer eligible after a data/filter change and emits only if something changed.
 */

/**
 * @param {object} deps
 * @param {(id: string) => boolean} deps.isSelectable
 * @param {() => boolean} deps.multiSelect
 * @param {(detail: { ids: string[], primaryId: string | null }) => void} deps.emit
 * @param {() => void} deps.invalidate
 */
export function createSelectionController({ isSelectable, multiSelect, emit, invalidate }) {
  /** @type {Set<string>} */
  let ids = new Set();
  /** @type {string | null} */
  let primaryId = null;
  /** Incremented on every change (programmatic or user-driven). */
  let version = 0;

  const detail = () => ({ ids: [...ids], primaryId });

  /** @param {{ ids: string[], primaryId: string | null }} before */
  const emitIfChanged = (before) => {
    const after = detail();
    const same = before.primaryId === after.primaryId && before.ids.length === after.ids.length && before.ids.every((i) => ids.has(i));
    if (!same) version++;
    invalidate();
    if (!same) emit(after);
  };

  /** @param {string | null} preferred */
  const fixPrimary = (preferred) => {
    if (preferred && ids.has(preferred)) primaryId = preferred;
    else if (primaryId && ids.has(primaryId)) return;
    else primaryId = ids.size ? [...ids][ids.size - 1] : null;
  };

  return {
    get ids() {
      return ids;
    },
    get primaryId() {
      return primaryId;
    },
    get version() {
      return version;
    },
    detail,
    /**
     * Programmatic set; no event.
     * @param {Iterable<string>} list
     * @param {string | null} [primary]
     */
    set(list, primary = null) {
      ids = new Set([...list].filter(isSelectable));
      primaryId = null;
      fixPrimary(primary);
      version++;
      invalidate();
    },
    /**
     * Pointer click semantics.
     * @param {string | null} id null = empty area
     * @param {{ ctrl?: boolean, meta?: boolean, shift?: boolean }} mods
     */
    click(id, mods) {
      const additive = (mods.ctrl || mods.meta) && multiSelect();
      const extend = mods.shift && multiSelect();
      const before = detail();
      if (id === null) {
        if (additive) return;
        ids = new Set();
        primaryId = null;
      } else if (!isSelectable(id)) {
        return;
      } else if (additive) {
        if (ids.has(id)) {
          ids.delete(id);
          fixPrimary(null);
        } else {
          ids.add(id);
          primaryId = id;
        }
      } else if (extend) {
        ids.add(id);
        primaryId = id;
      } else {
        ids = new Set([id]);
        primaryId = id;
      }
      emitIfChanged(before);
    },
    /**
     * Keyboard: toggle one id (space) or select exclusively (enter/arrow without shift).
     * @param {string} id
     * @param {'toggle'|'replace'|'add'} mode
     */
    keyboard(id, mode) {
      if (!isSelectable(id)) return;
      const before = detail();
      if (mode === 'toggle' && multiSelect()) {
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        fixPrimary(ids.has(id) ? id : null);
      } else if (mode === 'add' && multiSelect()) {
        ids.add(id);
        primaryId = id;
      } else {
        ids = new Set([id]);
        primaryId = id;
      }
      emitIfChanged(before);
    },
    /** Drop ineligible ids; emit only when something changed. */
    reconcile() {
      const before = detail();
      for (const id of [...ids]) if (!isSelectable(id)) ids.delete(id);
      fixPrimary(null);
      emitIfChanged(before);
    },
    clear() {
      const before = detail();
      ids = new Set();
      primaryId = null;
      emitIfChanged(before);
    },
  };
}
