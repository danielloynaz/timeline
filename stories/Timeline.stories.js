import { mount, argTypes, referenceData, generateDataset } from './helpers.js';

export default {
  title: 'Timeline',
  argTypes,
  args: { theme: 'dark', rowHeight: 48, labelWidth: 150, barHeight: 8, showGrid: true, showTrackLines: true, editable: false, selectable: true, hideEmptyTracks: false, wheelZoom: 'ctrl', trackOrder: 'data', snap: null, cornerLabel: 'phone' },
};

const VIEW = { start: '2026-02-14T00:00:00Z', end: '2026-05-06T00:00:00Z' };

/** The reference screenshot, reproduced from data alone. */
export const Reference = {
  render: (args) => mount(args, referenceData, { viewport: VIEW, height: 300 }),
};

/** Pan, zoom and fit through the public API. Ctrl+wheel zooms around the pointer; Shift+wheel pans. */
export const Navigation = {
  render: (args) => {
    const wrapper = mount(args, referenceData, { viewport: VIEW, log: ['viewportChange'] });
    const t = wrapper.timeline;
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };
    btn('Zoom in', () => t.zoom('in'));
    btn('Zoom out', () => t.zoom('out'));
    for (const level of ['day', 'week', 'month', 'quarter']) btn(level, () => t.setZoom(level));
    btn('◀', () => t.pan('left'));
    btn('▶', () => t.pan('right'));
    btn('Fit to data', () => t.fitToData());
    btn('Go to April', () => t.setViewport({ start: '2026-04-01T00:00:00Z', end: '2026-05-01T00:00:00Z' }));
    wrapper.prepend(bar);
    return wrapper;
  },
};

/** Click, Ctrl+click, Shift+click, Shift+drag marquee, hover tooltips and keyboard focus (Tab into the timeline, then arrows). */
export const Selection = {
  render: (args) => mount(args, referenceData, { viewport: VIEW, log: ['selectionChange', 'rangeSelect', 'eventActivate', 'itemClick', 'hover'] }),
};

/** Transactional editing: drag bars to move, drag their ends to resize, drag on an empty row to create. The story acts as the host: it persists every commit after 600 ms (or rejects it when "Reject" is checked). */
export const Editing = {
  args: { editable: true, snap: '1d' },
  render: (args) => {
    const wrapper = mount(args, referenceData, { viewport: VIEW, log: ['intervalEditStart', 'intervalEditCommit', 'intervalEditCancel'] });
    const t = wrapper.timeline;
    const toggle = document.createElement('label');
    toggle.style.cssText = 'display:flex;gap:6px;align-items:center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    toggle.append(cb, document.createTextNode('Reject every commit (host validation fails)'));
    wrapper.prepend(toggle);
    t.on('intervalEditCommit', (e) => {
      const d = e.detail;
      setTimeout(() => {
        if (cb.checked) {
          t.rejectEdit(d.isNew ? d.tempId : d.intervalId);
          return;
        }
        const id = d.isNew ? `interval-${Date.now()}` : d.intervalId;
        t.updateData({
          intervals: [{ id, trackId: d.trackId, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), editable: true }],
          replaceIds: d.isNew ? { [d.tempId]: id } : undefined,
        });
      }, 600);
    });
    return wrapper;
  },
};

/** Light theme and CSS-variable theming. */
export const Themes = {
  args: { theme: 'light' },
  render: (args) => {
    const wrapper = mount(args, referenceData, { viewport: VIEW });
    const style = document.createElement('style');
    style.textContent = '.tl-root.custom { --tl-accent: #3b82f6; --tl-label-fg: #1d4ed8; --tl-bar-radius: 0px; }';
    wrapper.prepend(style);
    const b = document.createElement('button');
    b.textContent = 'Toggle custom palette (--tl-accent)';
    b.addEventListener('click', () => wrapper.timeline.element.classList.toggle('custom'));
    wrapper.prepend(b);
    return wrapper;
  },
};

/** Global range events, diamond markers, per-track colours, hidden tracks and unknown track references (see the console for dataError). */
export const DataModel = {
  render: (args) => {
    const data = {
      tracks: [
        { id: 'a', label: 'Alpha', color: '#60a5fa' },
        { id: 'b', label: 'Beta', order: -1 },
        { id: 'c', label: 'Hidden', visible: false },
        { id: 'd', label: 'Delta (not editable)', editable: false },
      ],
      intervals: [
        { id: 'i1', trackId: 'a', start: '2026-03-01T00:00:00Z', end: '2026-03-12T00:00:00Z', label: 'Planning' },
        { id: 'i2', trackId: 'a', start: '2026-03-08T00:00:00Z', end: '2026-03-20T00:00:00Z', label: 'Overlapping' },
        { id: 'i3', trackId: 'b', start: '2026-01-10T00:00:00Z', end: '2026-02-20T00:00:00Z', label: 'Starts before the domain' },
        { id: 'i4', trackId: 'ghost', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' },
      ],
      events: [
        { id: 'e1', trackId: 'b', date: '2026-03-05T00:00:00Z', type: 'alert', marker: 'diamond', color: '#f87171' },
        { id: 'e2', trackId: 'b', date: '2026-03-15T00:00:00Z', type: 'call', marker: 'line' },
        { id: 'e3', trackId: 'd', date: '2026-03-25T00:00:00Z', type: 'sms' },
        { id: 'g1', scope: 'global', start: '2026-03-21T00:00:00Z', end: '2026-03-28T00:00:00Z', type: 'maintenance', label: 'Maintenance window' },
        { id: 'g2', scope: 'global', date: '2026-04-02T00:00:00Z', type: 'release', marker: 'diamond', color: '#34d399' },
      ],
    };
    const wrapper = mount({ ...args, cornerLabel: 'Resources' }, null, { viewport: { start: '2026-02-20T00:00:00Z', end: '2026-04-20T00:00:00Z' }, log: ['dataError'] });
    wrapper.timeline.setData(data);
    return wrapper;
  },
};

/** 1,000 tracks and 50,000 items generated on the fly. Scroll, zoom and hover stay interactive; see tests/performance/results.md for measured numbers. */
export const Performance = {
  args: { rowHeight: 28, editable: true, cornerLabel: '1,000 tracks' },
  render: (args) => {
    const wrapper = mount(args, null, { height: 420, log: ['hover'] });
    const t0 = performance.now();
    const data = generateDataset({ tracks: 1000, intervals: 35_000, events: 15_000, start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 5, 30), seed: 3 });
    wrapper.timeline.setData(data);
    wrapper.timeline.flush();
    const note = document.createElement('div');
    note.textContent = `generate + setData + first render: ${(performance.now() - t0).toFixed(0)} ms`;
    wrapper.prepend(note);
    return wrapper;
  },
};
