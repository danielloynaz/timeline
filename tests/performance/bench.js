/**
 * Browser-side benchmark harness. Every measurement calls `timeline.flush()`
 * so the full JS cost of a frame (index queries, Canvas drawing, label DOM)
 * is captured synchronously with `performance.now()`.
 */
import { Timeline } from '@danielloynaz/timeline';
import { hitTest } from '../../src/rendering/hit-testing.js';
import { generateDataset } from '../../examples/vanilla/data.js';

const START = Date.UTC(2026, 0, 1);
const END = Date.UTC(2026, 11, 31);

/** @param {number[]} samples */
function stats(samples) {
  const s = samples.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1], mean: s.reduce((a, b) => a + b, 0) / s.length };
}

const BENCH = {
  /** @type {Timeline | null} */
  timeline: null,
  /** @type {any} */
  data: null,

  /** Named dataset shapes used by the report. */
  shapes: {
    sparse: { tracks: 1000, intervals: 35_000, events: 15_000, maxDurationMs: 10 * 86_400_000 },
    dense: { tracks: 100, intervals: 35_000, events: 15_000, maxDurationMs: 2 * 86_400_000 },
    overlapping: { tracks: 50, intervals: 40_000, events: 10_000, maxDurationMs: 90 * 86_400_000 },
    sameTimestamp: { tracks: 200, intervals: 10_000, events: 40_000, maxDurationMs: 5 * 86_400_000, sameTimestamp: true },
  },

  /** @param {keyof BENCH['shapes']} shape */
  generate(shape) {
    const cfg = this.shapes[shape];
    const data = generateDataset({ ...cfg, start: START, end: END, seed: 7 });
    if (cfg.sameTimestamp) {
      const t = START + 100 * 86_400_000;
      for (let i = 0; i < data.events.length; i += 2) data.events[i].date = t;
    }
    this.data = data;
    return { tracks: data.tracks.length, intervals: data.intervals.length, events: data.events.length };
  },

  create() {
    this.destroy();
    const host = /** @type {HTMLElement} */ (document.querySelector('#host'));
    this.timeline = new Timeline(host, {
      startDate: START,
      endDate: END,
      editable: true,
      rowHeight: 28,
      labelWidth: 140,
      zoom: { initial: 'week', min: 'hour', max: 'year' },
    });
    return true;
  },

  destroy() {
    this.timeline?.destroy();
    this.timeline = null;
  },

  /** setData + first synchronous render. */
  initialRender() {
    const t = /** @type {Timeline} */ (this.timeline);
    const t0 = performance.now();
    t.setData(this.data);
    const t1 = performance.now();
    t.setViewport({ start: START + 60 * 86_400_000, end: START + 120 * 86_400_000 });
    t.flush();
    const t2 = performance.now();
    return { setDataMs: t1 - t0, firstRenderMs: t2 - t1, totalMs: t2 - t0 };
  },

  /** @param {number} frames */
  scroll(frames) {
    const t = /** @type {Timeline} */ (this.timeline);
    const samples = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      t.panByPixels(i % 2 ? 37 : -23);
      t.nodes.scroller.scrollTop = (i * 53) % Math.max(1, t.nodes.scroller.scrollHeight - t.nodes.scroller.clientHeight);
      t.flush();
      samples.push(performance.now() - t0);
    }
    return stats(samples);
  },

  /** @param {number} frames */
  zoom(frames) {
    const t = /** @type {Timeline} */ (this.timeline);
    const samples = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      t.zoom(i % 40 < 20 ? 1.08 : 1 / 1.08, 300 + (i % 7) * 50);
      t.flush();
      samples.push(performance.now() - t0);
    }
    return stats(samples);
  },

  /** @param {number} samplesCount */
  hover(samplesCount) {
    const t = /** @type {Timeline} */ (this.timeline);
    const samples = [];
    let hits = 0;
    const f = t.frame();
    for (let i = 0; i < samplesCount; i++) {
      const x = (i * 97) % f.width;
      const y = (i * 31) % f.height;
      const t0 = performance.now();
      const hit = hitTest(t.frame(), x, y, 4, { handles: true });
      samples.push(performance.now() - t0);
      if (hit.item) hits++;
    }
    return { ...stats(samples), hitRatio: hits / samplesCount };
  },

  /** Incremental updates: move 200 random intervals per update. @param {number} updates */
  updates(updates) {
    const t = /** @type {Timeline} */ (this.timeline);
    const samples = [];
    for (let u = 0; u < updates; u++) {
      const patch = [];
      for (let i = 0; i < 200; i++) {
        const src = this.data.intervals[(u * 200 + i * 7) % this.data.intervals.length];
        patch.push({ ...src, start: src.start + 3_600_000, end: src.end + 3_600_000 });
      }
      const t0 = performance.now();
      t.updateData({ intervals: patch });
      t.flush();
      samples.push(performance.now() - t0);
    }
    return stats(samples);
  },

  /** Simulated continuous drag of a visible interval. @param {number} frames */
  drag(frames) {
    const t = /** @type {Timeline} */ (this.timeline);
    const area = t.nodes.canvasArea;
    const r = area.getBoundingClientRect();
    const f = t.frame();
    // Find a visible interval to grab.
    let target = null;
    for (let row = f.geometry.firstRow; row <= f.geometry.lastRow && !target; row++) {
      const q = f.index.queryRow(f.rows[row].id, f.viewStart, f.viewEnd);
      if (q.intervals.length) target = { it: q.intervals[0], row };
    }
    if (!target) return { n: 0, p50: 0, p95: 0, max: 0, mean: 0, skipped: true };
    const x = Math.max(2, t.timeToX(Math.max(target.it.start, f.viewStart))) + 5;
    const y = target.row * 28 - f.geometry.scrollTop + 14;
    const common = { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    area.dispatchEvent(new PointerEvent('pointerdown', { ...common, clientX: r.left + x, clientY: r.top + y }));
    const samples = [];
    for (let i = 1; i <= frames; i++) {
      const t0 = performance.now();
      area.dispatchEvent(new PointerEvent('pointermove', { ...common, clientX: r.left + x + i * 2, clientY: r.top + y }));
      t.flush();
      samples.push(performance.now() - t0);
    }
    area.dispatchEvent(new PointerEvent('pointerup', { ...common, buttons: 0, clientX: r.left + x + frames * 2, clientY: r.top + y }));
    t.cancelEdit();
    return stats(samples);
  },

  /** Heap after N init/destroy cycles (requires --expose-gc). @param {number} cycles */
  async memoryCycle(cycles) {
    const gc = /** @type {any} */ (window).gc;
    const mem = () => /** @type {any} */ (performance).memory?.usedJSHeapSize ?? 0;
    const settle = async () => {
      gc?.();
      await new Promise((r) => setTimeout(r, 30));
      gc?.();
    };
    this.destroy();
    await settle();
    const baseline = mem();
    // Run the cycles in a separate function so no stack slot of this frame
    // can keep the last instances alive during conservative stack scanning.
    const refs = await this.runCycles(cycles);
    for (let i = 0; i < 3; i++) await settle();
    const after = mem();
    const survivors = refs.map((r, i) => (r.deref() === undefined ? -1 : i)).filter((i) => i >= 0);
    return { baselineMB: baseline / 1048576, afterMB: after / 1048576, deltaMB: (after - baseline) / 1048576, gcAvailable: typeof gc === 'function', collected: cycles - survivors.length, total: cycles, survivors };
  },

  /** @param {number} cycles */
  async runCycles(cycles) {
    /** @type {WeakRef<Timeline>[]} */
    const refs = [];
    for (let i = 0; i < cycles; i++) {
      this.create();
      const t = /** @type {Timeline} */ (this.timeline);
      t.setData(this.data);
      t.flush();
      refs.push(new WeakRef(t));
      this.destroy();
      await new Promise((r) => setTimeout(r, 0));
    }
    return refs;
  },

  env() {
    return { ua: navigator.userAgent, dpr: window.devicePixelRatio, cores: navigator.hardwareConcurrency, memoryGB: /** @type {any} */ (navigator).deviceMemory ?? null };
  },
};

// @ts-ignore
window.BENCH = BENCH;
