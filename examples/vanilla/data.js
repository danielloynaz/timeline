/** Data reproducing reference/timeline-reference.png through configuration only. */
export const referenceData = {
  tracks: [
    { id: 'phone-1', label: '9373064574' },
    { id: 'phone-2', label: '7575859695' },
    { id: 'phone-3', label: '9378312462' },
  ],
  intervals: [
    { id: 'interval-1', trackId: 'phone-3', start: '2026-03-02T00:00:00Z', end: '2026-03-04T00:00:00Z', editable: true, metadata: { category: 'activity' } },
    { id: 'interval-2', trackId: 'phone-3', start: '2026-03-05T12:00:00Z', end: '2026-03-11T00:00:00Z', editable: true, metadata: { category: 'activity' } },
    { id: 'interval-3', trackId: 'phone-3', start: '2026-04-02T00:00:00Z', end: '2026-05-02T00:00:00Z', editable: true, metadata: { category: 'activity' } },
  ],
  events: [
    { id: 'event-1', date: '2026-03-02T00:00:00Z', scope: 'global', type: 'activity', marker: 'diamond', label: 'Case opened' },
    { id: 'event-2', date: '2026-04-20T00:00:00Z', trackId: 'phone-2', type: 'call', marker: 'dot', label: 'Incoming call' },
    { id: 'event-3', date: '2026-04-20T00:00:00Z', scope: 'global', type: 'alert', marker: 'line', label: 'Alert' },
  ],
};

/**
 * Deterministic synthetic dataset for benchmarks and the demo.
 * @param {{ tracks: number, intervals: number, events: number, start: number, end: number, seed?: number, maxDurationMs?: number }} cfg
 */
export function generateDataset({ tracks, intervals, events, start, end, seed = 1, maxDurationMs = 10 * 86_400_000 }) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const span = end - start;
  const colors = ['#e98200', '#f0a040', '#ffb86b', '#d4741a'];
  const data = { tracks: [], intervals: [], events: [] };
  for (let i = 0; i < tracks; i++) data.tracks.push({ id: `t${i}`, label: String(9000000000 + Math.floor(rnd() * 999999999)) });
  for (let i = 0; i < intervals; i++) {
    const st = start + Math.floor(rnd() * span);
    const dur = 3_600_000 + Math.floor(rnd() * maxDurationMs);
    data.intervals.push({ id: `i${i}`, trackId: `t${Math.floor(rnd() * tracks)}`, start: st, end: st + dur, color: colors[i % colors.length], editable: true });
  }
  const markers = ['dot', 'line', 'diamond'];
  for (let i = 0; i < events; i++) {
    const global = rnd() < 0.002;
    data.events.push({
      id: `e${i}`,
      date: start + Math.floor(rnd() * span),
      scope: global ? 'global' : 'track',
      trackId: global ? undefined : `t${Math.floor(rnd() * tracks)}`,
      type: ['call', 'sms', 'alert'][i % 3],
      marker: markers[i % 3],
    });
  }
  return data;
}
