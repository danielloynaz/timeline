# Benchmark results

Generated 2026-10-20T17:55:20.212Z by `npm run bench` (Playwright, Chromium headless).

## Environment

- OS: Windows_NT 10.0.19045 (x64)
- CPU: Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz × 12, 15.9 GB RAM
- Browser: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.4 Safari/537.36
- devicePixelRatio: 1; drawing area 1060×556 CSS px, rowHeight 28

## Method

Each frame measurement calls `timeline.flush()` so the full synchronous JS cost of a frame (index queries, Canvas drawing, label DOM updates) is timed with `performance.now()`. Compositor time is not included. Values are milliseconds.

| Shape | Tracks | Intervals | Events | setData | first render | **initial total** | scroll p50 / **p95** | zoom p50 / **p95** | hover p50 / **p95** | update(200 items) p95 | drag p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sparse | 1000 | 35000 | 15000 | 32.80 | 6.00 | **38.80** | 0.70 / **0.80** | 0.30 / **0.40** | 0.00 / **0.00** | 48.20 | 0.10 |
| dense | 100 | 35000 | 15000 | 23.10 | 8.00 | **31.10** | 1.70 / **2.40** | 0.80 / **1.50** | 0.00 / **0.00** | 43.50 | 0.10 |
| overlapping | 50 | 40000 | 10000 | 26.10 | 11.50 | **37.60** | 4.50 / **5.30** | 2.90 / **4.10** | 0.00 / **0.10** | 59.60 | 0.10 |
| sameTimestamp | 200 | 10000 | 40000 | 29.20 | 6.80 | **36.00** | 0.90 / **2.20** | 0.40 / **0.50** | 0.00 / **0.00** | 37.50 | 0.40 |

## Memory

Two rounds of 20 × (create → setData(50k) → render → destroy) with the sparse dataset, gc forced between rounds:

- round 1 (warm-up, JIT and Intl caches): heap 9.30 MB → 9.38 MB (Δ 0.08 MB)
- round 2 (steady state): heap 9.38 MB → 9.39 MB (Δ 0.01 MB)

- destroyed instances collected (WeakRef after forced GC): 20/20

Heap deltas include Chromium allocator slack; the WeakRef count is the direct evidence that destroyed instances are unreachable.

## Targets

| Target | Budget | Result |
|---|---|---|
| Initial render (≥50k items, 1k tracks) | < 500 ms | 38.80 ms (worst shape) |
| Scroll frame p95 | < 16.7 ms | 5.30 ms |
| Zoom frame p95 | < 16.7 ms | 4.10 ms |
| Hover hit-test p95 | < 8 ms | 0.10 ms |
| Destroyed instances collectable | all | 20/20 (heap Δ 0.01 MB) |

## Known limitations

- Frame times measure library JS only; the browser still has to composite three viewport-sized canvases.
- The `overlapping` shape (40k intervals on 50 tracks, 90-day max duration) is the worst case for the max-end prefix index: each visible row scans every interval overlapping the viewport, which is inherent to drawing them all.
- Updates re-validate and re-index the full dataset (atomic semantics); cost scales with total items, not patch size.
