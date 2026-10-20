/**
 * Default stylesheet. Kept as a JS string so the library can inject it at
 * runtime (no bundler configuration needed by hosts) while the build also
 * emits it as `dist/timeline.css` for hosts that prefer an explicit import.
 *
 * Every colour and metric is a CSS custom property on `.tl-root`, so hosts
 * can theme the component (Canvas layers read these variables at draw time).
 */
export const TIMELINE_CSS = String.raw`
.tl-root {
  --tl-bg: #2e3239;
  --tl-axis-bg: #2a2e34;
  --tl-fg: #e8eaed;
  --tl-muted: #9aa0a6;
  --tl-label-fg: #f0a040;
  --tl-grid: rgba(255, 255, 255, 0.07);
  --tl-grid-major: rgba(255, 255, 255, 0.2);
  --tl-track-line: rgba(255, 255, 255, 0.14);
  --tl-accent: #e98200;
  --tl-selection: #ffffff;
  --tl-focus: #4da3ff;
  --tl-hover: rgba(255, 255, 255, 0.16);
  --tl-today: #ff6b6b;
  --tl-global-range-alpha: 0.16;
  --tl-marquee: rgba(77, 163, 255, 0.22);
  --tl-preview: rgba(255, 255, 255, 0.35);
  --tl-tooltip-bg: #1f2227;
  --tl-tooltip-fg: #e8eaed;
  --tl-scrollbar: rgba(255, 255, 255, 0.25);
  --tl-scrollbar-track: rgba(255, 255, 255, 0.05);
  --tl-font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --tl-font-size: 12px;
  --tl-label-font-size: 13px;
  --tl-bar-radius: 4px;

  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: var(--tl-label-width, 160px) minmax(0, 1fr);
  grid-template-rows: var(--tl-axis-height, 44px) minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  min-height: 120px;
  overflow: hidden;
  background: var(--tl-bg);
  color: var(--tl-fg);
  font-family: var(--tl-font-family);
  font-size: var(--tl-font-size);
  user-select: none;
  -webkit-user-select: none;
}
.tl-root[data-tl-theme="light"] {
  --tl-bg: #ffffff;
  --tl-axis-bg: #f6f7f9;
  --tl-fg: #1f2328;
  --tl-muted: #656d76;
  --tl-label-fg: #b35c00;
  --tl-grid: rgba(0, 0, 0, 0.06);
  --tl-grid-major: rgba(0, 0, 0, 0.18);
  --tl-track-line: rgba(0, 0, 0, 0.12);
  --tl-selection: #1f2328;
  --tl-hover: rgba(0, 0, 0, 0.12);
  --tl-preview: rgba(0, 0, 0, 0.3);
  --tl-tooltip-bg: #1f2328;
  --tl-tooltip-fg: #ffffff;
  --tl-scrollbar: rgba(0, 0, 0, 0.3);
  --tl-scrollbar-track: rgba(0, 0, 0, 0.05);
}
.tl-root * { box-sizing: border-box; }
.tl-root[data-tl-compact="true"] { grid-template-rows: 0px minmax(0, 1fr) auto; }
.tl-root[data-tl-compact="true"] .tl-axis, .tl-root[data-tl-compact="true"] .tl-corner { visibility: hidden; }

.tl-corner {
  grid-column: 1; grid-row: 1;
  display: flex; align-items: flex-end; padding: 0 10px 6px;
  background: var(--tl-axis-bg);
  color: var(--tl-fg); font-weight: 600; font-size: var(--tl-label-font-size);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.tl-axis { grid-column: 2; grid-row: 1; position: relative; overflow: hidden; background: var(--tl-axis-bg); }
.tl-axis canvas { display: block; position: absolute; inset: 0; }

.tl-scroller {
  grid-column: 1 / span 2; grid-row: 2;
  position: relative; overflow-x: hidden; overflow-y: auto;
  outline: none;
  scrollbar-width: thin;
  scrollbar-color: var(--tl-scrollbar) var(--tl-scrollbar-track);
}
.tl-scroller:focus-visible { box-shadow: inset 0 0 0 2px var(--tl-focus); }
.tl-spacer { position: absolute; top: 0; left: 0; width: 1px; pointer-events: none; }
.tl-sticky {
  position: sticky; top: 0; height: 100%;
  display: grid; grid-template-columns: var(--tl-label-width, 160px) minmax(0, 1fr);
}
.tl-labels { position: relative; overflow: hidden; border-right: 1px solid var(--tl-grid-major); }
.tl-label {
  position: absolute; left: 0; right: 0; height: var(--tl-row-height, 32px);
  display: flex; align-items: center; justify-content: flex-end; padding: 0 10px;
  color: var(--tl-label-fg); font-size: var(--tl-label-font-size);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.tl-label[data-tl-selected="true"] { color: var(--tl-fg); font-weight: 600; }
.tl-canvas-area { position: relative; overflow: hidden; }
.tl-canvas-area canvas { display: block; position: absolute; inset: 0; }
.tl-canvas-area[data-tl-cursor="grab"] { cursor: grab; }
.tl-canvas-area[data-tl-cursor="grabbing"] { cursor: grabbing; }
.tl-canvas-area[data-tl-cursor="pointer"] { cursor: pointer; }
.tl-canvas-area[data-tl-cursor="ew-resize"] { cursor: ew-resize; }
.tl-canvas-area[data-tl-cursor="move"] { cursor: move; }
.tl-canvas-area[data-tl-cursor="crosshair"] { cursor: crosshair; }

.tl-hscroll {
  grid-column: 2; grid-row: 3; position: relative; height: 10px;
  background: var(--tl-scrollbar-track); cursor: pointer;
}
.tl-hscroll-thumb {
  position: absolute; top: 2px; height: 6px; border-radius: 3px;
  background: var(--tl-scrollbar); min-width: 16px; cursor: grab;
}
.tl-hscroll-thumb:active { cursor: grabbing; }

.tl-tooltip {
  position: absolute; z-index: 2; pointer-events: none;
  max-width: 320px; padding: 8px 10px; border-radius: 6px;
  background: var(--tl-tooltip-bg); color: var(--tl-tooltip-fg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-size: var(--tl-font-size); line-height: 1.4;
  opacity: 0; transition: opacity 80ms linear;
}
.tl-tooltip[data-tl-visible="true"] { opacity: 1; }
.tl-tooltip-title { font-weight: 600; margin-bottom: 2px; }
.tl-tooltip-row { display: flex; gap: 8px; justify-content: space-between; }
.tl-tooltip-row span:first-child { color: var(--tl-muted); }

.tl-a11y {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
`;
