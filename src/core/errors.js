/**
 * Error codes thrown or reported by the timeline.
 * @readonly
 * @enum {string}
 */
export const ErrorCodes = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  UNSUPPORTED_ENVIRONMENT: 'UNSUPPORTED_ENVIRONMENT',
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  INVALID_RANGE: 'INVALID_RANGE',
  DUPLICATE_ID: 'DUPLICATE_ID',
  UNKNOWN_TRACK: 'UNKNOWN_TRACK',
  UNKNOWN_ID: 'UNKNOWN_ID',
  DESTROYED: 'DESTROYED',
  INVALID_OPERATION: 'INVALID_OPERATION',
});

/**
 * Error type used for every failure raised by the library.
 * `code` is stable and documented; `details` carries the offending items.
 */
export class TimelineError extends Error {
  /**
   * @param {string} code One of {@link ErrorCodes}.
   * @param {string} message Human readable, actionable description.
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TimelineError';
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {never}
 */
export function fail(code, message, details) {
  throw new TimelineError(code, message, details);
}
