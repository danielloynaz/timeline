/**
 * Single event system: the library dispatches native `CustomEvent`s on its
 * root element using the `timeline:<kebab-name>` convention. `on`/`off` are
 * thin wrappers over `addEventListener`/`removeEventListener`, so host code
 * can use either API interchangeably and listeners can bubble to ancestors.
 */

/** @type {Record<string, string>} */
export const EVENTS = Object.freeze({
  selectionChange: 'timeline:selection-change',
  eventActivate: 'timeline:event-activate',
  viewportChange: 'timeline:viewport-change',
  intervalEditStart: 'timeline:interval-edit-start',
  intervalEditPreview: 'timeline:interval-edit-preview',
  intervalEditCommit: 'timeline:interval-edit-commit',
  intervalEditCancel: 'timeline:interval-edit-cancel',
  rangeSelect: 'timeline:range-select',
  hover: 'timeline:hover',
  itemClick: 'timeline:item-click',
  itemDoubleClick: 'timeline:item-double-click',
  contextMenu: 'timeline:context-menu',
  dataError: 'timeline:data-error',
  destroy: 'timeline:destroy',
});

export const EVENT_PREFIX = 'timeline:';

/**
 * Convert `selectionChange`, `selection-change` or `timeline:selection-change`
 * to the DOM event type `timeline:selection-change`.
 * @param {string} name
 */
export function toDomEventName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('event name must be a non-empty string');
  if (name.startsWith(EVENT_PREFIX)) return name;
  if (EVENTS[name]) return EVENTS[name];
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return EVENT_PREFIX + kebab;
}

/**
 * @param {string} domName
 * @returns {string} camelCase name without prefix
 */
export function toApiEventName(domName) {
  const bare = domName.startsWith(EVENT_PREFIX) ? domName.slice(EVENT_PREFIX.length) : domName;
  return bare.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {EventTarget} target
 */
export function createEmitter(target) {
  return {
    /**
     * Dispatch an event. Returns `false` when a listener called `preventDefault()`.
     * @param {string} name
     * @param {Record<string, unknown>} [detail]
     * @param {{ cancelable?: boolean }} [opts]
     */
    emit(name, detail = {}, opts = {}) {
      const type = toDomEventName(name);
      const event = new CustomEvent(type, {
        bubbles: true,
        cancelable: opts.cancelable ?? false,
        detail: { type: toApiEventName(type), timestamp: Date.now(), ...detail },
      });
      return target.dispatchEvent(event);
    },
    /**
     * @param {string} name
     * @param {(event: CustomEvent) => void} callback
     * @param {AddEventListenerOptions} [options]
     */
    on(name, callback, options) {
      if (typeof callback !== 'function') throw new TypeError('on(): callback must be a function');
      target.addEventListener(toDomEventName(name), /** @type {EventListener} */ (callback), options);
    },
    /**
     * @param {string} name
     * @param {(event: CustomEvent) => void} callback
     * @param {EventListenerOptions} [options]
     */
    off(name, callback, options) {
      target.removeEventListener(toDomEventName(name), /** @type {EventListener} */ (callback), options);
    },
  };
}
