import { Timeline } from '@itech/timeline';
import { referenceData, generateDataset } from '../examples/vanilla/data.js';

export { referenceData, generateDataset };

/**
 * Mount a Timeline into a fresh host element sized for the canvas.
 * Returns the host; the instance is available as `host.timeline`.
 * @param {object} options
 * @param {object | null} data
 * @param {{ height?: number, viewport?: { start: string, end: string }, log?: string[] }} [extra]
 */
export function mount(options, data, extra = {}) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;font:12px system-ui;color:#9aa0a6';
  const host = document.createElement('div');
  host.style.cssText = `height:${extra.height ?? 320}px;border:1px solid #333;border-radius:6px;overflow:hidden;`;
  wrapper.appendChild(host);

  const log = document.createElement('pre');
  log.style.cssText = 'margin:0;height:110px;overflow:auto;background:#15171b;border-radius:6px;padding:8px;white-space:pre-wrap;font:11px/1.5 ui-monospace,monospace';
  log.textContent = 'events…';
  if (extra.log) wrapper.appendChild(log);

  const timeline = new Timeline(host, {
    startDate: '2026-02-01T00:00:00Z',
    endDate: '2026-06-30T23:59:59Z',
    locale: 'en-US',
    timeZone: 'UTC',
    showToday: false,
    rowHeight: 44,
    labelWidth: 150,
    ...options,
  });
  if (data) timeline.setData(data);
  if (extra.viewport) timeline.setViewport(extra.viewport);
  for (const name of extra.log ?? []) {
    timeline.on(name, (e) => {
      const d = { ...e.detail };
      delete d.originalEvent;
      delete d.timestamp;
      for (const k of ['start', 'end', 'time']) if (typeof d[k] === 'number') d[k] = new Date(d[k]).toISOString();
      log.textContent = `${name} ${JSON.stringify(d)}\n${log.textContent}`.split('\n').slice(0, 40).join('\n');
    });
  }
  /** @type {any} */ (wrapper).timeline = timeline;
  return wrapper;
}

/** Controls shared by most stories. */
export const argTypes = {
  theme: { control: 'radio', options: ['dark', 'light'] },
  rowHeight: { control: { type: 'range', min: 20, max: 80, step: 2 } },
  labelWidth: { control: { type: 'range', min: 80, max: 300, step: 10 } },
  barHeight: { control: { type: 'range', min: 2, max: 24, step: 1 } },
  showGrid: { control: 'boolean' },
  showTrackLines: { control: 'boolean' },
  editable: { control: 'boolean' },
  selectable: { control: 'boolean' },
  hideEmptyTracks: { control: 'boolean' },
  wheelZoom: { control: 'radio', options: ['ctrl', 'always'] },
  trackOrder: { control: 'select', options: ['data', 'label', 'firstEvent', 'lastEvent'] },
  snap: { control: 'select', options: [null, '1h', '6h', '1d', '1w'] },
  cornerLabel: { control: 'text' },
};
