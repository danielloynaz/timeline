# @itech/timeline API

Framework-independent, Canvas-based horizontal timeline. Pure JavaScript (ES2022, ES modules), zero runtime dependencies. TypeScript declarations ship in `dist/types`.

```js
import { Timeline } from '@itech/timeline';

const timeline = new Timeline(document.querySelector('#timeline'), {
  startDate: '2026-03-01T00:00:00Z',
  endDate: '2026-05-31T23:59:59Z',
  editable: true,
});
timeline.setData({ tracks, intervals, events });
```

The container must have a height (the component fills it). The library appends exactly one `.tl-root` element and removes it on `destroy()`.

## Contents

- [Options](#options)
- [Data model](#data-model)
- [Methods](#methods)
- [Events](#events)
- [Interaction reference](#interaction-reference)
- [Editing lifecycle](#editing-lifecycle)
- [Time semantics](#time-semantics)
- [Theming](#theming)
- [Errors and validation policy](#errors-and-validation-policy)
- [Accessibility](#accessibility)
- [Framework integration](#framework-integration)

## Options

The constructor throws `TimelineError` with code `INVALID_CONFIG` for any invalid value. All options are frozen after construction and exposed as `timeline.options` (with `domainStart`/`domainEnd` resolved to epoch ms).

| Option | Type | Default | Description |
|---|---|---|---|
| `startDate` **required** | ISO string, number, Date | | Start of the navigable time domain. |
| `endDate` **required** | ISO string, number, Date | | End of the domain; must be after `startDate`. |
| `theme` | `'dark' \| 'light'` | `'dark'` | Initial theme (`data-tl-theme` attribute on the root; can be changed at runtime). |
| `renderMode` | `'canvas'` | `'canvas'` | Only Canvas is implemented; `'svg'` throws. |
| `editable` | boolean | `false` | Enable interval editing (create, move, resize). |
| `selectable` | boolean | `true` | Enable selection. |
| `multiSelect` | boolean | `true` | Allow Ctrl/Shift multi-selection. |
| `showGrid` | boolean | `true` | Vertical grid lines at tick positions. |
| `showToday` | boolean | `true` | Dashed line at the current time when visible. |
| `showTrackLines` | boolean | `true` | Dotted horizontal line per track row. |
| `showAxis` | boolean | `true` | Draw the date axis. |
| `locale` | string | browser default | BCP 47 locale for all labels (`Intl`). |
| `timeZone` | string | `'UTC'` | IANA zone used for tick boundaries and label formatting. |
| `rowHeight` | number px | `32` | Height of a track row. |
| `labelWidth` | number px | `160` | Width of the fixed label column. |
| `axisHeight` | number px | `44` | Height of the date axis. |
| `barHeight` | number px | `8` | Interval bar thickness (≤ `rowHeight`). |
| `markerSize` | number px | `6` | Event marker size. |
| `zoom.initial` | preset name | `'week'` | Initial scale. |
| `zoom.min` | preset name | `'day'` | Finest allowed scale (most zoomed in). |
| `zoom.max` | preset name | `'quarter'` | Coarsest allowed scale (most zoomed out). |
| `zoom.presets` | `Record<string, pxPerDay>` | `{ hour: 1440, day: 60, week: 12, month: 3, quarter: 1, year: 0.25 }` | Preset anchors in pixels per day; merge your own. |
| `zoom.wheelFactor` | number > 1 | `1.1` | Zoom per 50 px of wheel delta. |
| `zoom.stepFactor` | number > 1 | `1.5` | Factor used by `zoom('in'|'out')` and `+`/`-`. |
| `wheelZoom` | `'ctrl' \| 'always'` | `'ctrl'` | `'ctrl'`: Ctrl/⌘+wheel (and trackpad pinch) zooms, plain wheel scrolls tracks. `'always'`: any wheel zooms. |
| `snap` | `null`, ms, or `'15m' \| '1h' \| '1d' \| '1w'` | `null` | Snapping increment for editing, anchored at local midnight. |
| `hideEmptyTracks` | boolean | `false` | Hide tracks with no items in the visible range. |
| `trackOrder` | `'data' \| 'label' \| 'firstEvent' \| 'lastEvent' \| (a, b) => number` | `'data'` | Row order. `'data'` respects `track.order`, then array order. |
| `compactHeight` | number px | `150` | Below this container height the axis is hidden. |
| `injectStyles` | boolean | `true` | Inject the default stylesheet once per document (or shadow root). |
| `weekStartsOn` | 0–6 | `1` | First day of week for weekly ticks (1 = Monday). |
| `formats` | `Record<string, Intl.DateTimeFormatOptions>` | `{}` | Override label formats: `time`, `dateTime`, `date`, `dayOfMonth`, `monthYear`, `monthShort`, `year`, `full`. |
| `ariaLabel` | string | `'Timeline'` | Accessible name of the component. |
| `minTickSpacing` | number px | `48` | Minimum distance between minor ticks (drives level selection). |
| `hitTolerance` | number px | `4` | Pointer tolerance for markers and resize handles. |
| `tooltips` | boolean | `true` | Built-in tooltips. Disable to build your own from the `hover` event. |
| `cornerLabel` | string \| null | `null` | Text shown above the label column (e.g. a group name). |

## Data model

All timestamps accept ISO 8601 strings, epoch milliseconds or `Date` objects. Internally everything is epoch ms. Caller objects are never mutated; the library keeps its own normalized copies and a `source` reference.

### Tracks

```js
{ id: 'phone-1', label: '9373064574', order: 1, visible: true, editable: true, color: '#e98200', metadata: {} }
```

- `id` (required) string or number, unique among tracks.
- `label` defaults to the id.
- `order` numeric sort key for `trackOrder: 'data'`; defaults to array index.
- `visible: false` hides the track and everything on it (items stay in the data).
- `editable: false` disallows creating intervals on, or moving/resizing intervals of, this track.
- `color` default colour for the track's items.

### Intervals

```js
{ id: 'i1', trackId: 'phone-3', start: '2026-03-20T00:00:00Z', end: '2026-03-27T00:00:00Z', label, color, editable, metadata }
```

- `start` must be strictly earlier than `end`.
- Intervals may overlap; they are drawn in one lane per track, later starts on top.
- Intervals outside or partially outside the domain are kept and clipped at draw time.

### Events

```js
{ id: 'e1', date: '2026-03-16T00:00:00Z', scope: 'track', trackId: 'phone-2', type: 'call', marker: 'dot', label, color, metadata }
{ id: 'g1', date: '2026-03-16T00:00:00Z', scope: 'global', marker: 'line' }
{ id: 'g2', start: '2026-04-20T00:00:00Z', end: '2026-04-25T00:00:00Z', scope: 'global' }
```

- `scope` is `'track'` (needs `trackId`) or `'global'`; omitted scope is inferred from `trackId`.
- `marker`: `'dot'` (default), `'line'` or `'diamond'`. Shapes differ so type is not conveyed by colour alone.
- Global point events draw a line across all rows with the marker at the top. Global events may instead carry `start`/`end`: they render as a translucent band behind the data. Track events must use `date`.
- `type` defaults to `'default'`; filter with `setFilters({ eventTypes })`.

### ID rules

Track IDs are unique among tracks. Interval and event IDs share a single namespace (selection addresses both) and must be unique within it. IDs are compared as strings (`1` and `'1'` collide).

## Methods

| Method | Description |
|---|---|
| `setData(data)` | Replace tracks, intervals and events atomically. Throws on structural errors without touching current data; emits `dataError` for items referencing unknown tracks (they are excluded from display). Clears pending edits. |
| `updateData(patch)` | Incremental change: `{ tracks?, intervals?, events?, remove?: { tracks?, intervals?, events? }, replaceIds?: { tempId: finalId } }`. Upserts by id. The merged data set is validated as a whole before being applied. Resolves pending edits whose id (or renamed id) is present. |
| `getData()` | Shallow copies of the caller-supplied arrays currently held. |
| `setFilters(filters)` / `getFilters()` | `{ tracks?: string[] \| (track) => boolean, intervals?: (interval) => boolean, events?: (event) => boolean, eventTypes?: string[] }`. `null` clears. Selection is reconciled. |
| `setViewport({ start, end })` | Show a range (clamped to the domain and zoom bounds). |
| `getViewport()` | `{ start, end, pxPerMs, zoom, domainStart, domainEnd, width }` (ms, nearest preset name). |
| `setZoom(level)` | Jump to a preset, keeping the centre. |
| `zoom('in' \| 'out' \| factor, anchorX?)` | Multiply the scale; keeps the time under `anchorX` (data-area px) or the centre fixed. |
| `pan('left' \| 'right' \| ms)` | Pan by a quarter of the visible range or by milliseconds. |
| `fitToData()` | Fit the extent of the current (filtered) data, with 2 % padding, within the bounds. |
| `setSelection(ids, { primary? })` / `getSelection()` | Programmatic selection (no event). Returns `{ ids, primaryId }`. |
| `rejectEdit(id)` | Drop a committed-but-pending edit (interval id or temp id) and restore the original. |
| `cancelEdit()` | Abort an in-progress edit gesture. |
| `getPendingEdits()` | IDs of intervals whose committed edit awaits host data. |
| `on(name, cb)` / `off(name, cb)` | Subscribe to library events (camelCase, kebab or `timeline:`-prefixed names). |
| `destroy()` | Release listeners, observers, frames and Canvas resources, remove the root element. Idempotent; further calls to other methods throw `DESTROYED`. |
| `flush()` | Synchronously perform pending rendering (tests, benchmarks). |
| `timeToX(time)` / `rowOf(trackId)` | Geometry helpers for host overlays (data-area px; row index or -1). |
| `element` | The root element (event target). |
| `options` | Normalized configuration. |

## Events

One event system: the root element dispatches bubbling native `CustomEvent`s named `timeline:<kebab-case>`; `on()`/`off()` are `addEventListener`/`removeEventListener` with name mapping. The payload is always `event.detail` and includes `type` (camelCase name) and `timestamp`.

| `on()` name | DOM type | `detail` |
|---|---|---|
| `selectionChange` | `timeline:selection-change` | `{ ids: string[], primaryId: string \| null }`. Emitted for user-driven changes and when a data/filter change drops selected ids. Not emitted by `setSelection`. |
| `eventActivate` | `timeline:event-activate` | `{ id, kind: 'interval' \| 'event', trackId, source: 'pointer' \| 'keyboard' }` on double-click or Enter. |
| `viewportChange` | `timeline:viewport-change` | Same shape as `getViewport()`. Emitted on every change, including container resizes. |
| `intervalEditStart` | `timeline:interval-edit-start` | Edit payload (below). |
| `intervalEditPreview` | `timeline:interval-edit-preview` | Edit payload on every pointer move. |
| `intervalEditCommit` | `timeline:interval-edit-commit` | Edit payload; the proposal the host should validate and persist. |
| `intervalEditCancel` | `timeline:interval-edit-cancel` | Edit payload plus `reason`: `escape`, `pointercancel`, `blur`, `unchanged`, `invalid`, `rejected`, `interval-removed`, `data-replaced`, `destroyed`, `api`. |
| `rangeSelect` | `timeline:range-select` | `{ start, end, modifiers }` after a Shift+drag or right-drag marquee. |
| `hover` | `timeline:hover` | `{ ids, kind, trackId, time, x, y }`; `ids: []` when leaving an item. |
| `itemClick` / `itemDoubleClick` | `timeline:item-click` / `timeline:item-double-click` | `{ ids, kind, trackId, time, x, y, modifiers, originalEvent }`. `kind` is `'track'` for empty row clicks. |
| `contextMenu` | `timeline:context-menu` | Same as `itemClick`; **cancelable**: `event.preventDefault()` suppresses the native menu. |
| `dataError` | `timeline:data-error` | `{ code: 'UNKNOWN_TRACK', message, intervals: [{ id, trackId, source }], events: [...] }`. |
| `destroy` | `timeline:destroy` | Emitted before teardown. |

Edit payload: `{ operation: 'create' \| 'move' \| 'resize-start' \| 'resize-end', intervalId: string \| null, tempId: string \| null, isNew, trackId, start, end, original: { start, end } \| null, valid, reason }`.

## Interaction reference

Pointer-down resolution on the data area, first match wins:

1. Right button, or Shift+left → **range marquee** → `rangeSelect`.
2. Left on a resize handle of an editable interval (within `hitTolerance` of an edge) → **resize**.
3. Left on an editable interval → **move**.
4. Left on an empty row of an editable track, after a 3 px drag → **create**.
5. Otherwise a drag **pans** (horizontally and vertically); a click selects (`itemClick`).

Hit-testing priority when items overlap: resize handle › track event marker › interval with the latest start (drawn on top) › global point marker › global range band › empty track.

Selection: click replaces, Ctrl/⌘+click toggles, Shift+click adds, click on empty clears (not with Ctrl).

Wheel: see `wheelZoom`. Shift+wheel or horizontal wheel delta pans. Plain vertical wheel scrolls tracks natively.

Keyboard (while the component has focus): `←`/`→` previous/next item on the track, `↑`/`↓` nearest item on the adjacent track, `Home`/`End`, `Shift+←/→` pan 10 %, `+`/`-` zoom, `Space` toggle selection, `Enter` select + `eventActivate`, `Escape` cancel edit/gesture or clear focus. Unhandled keys are never prevented.

## Editing lifecycle

```
idle ──begin──▶ previewing ──pointer up──▶ pending ──host data / rejectEdit──▶ idle
                    └──── Escape / pointercancel / blur / destroy ────▶ idle
```

1. `intervalEditStart` is emitted with the original interval preserved in `original`.
2. The proposal is drawn on the overlay (snapped if `snap` is set) and `intervalEditPreview` fires on each move. The original bar is hidden while a preview exists.
3. The proposal is validated locally: positive duration, inside the domain, track exists and is editable.
4. On release, `intervalEditCommit` is emitted. **Data is not changed.** The preview stays, dashed, as *pending*.
5. The host validates and persists, then calls `updateData` (or `setData`). For new intervals the payload has `tempId` (`tmp-<n>`); pass `replaceIds: { [tempId]: finalId }` with the real interval.
6. When the applied data contains the id, the pending preview disappears without flicker. To refuse, call `rejectEdit(id)`: the original is shown again and `intervalEditCancel` fires with `reason: 'rejected'`.

```js
timeline.on('intervalEditCommit', async (e) => {
  const d = e.detail;
  try {
    const saved = await api.save({ id: d.isNew ? undefined : d.intervalId, trackId: d.trackId, start: d.start, end: d.end });
    timeline.updateData({ intervals: [saved], replaceIds: d.isNew ? { [d.tempId]: saved.id } : undefined });
  } catch {
    timeline.rejectEdit(d.isNew ? d.tempId : d.intervalId);
  }
});
```

## Time semantics

- Internal representation: epoch milliseconds (UTC). The x axis is strictly proportional to elapsed time: `x = (t - viewportStart) * pxPerMs`. One implementation (`core/time-scale.js`) serves rendering, hit-testing and editing.
- `timeZone` only affects where calendar boundaries fall (midnight, week, month starts) and how labels read. A day spanning a DST change is 23 or 25 hours wide.
- `startDate`/`endDate` define the navigable domain and never change; zoom and pan move the viewport inside it. The viewport never shows more than the domain, so the coarsest reachable zoom may be finer than `zoom.max` on short domains.
- Presets are anchors in pixels per day. Wheel zoom moves continuously between them; `getViewport().zoom` reports the nearest preset.
- Ticks adapt to density: minutes → hours → days → weeks → months → quarters → years, grouped by the next larger unit (e.g. weekly ticks with day numbers under month spans at the default `week` preset).

## Theming

Everything visual is a CSS custom property on `.tl-root`; Canvas layers read them at draw time, so overriding variables restyles the whole component. Switch themes with `timeline.element.setAttribute('data-tl-theme', 'light')`.

```css
.tl-root { --tl-accent: #3b82f6; --tl-bg: #0f172a; --tl-row-height: 40px; }
```

Key variables: `--tl-bg`, `--tl-axis-bg`, `--tl-fg`, `--tl-muted`, `--tl-label-fg`, `--tl-grid`, `--tl-grid-major`, `--tl-track-line`, `--tl-accent`, `--tl-selection`, `--tl-focus`, `--tl-hover`, `--tl-today`, `--tl-marquee`, `--tl-preview`, `--tl-tooltip-bg`, `--tl-tooltip-fg`, `--tl-font-family`, `--tl-font-size`, `--tl-label-font-size`, `--tl-bar-radius`, `--tl-global-range-alpha`.

Styles are injected once per document via `adoptedStyleSheets` (fallback `<style data-tl-styles>`). Set `injectStyles: false` and import `@itech/timeline/timeline.css` to manage them yourself.

## Errors and validation policy

All failures are `TimelineError` instances with a stable `code` and `details`:

| Code | When |
|---|---|
| `INVALID_CONFIG` | Bad container or option (constructor, `setZoom`). |
| `UNSUPPORTED_ENVIRONMENT` | No `window`/`document`, `ResizeObserver`, `PointerEvent` or Canvas 2D. |
| `MISSING_FIELD`, `INVALID_TYPE`, `INVALID_TIMESTAMP`, `INVALID_RANGE`, `DUPLICATE_ID` | Structural data errors in `setData`/`updateData`: thrown, nothing applied. |
| `UNKNOWN_ID` | `rejectEdit` for an id with no pending edit. |
| `DESTROYED` | Method call after `destroy()`. |
| `INVALID_OPERATION` | Reserved. |

Unknown `trackId` references are **not** structural errors: the affected items are excluded from the index and reported through `dataError` (code `UNKNOWN_TRACK`) so the rest of the data still renders.

The module can be imported in server-side rendering environments; browser APIs are touched only in the constructor.

## Accessibility

- The scroll container is a focusable `role="application"` with an `aria-label`, `aria-description` (track and item counts plus key hints) and a visible focus ring.
- An offscreen `role="listbox"` holds one `role="option"` per item in the viewport (bounded to 400) with a textual description (label, track, dates, duration, metadata). `aria-activedescendant` tracks the keyboard-focused item and a polite live region announces it.
- Marker shapes (dot, line, diamond) distinguish event kinds without colour; selection, hover and focus use distinct outlines.
- High-density displays are handled by sizing Canvas backing stores by `devicePixelRatio` and reacting to DPR changes.

## Framework integration

### Plain HTML

```html
<div id="timeline" style="height: 360px"></div>
<script type="module">
  import { Timeline } from './node_modules/@itech/timeline/dist/timeline.js';
  const timeline = new Timeline(document.querySelector('#timeline'), { startDate: '2026-03-01', endDate: '2026-05-31' });
  timeline.setData({ tracks: [{ id: 'a', label: 'A' }], intervals: [{ id: 'i', trackId: 'a', start: '2026-03-02', end: '2026-03-09' }] });
</script>
```

### Angular (no wrapper)

```ts
import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { Timeline } from '@itech/timeline';

@Component({ selector: 'app-timeline', standalone: true, template: `<div #host class="timeline-host"></div>` })
export class TimelineComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;
  private timeline?: Timeline;

  constructor(private zone: NgZone) {}

  ngAfterViewInit() {
    // Pointer/scroll handlers fire at animation-frame rate: keep them outside Angular's zone.
    this.zone.runOutsideAngular(() => {
      this.timeline = new Timeline(this.host.nativeElement, { startDate: '2026-03-01', endDate: '2026-05-31', editable: true });
      this.timeline.on('intervalEditCommit', (e) => this.zone.run(() => this.save(e.detail)));
    });
  }

  ngOnDestroy() {
    this.timeline?.destroy();
  }
}
```

Nothing Angular-specific is required: the component is a plain class operating on a DOM element, events are native `CustomEvent`s, and styles are injected automatically (or add `node_modules/@itech/timeline/dist/timeline.css` to `angular.json` with `injectStyles: false`).

### Distribution

`npm run build` emits `dist/timeline.js` (ESM), `dist/timeline.css` and `dist/types/`. Publish to a private registry by adding `publishConfig.registry` to `package.json`, or consume locally with `npm pack` / `"@itech/timeline": "file:../timeline"`.
