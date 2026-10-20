/**
 * Tooltip positioned inside the library root. Stays visible while the pointer
 * moves within the same item (no flicker), and is clamped to the container.
 */

/**
 * @param {HTMLElement} node tooltip element
 * @param {HTMLElement} bounds element whose box clamps the tooltip
 */
export function createTooltip(node, bounds) {
  /** @type {string | null} */
  let currentId = null;

  return {
    get currentId() {
      return currentId;
    },
    /**
     * @param {string} id item id (used to suppress rebuilds while hovering the same item)
     * @param {Array<{ label?: string, value: string, title?: boolean }>} rows
     * @param {number} x relative to `bounds`
     * @param {number} y relative to `bounds`
     */
    show(id, rows, x, y) {
      if (id !== currentId) {
        currentId = id;
        node.replaceChildren();
        for (const r of rows) {
          const line = node.ownerDocument.createElement('div');
          if (r.title) {
            line.className = 'tl-tooltip-title';
            line.textContent = r.value;
          } else {
            line.className = 'tl-tooltip-row';
            const k = node.ownerDocument.createElement('span');
            k.textContent = r.label ?? '';
            const v = node.ownerDocument.createElement('span');
            v.textContent = r.value;
            line.append(k, v);
          }
          node.appendChild(line);
        }
      }
      node.dataset.tlVisible = 'true';
      this.move(x, y);
    },
    /**
     * @param {number} x
     * @param {number} y
     */
    move(x, y) {
      const bw = bounds.clientWidth;
      const bh = bounds.clientHeight;
      const tw = node.offsetWidth;
      const th = node.offsetHeight;
      let left = x + 14;
      let top = y + 14;
      if (left + tw > bw - 4) left = Math.max(4, x - tw - 10);
      if (top + th > bh - 4) top = Math.max(4, y - th - 10);
      node.style.left = `${Math.round(left)}px`;
      node.style.top = `${Math.round(top)}px`;
    },
    hide() {
      if (currentId === null && node.dataset.tlVisible !== 'true') return;
      currentId = null;
      node.dataset.tlVisible = 'false';
    },
  };
}

/**
 * Build tooltip rows for an item.
 * @param {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent} item
 * @param {import('../core/validation.js').NormalizedTrack | null | undefined} track
 * @param {ReturnType<typeof import('../core/format.js').createFormatter>} fmt
 */
export function describeItem(item, track, fmt) {
  /** @type {Array<{ label?: string, value: string, title?: boolean }>} */
  const rows = [];
  if (item.kind === 'interval') {
    rows.push({ title: true, value: item.label ?? item.id });
    if (track) rows.push({ label: 'Track', value: track.label });
    rows.push({ label: 'Start', value: fmt.format(item.start, 'full') });
    rows.push({ label: 'End', value: fmt.format(item.end, 'full') });
    rows.push({ label: 'Duration', value: fmt.duration(item.end - item.start) });
  } else {
    rows.push({ title: true, value: item.label ?? item.type });
    rows.push({ label: 'Type', value: item.type });
    if (item.isRange) {
      rows.push({ label: 'Start', value: fmt.format(item.start, 'full') });
      rows.push({ label: 'End', value: fmt.format(item.end, 'full') });
    } else rows.push({ label: 'Date', value: fmt.format(item.time, 'full') });
    if (track && item.scope === 'track') rows.push({ label: 'Track', value: track.label });
    if (item.scope === 'global') rows.push({ label: 'Scope', value: 'Global' });
  }
  for (const [k, v] of Object.entries(item.metadata)) {
    if (v === null || v === undefined) continue;
    rows.push({ label: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) });
  }
  return rows;
}

/**
 * Plain-text description for assistive technology.
 * @param {import('../core/validation.js').NormalizedInterval | import('../core/validation.js').NormalizedEvent} item
 * @param {import('../core/validation.js').NormalizedTrack | null | undefined} track
 * @param {ReturnType<typeof import('../core/format.js').createFormatter>} fmt
 */
export function describeItemText(item, track, fmt) {
  return describeItem(item, track, fmt)
    .map((r) => (r.title ? r.value : `${r.label}: ${r.value}`))
    .join(', ');
}
