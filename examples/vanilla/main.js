import { Timeline } from '@itech/timeline';
import { referenceData, generateDataset } from './data.js';

const log = document.querySelector('#log');
/** @param {string} line */
function print(line) {
  log.textContent = `${line}\n${log.textContent}`.split('\n').slice(0, 60).join('\n');
}

const container = document.querySelector('#timeline');
let theme = 'dark';

const timeline = new Timeline(container, {
  startDate: '2026-02-01T00:00:00Z',
  endDate: '2026-06-30T23:59:59Z',
  theme,
  editable: true,
  selectable: true,
  showToday: false,
  locale: 'en-US',
  timeZone: 'UTC',
  rowHeight: 48,
  labelWidth: 150,
  barHeight: 8,
  snap: '1d',
  zoom: { initial: 'week', min: 'day', max: 'quarter' },
});

timeline.setData(referenceData);
timeline.setViewport({ start: '2026-02-14T00:00:00Z', end: '2026-05-06T00:00:00Z' });

for (const name of ['selectionChange', 'eventActivate', 'viewportChange', 'intervalEditStart', 'intervalEditCommit', 'intervalEditCancel', 'rangeSelect', 'dataError', 'itemClick', 'itemDoubleClick']) {
  timeline.on(name, (e) => {
    const d = { ...e.detail };
    delete d.timestamp;
    delete d.originalEvent;
    for (const k of ['start', 'end', 'time', 'domainStart', 'domainEnd']) if (typeof d[k] === 'number') d[k] = new Date(d[k]).toISOString();
    print(`${name} ${JSON.stringify(d)}`);
  });
}

// Host-side persistence: accept every commit and apply it as authoritative data.
timeline.on('intervalEditCommit', (e) => {
  const d = e.detail;
  const interval = { id: d.isNew ? `interval-${Date.now()}` : d.intervalId, trackId: d.trackId, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), editable: true };
  timeline.updateData({ intervals: [interval], replaceIds: d.isNew ? { [d.tempId]: interval.id } : undefined });
});

document.querySelector('#zoom-in').addEventListener('click', () => timeline.zoom('in'));
document.querySelector('#zoom-out').addEventListener('click', () => timeline.zoom('out'));
document.querySelector('#pan-left').addEventListener('click', () => timeline.pan('left'));
document.querySelector('#pan-right').addEventListener('click', () => timeline.pan('right'));
document.querySelector('#fit').addEventListener('click', () => timeline.fitToData());
document.querySelector('#zoom-level').addEventListener('change', (e) => timeline.setZoom(e.target.value));
timeline.on('viewportChange', (e) => {
  document.querySelector('#zoom-level').value = e.detail.zoom;
});
document.querySelector('#theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  timeline.element.setAttribute('data-tl-theme', theme);
  timeline.flush?.();
});
document.querySelector('#big').addEventListener('click', () => {
  const t0 = performance.now();
  const data = generateDataset({ tracks: 1000, intervals: 35000, events: 15000, start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 5, 30) });
  timeline.setData(data);
  timeline.flush();
  print(`setData + first render: ${(performance.now() - t0).toFixed(1)} ms`);
});

window.timeline = timeline;
