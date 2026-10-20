/**
 * Canvas layer management: device-pixel-ratio aware sizing and theme reading.
 * Canvases are always viewport-sized; the time domain is never rasterised
 * as a whole.
 */

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createLayer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  const layer = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    dpr: 1,
    /**
     * @param {number} width CSS px
     * @param {number} height CSS px
     * @param {number} dpr
     * @returns {boolean} whether the backing store changed
     */
    resize(width, height, dpr) {
      width = Math.max(0, Math.floor(width));
      height = Math.max(0, Math.floor(height));
      dpr = Math.max(1, dpr || 1);
      const pw = Math.round(width * dpr);
      const ph = Math.round(height * dpr);
      const changed = canvas.width !== pw || canvas.height !== ph || layer.dpr !== dpr;
      if (changed) {
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      layer.width = width;
      layer.height = height;
      layer.dpr = dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return changed;
    },
    clear() {
      ctx.clearRect(0, 0, layer.width, layer.height);
    },
  };
  return layer;
}

/** @typedef {ReturnType<typeof createLayer>} Layer */

const THEME_VARS = /** @type {const} */ ([
  'bg',
  'axis-bg',
  'fg',
  'muted',
  'label-fg',
  'grid',
  'grid-major',
  'track-line',
  'accent',
  'selection',
  'focus',
  'hover',
  'today',
  'marquee',
  'preview',
  'font-family',
  'font-size',
  'global-range-alpha',
  'bar-radius',
]);

/**
 * @typedef {object} Theme
 * @property {string} bg
 * @property {string} axisBg
 * @property {string} fg
 * @property {string} muted
 * @property {string} labelFg
 * @property {string} grid
 * @property {string} gridMajor
 * @property {string} trackLine
 * @property {string} accent
 * @property {string} selection
 * @property {string} focus
 * @property {string} hover
 * @property {string} today
 * @property {string} marquee
 * @property {string} preview
 * @property {string} font
 * @property {number} fontSize
 * @property {number} globalRangeAlpha
 * @property {number} barRadius
 */

/**
 * Read the CSS custom properties that drive Canvas drawing.
 * @param {HTMLElement} root
 * @returns {Theme}
 */
export function readTheme(root) {
  const cs = getComputedStyle(root);
  /** @type {Record<string, string>} */
  const v = {};
  for (const name of THEME_VARS) v[name] = cs.getPropertyValue(`--tl-${name}`).trim();
  const fontSize = parseFloat(v['font-size']) || 12;
  return {
    bg: v.bg || '#2e3239',
    axisBg: v['axis-bg'] || v.bg || '#2a2e34',
    fg: v.fg || '#e8eaed',
    muted: v.muted || '#9aa0a6',
    labelFg: v['label-fg'] || '#f0a040',
    grid: v.grid || 'rgba(255,255,255,0.07)',
    gridMajor: v['grid-major'] || 'rgba(255,255,255,0.2)',
    trackLine: v['track-line'] || 'rgba(255,255,255,0.14)',
    accent: v.accent || '#e98200',
    selection: v.selection || '#ffffff',
    focus: v.focus || '#4da3ff',
    hover: v.hover || 'rgba(255,255,255,0.16)',
    today: v.today || '#ff6b6b',
    marquee: v.marquee || 'rgba(77,163,255,0.22)',
    preview: v.preview || 'rgba(255,255,255,0.35)',
    font: `${fontSize}px ${v['font-family'] || 'system-ui, sans-serif'}`,
    fontSize,
    globalRangeAlpha: parseFloat(v['global-range-alpha']) || 0.16,
    barRadius: parseFloat(v['bar-radius']) || 4,
  };
}
