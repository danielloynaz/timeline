# @danielloynaz/timeline

[![CI](https://github.com/danielloynaz/timeline/actions/workflows/ci.yml/badge.svg)](https://github.com/danielloynaz/timeline/actions/workflows/ci.yml)

A reusable, high-performance horizontal timeline component in pure JavaScript. Tracks with fixed labels on the left, a date axis on top, Canvas-rendered interval bars and event markers, interactive navigation, selection, filtering and transactional interval editing. Works in plain HTML and embeds in Angular, React, Vue or anything else without a wrapper.

- Zero runtime dependencies, ES modules, ES2022.
- Canvas 2D for data (tens of thousands of items), HTML for labels, tooltips, controls and accessibility.
- Continuous time scale: x is proportional to elapsed time, with one shared transformation for rendering, hit-testing and editing.
- Behaviour modelled on KronoGraph: pan/zoom/fit, marquee range selection, hover/click/context events, global markers, dark theme.

## Install and use

The package is published to GitHub Packages under the `@danielloynaz` scope. Point npm at that registry for the scope once, then install:

```bash
echo "@danielloynaz:registry=https://npm.pkg.github.com" >> .npmrc
npm install @danielloynaz/timeline
```

Or consume the repository directly without a registry: `npm install github:danielloynaz/timeline` (runs `npm run build` on install via `prepare`), or clone it and reference it with `"@danielloynaz/timeline": "file:../timeline"`.

```html
<div id="timeline" style="height: 360px"></div>
<script type="module">
  import { Timeline } from '@danielloynaz/timeline';

  const timeline = new Timeline(document.querySelector('#timeline'), {
    startDate: '2026-03-01T00:00:00Z',
    endDate: '2026-05-31T23:59:59Z',
    theme: 'dark',
    editable: true,
    zoom: { initial: 'week', min: 'day', max: 'quarter' },
  });

  timeline.setData({
    tracks: [{ id: 'phone-1', label: '9373064574' }],
    intervals: [{ id: 'i1', trackId: 'phone-1', start: '2026-03-20T00:00:00Z', end: '2026-03-27T00:00:00Z' }],
    events: [{ id: 'e1', date: '2026-03-16T00:00:00Z', scope: 'global', marker: 'line' }],
  });

  timeline.on('selectionChange', (e) => console.log(e.detail.ids));
  timeline.on('intervalEditCommit', (e) => {
    // persist e.detail, then hand the authoritative data back:
    timeline.updateData({ intervals: [{ id: e.detail.intervalId, trackId: e.detail.trackId, start: e.detail.start, end: e.detail.end }] });
  });
</script>
```

Full contract, options, events, theming and Angular usage: [docs/API.md](docs/API.md). Live, interactive documentation: `npm run storybook`.

## Development

```bash
npm install
npm run dev              # vanilla demo at http://localhost:5173
npm test                 # unit tests (Vitest, Node)
npm run test:e2e         # browser integration tests (Playwright, Chromium)
npm run bench            # performance benchmark → tests/performance/results.md
npm run lint && npm run typecheck
npm run build            # dist/timeline.js, dist/timeline.css, dist/types/
npm run storybook        # live docs
```

Run one unit test file with `npx vitest run tests/unit/tz.test.js`; one integration spec with `npx playwright test tests/integration/editing.spec.js`.

## Project layout

```
src/
  index.js                 public entry (SSR-safe: no DOM access at import)
  timeline.js              Timeline facade: lifecycle, data, viewport, render scheduling
  core/                    DOM-free engine: time-scale, tz, ticks, viewport, validation, data-index, snapping, format, emitter, errors
  rendering/               Canvas layers, axis/data/overlay renderers, hit-testing
  interaction/             pointer, keyboard, selection, interval editor, horizontal scrollbar
  dom/                     layout, virtualized labels, tooltip, accessibility, style injection
  styles/timeline.css.js   stylesheet (CSS variables) as the single source for injection and dist/timeline.css
tests/unit                 Vitest
tests/integration          Playwright specs + fixture page
tests/performance          benchmark harness, spec and results.md
examples/vanilla           plain HTML demo reproducing reference/timeline-reference.png
stories/                   Storybook (html-vite)
docs/API.md                API documentation
```

## Status

Measured on the reference machine (see `tests/performance/results.md` for the full report): initial render of 50,000 items on 1,000 tracks in under 50 ms, scroll and zoom frames under 6 ms at p95, hover hit-testing under 1 ms, and every destroyed instance collectable. Unit (Vitest), browser integration (Playwright) and benchmark suites all pass.

Known limitations and deliberate scope decisions for this version:

- One lane per track: overlapping intervals draw in the same row (later start on top). Sub-row stacking is a reserved seam (`laneOf`/`laneCount` in the data index), not implemented.
- No density heatmap when zoomed out; markers are always drawn individually (clipped and coalesced where they overlap).
- Canvas only; the optional SVG render mode is not implemented and `renderMode: 'svg'` throws.
- Interval creation is drag-only (no double-click), and moves are horizontal only (an interval cannot be dragged to another track).
- `updateData` re-validates and re-indexes the whole data set to keep atomic semantics; its cost grows with total items, not with patch size (≈50 ms for 50k items).
- Plain mouse wheel scrolls tracks; zooming needs Ctrl/⌘+wheel (or `wheelZoom: 'always'`).

## Distribution

The package is ESM-only. `package.json` targets GitHub Packages (`publishConfig.registry`); publishing needs a token with `write:packages` (`npm login --registry=https://npm.pkg.github.com`). For a tarball use `npm pack`. Source: https://github.com/danielloynaz/timeline

## License

UNLICENSED (private).
