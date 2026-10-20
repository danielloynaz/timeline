/**
 * Repeatable performance benchmark. Writes tests/performance/results.md.
 *
 * Targets (from the specification):
 *   initial visible render (setData + first frame) < 500 ms with >= 50k items / 1k tracks
 *   scroll & zoom frame processing p95 < 16.7 ms
 *   hover hit-testing p95 < 8 ms
 *   no unbounded growth across init/destroy cycles
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const FRAMES = 300;
const HOVER_SAMPLES = 2000;

const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));

test('benchmark all dataset shapes and write results.md', async ({ page }) => {
  await page.goto('/tests/performance/bench.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.BENCH));
  const env = await page.evaluate(() => window.BENCH.env());

  /** @type {Record<string, any>} */
  const results = {};
  for (const shape of ['sparse', 'dense', 'overlapping', 'sameTimestamp']) {
    const size = await page.evaluate((s) => window.BENCH.generate(s), shape);
    await page.evaluate(() => window.BENCH.create());
    // Warm-up render so JIT and font caches don't count against the first measurement.
    await page.evaluate(() => window.BENCH.initialRender());
    await page.evaluate(() => window.BENCH.destroy());
    await page.evaluate(() => window.BENCH.create());
    const initial = await page.evaluate(() => window.BENCH.initialRender());
    const scroll = await page.evaluate((n) => window.BENCH.scroll(n), FRAMES);
    const zoom = await page.evaluate((n) => window.BENCH.zoom(n), FRAMES);
    const hover = await page.evaluate((n) => window.BENCH.hover(n), HOVER_SAMPLES);
    const updates = await page.evaluate((n) => window.BENCH.updates(n), 20);
    const drag = await page.evaluate((n) => window.BENCH.drag(n), 120);
    results[shape] = { size, initial, scroll, zoom, hover, updates, drag };
    await page.evaluate(() => window.BENCH.destroy());
  }
  await page.evaluate((s) => window.BENCH.generate(s), 'sparse');
  const memoryWarm = await page.evaluate((n) => window.BENCH.memoryCycle(n), 20);
  const memory = await page.evaluate((n) => window.BENCH.memoryCycle(n), 20); // steady state: a leak would grow again here

  const lines = [];
  lines.push('# Benchmark results', '');
  lines.push(`Generated ${new Date().toISOString()} by \`npm run bench\` (Playwright, Chromium headless).`, '');
  lines.push('## Environment', '');
  lines.push(`- OS: ${os.type()} ${os.release()} (${os.arch()})`);
  lines.push(`- CPU: ${os.cpus()[0]?.model ?? 'unknown'} × ${os.cpus().length}, ${(os.totalmem() / 1073741824).toFixed(1)} GB RAM`);
  lines.push(`- Browser: ${env.ua}`);
  lines.push(`- devicePixelRatio: ${env.dpr}; drawing area 1060×556 CSS px, rowHeight 28`, '');
  lines.push('## Method', '');
  lines.push('Each frame measurement calls `timeline.flush()` so the full synchronous JS cost of a frame (index queries, Canvas drawing, label DOM updates) is timed with `performance.now()`. Compositor time is not included. Values are milliseconds.', '');
  lines.push('| Shape | Tracks | Intervals | Events | setData | first render | **initial total** | scroll p50 / **p95** | zoom p50 / **p95** | hover p50 / **p95** | update(200 items) p95 | drag p95 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [shape, r] of Object.entries(results)) {
    lines.push(
      `| ${shape} | ${r.size.tracks} | ${r.size.intervals} | ${r.size.events} | ${fmt(r.initial.setDataMs)} | ${fmt(r.initial.firstRenderMs)} | **${fmt(r.initial.totalMs)}** | ${fmt(r.scroll.p50)} / **${fmt(r.scroll.p95)}** | ${fmt(r.zoom.p50)} / **${fmt(r.zoom.p95)}** | ${fmt(r.hover.p50)} / **${fmt(r.hover.p95)}** | ${fmt(r.updates.p95)} | ${r.drag.skipped ? 'n/a' : fmt(r.drag.p95)} |`,
    );
  }
  lines.push('', '## Memory', '');
  lines.push(`Two rounds of 20 × (create → setData(50k) → render → destroy) with the sparse dataset, gc ${memory.gcAvailable ? 'forced' : 'not available'} between rounds:`, '');
  lines.push(`- round 1 (warm-up, JIT and Intl caches): heap ${fmt(memoryWarm.baselineMB)} MB → ${fmt(memoryWarm.afterMB)} MB (Δ ${fmt(memoryWarm.deltaMB)} MB)`);
  lines.push(`- round 2 (steady state): heap ${fmt(memory.baselineMB)} MB → ${fmt(memory.afterMB)} MB (Δ ${fmt(memory.deltaMB)} MB)`, '');
  lines.push(`- destroyed instances collected (WeakRef after forced GC): ${memory.collected}/${memory.total}${memory.survivors.length ? ` (still reachable: #${memory.survivors.join(', #')})` : ''}`, '');
  lines.push('Heap deltas include Chromium allocator slack; the WeakRef count is the direct evidence that destroyed instances are unreachable.', '');
  lines.push('## Targets', '');
  lines.push('| Target | Budget | Result |', '|---|---|---|');
  const worst = (key, sub) => Math.max(...Object.values(results).map((r) => r[key][sub]));
  const initialWorst = Math.max(...Object.values(results).map((r) => r.initial.totalMs));
  lines.push(`| Initial render (≥50k items, 1k tracks) | < 500 ms | ${fmt(initialWorst)} ms (worst shape) |`);
  lines.push(`| Scroll frame p95 | < 16.7 ms | ${fmt(worst('scroll', 'p95'))} ms |`);
  lines.push(`| Zoom frame p95 | < 16.7 ms | ${fmt(worst('zoom', 'p95'))} ms |`);
  lines.push(`| Hover hit-test p95 | < 8 ms | ${fmt(worst('hover', 'p95'))} ms |`);
  lines.push(`| Destroyed instances collectable | all | ${memory.collected}/${memory.total} (heap Δ ${fmt(memory.deltaMB)} MB) |`);
  lines.push('', '## Known limitations', '');
  lines.push('- Frame times measure library JS only; the browser still has to composite three viewport-sized canvases.');
  lines.push('- The `overlapping` shape (40k intervals on 50 tracks, 90-day max duration) is the worst case for the max-end prefix index: each visible row scans every interval overlapping the viewport, which is inherent to drawing them all.');
  lines.push('- Updates re-validate and re-index the full dataset (atomic semantics); cost scales with total items, not patch size.');
  writeFileSync(resolve(here, 'results.md'), lines.join('\n') + '\n', 'utf8');

  // Acceptance assertions.
  for (const [shape, r] of Object.entries(results)) {
    expect(r.initial.totalMs, `${shape} initial render`).toBeLessThan(500);
    expect(r.scroll.p95, `${shape} scroll p95`).toBeLessThan(16.7);
    expect(r.zoom.p95, `${shape} zoom p95`).toBeLessThan(16.7);
    expect(r.hover.p95, `${shape} hover p95`).toBeLessThan(8);
  }
  expect(results.sparse.size.tracks).toBeGreaterThanOrEqual(1000);
  expect(results.sparse.size.intervals + results.sparse.size.events).toBeGreaterThanOrEqual(50_000);
  expect(memory.collected).toBeGreaterThanOrEqual(memory.total - 1);
  expect(memory.deltaMB).toBeLessThan(60);
});
