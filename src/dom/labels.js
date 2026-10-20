/**
 * Virtualized label column: one DOM node per *visible* row, reused across
 * scrolls. Keyed by row index so nodes are only re-textured when the track in
 * that row changes.
 */

/**
 * @param {HTMLElement} host
 */
export function createLabelColumn(host) {
  /** @type {Map<number, HTMLElement>} */
  const nodes = new Map();

  return {
    /**
     * @param {object} frame
     * @param {import('../core/validation.js').NormalizedTrack[]} frame.rows
     * @param {number} frame.firstRow
     * @param {number} frame.lastRow inclusive
     * @param {number} frame.rowHeight
     * @param {number} frame.scrollTop
     * @param {string | null} frame.selectedTrackId
     */
    render({ rows, firstRow, lastRow, rowHeight, scrollTop, selectedTrackId }) {
      for (const [row, node] of nodes) {
        if (row < firstRow || row > lastRow) {
          node.remove();
          nodes.delete(row);
        }
      }
      for (let row = firstRow; row <= lastRow; row++) {
        const track = rows[row];
        if (!track) continue;
        let node = nodes.get(row);
        if (!node) {
          node = host.ownerDocument.createElement('div');
          node.className = 'tl-label';
          host.appendChild(node);
          nodes.set(row, node);
        }
        if (node.dataset.trackId !== track.id) {
          node.dataset.trackId = track.id;
          node.textContent = track.label;
          node.title = track.label;
          if (track.color) node.style.color = track.color;
          else node.style.removeProperty('color');
        }
        node.dataset.tlSelected = String(track.id === selectedTrackId);
        node.style.transform = `translateY(${row * rowHeight - scrollTop}px)`;
      }
    },
    clear() {
      for (const node of nodes.values()) node.remove();
      nodes.clear();
    },
  };
}
