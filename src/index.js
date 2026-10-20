/**
 * @danielloynaz/timeline public entry point.
 *
 * Importing this module performs no DOM or window access, so it is safe to
 * import in server-side rendering environments; browser APIs are only touched
 * when a `Timeline` is constructed.
 */
export { Timeline } from './timeline.js';
export { TimelineError, ErrorCodes } from './core/errors.js';
export { EVENTS } from './core/emitter.js';
export { ZOOM_PRESETS } from './core/viewport.js';
export { DEFAULT_OPTIONS } from './core/validation.js';
export { TIMELINE_CSS } from './styles/timeline.css.js';
