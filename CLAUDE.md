# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@danielloynaz/timeline`: a framework-independent horizontal timeline component (tracks, interval bars, event markers) in **pure JavaScript ES modules with JSDoc types**. Canvas 2D draws the data; HTML provides labels, tooltips, scrollbar and accessibility. Zero runtime dependencies. It is consumed by an Angular 21 app but must never contain Angular/React/Vue code. Behaviour is modelled on Cambridge Intelligence KronoGraph; the visual target is `reference/timeline-reference.png`.

## Commands

```bash
npm run dev                                   # vanilla demo (Vite) at http://localhost:5173
npm test                                      # Vitest unit tests (Node environment, tests/unit)
npx vitest run tests/unit/tz.test.js          # one unit file
npm run test:e2e                              # Playwright integration suite (Chromium, 1 worker, starts its own Vite server on :4173)
npx playwright test tests/integration/editing.spec.js   # one spec
npx playwright test --project=chromium -g "marquee"     # tests matching a title
npm run bench                                 # performance benchmark → tests/performance/results.md (asserts the budgets)
npm run lint && npm run typecheck             # ESLint flat config; tsc --checkJs over src/ (JSDoc is the type source)
npm run build                                 # dist/timeline.js (ESM) + dist/timeline.css + dist/types/*.d.ts
npm run storybook / npm run build-storybook   # live docs (stories/, html-vite)
node scripts/screenshot.mjs out.png [url]     # screenshot the demo (needs a server on :4173: `npx vite --config vite.test.config.js --port 4173`)
```

Playwright serves the repo root through `vite.test.config.js` (HMR off) so `/tests/integration/fixtures/index.html` and `/tests/performance/bench.html` load `src/` directly via the `@danielloynaz/timeline` alias. The dev server occasionally stalls a navigation; the config keeps `retries: 1` for that.

## Architecture

Three strictly layered groups under `src/`; the first is DOM-free and unit-tested in Node.

1. **`core/` (pure)** — `time-scale.js` is the single transform `x = origin + (t - start) * pxPerMs`; rendering, hit-testing and editing all import it. `viewport.js` holds immutable, clamped viewport state (domain bounds, zoom presets in px/day). `tz.js` computes calendar boundaries in an IANA zone with `Intl` only (DST-safe). `ticks.js` picks a tick level from pixel density. `validation.js` normalizes options and data (atomic; returns `orphans` for unknown-track items instead of throwing). `data-index.js` builds per-track sorted indexes (start-sorted + running max-end prefix for O(log n + k) overlap queries) and `computeTrackRows`. `emitter.js` maps camelCase names to `timeline:kebab-case` CustomEvents.
2. **`rendering/`** — `layers.js` (viewport-sized canvases, DPR, `readTheme` pulls `--tl-*` CSS variables so Canvas colours follow CSS), `axis-renderer.js`, `data-renderer.js` (paint order: global bands → grid → track lines → bars → track markers → global lines → today; consumes `index.queryRow`, the seam for a future heatmap), `overlay-renderer.js` (hover/selection/focus/previews/marquee), `hit-testing.js` (documented priority: handle › track event › latest-start interval › global marker › band › row).
3. **`interaction/` + `dom/`** — `pointer-controller.js` resolves a pointerdown into marquee / resize / move / create / pan and throttles hover to rAF; `interval-editor.js` is the transactional state machine (`idle → previewing → pending`; **never mutates data**, host applies via `updateData`/`rejectEdit`); `selection-controller.js`, `keyboard-controller.js`, `hscroll-controller.js`; `dom/layout.js` builds the one `.tl-root` the library owns, `labels.js` virtualizes label nodes, `a11y.js` maintains the offscreen listbox + `aria-activedescendant`, `styles.js` injects `styles/timeline.css.js` once.

`timeline.js` is the facade: it owns options, raw + normalized data, the index, viewport state, the dirty-flag/rAF render scheduler (`frame()` snapshots everything renderers need; `flush()` renders synchronously for tests), and wires the controllers with an `AbortController` so `destroy()` removes every listener.

## Invariants to keep

- Caller data objects are never mutated; `setData`/`updateData` validate the whole set before swapping state. Unknown `trackId` → `dataError` event, not an exception.
- One lane per track today; `index.laneOf`/`laneCount` are the reserved seams for stacking. No heatmap in v1 (deliberate).
- Interval and event IDs share one namespace (selection); track IDs are separate. IDs are compared as strings.
- The domain (`startDate`/`endDate`) never changes; zoom/pan only move the viewport and it never shows more than the domain.
- `src/index.js` must stay importable without `window` (SSR test in `tests/unit/ssr.test.js`); browser APIs are touched only in the constructor.
- `styles/timeline.css.js` is the only stylesheet source; `scripts/emit-css.js` derives `dist/timeline.css` from it.
- Plain wheel scrolls tracks natively; zoom is Ctrl/⌘+wheel unless `wheelZoom: 'always'`.

## Conventions

- JS only in `src/`; types via JSDoc, `ReturnType<typeof import('./x.js').fn>` for inferred factory types. `tsconfig.build.json` emits declarations.
- Tests: pure logic → `tests/unit` (Vitest); anything touching Canvas/pointer/DOM → `tests/integration` using the fixture's `window.TL` helpers (`create`, `barCenter`, `pixel`, `eventsOf`). `page.mouse.click` ignores modifiers: use `clickAt`/`drag` from `tests/integration/helpers.js`.
- Public API changes must be reflected in `docs/API.md` (rendered inside Storybook via `stories/API.mdx`).
