/**
 * Idempotent stylesheet injection. Uses constructable stylesheets when the
 * document supports them, otherwise a single `<style data-tl-styles>` tag.
 * Safe to call once per Timeline instance; the stylesheet is shared.
 */

import { TIMELINE_CSS } from '../styles/timeline.css.js';

const STYLE_ATTR = 'data-tl-styles';
/** @type {WeakMap<Document | ShadowRoot, CSSStyleSheet>} */
const adopted = new WeakMap();

/**
 * @param {Document | ShadowRoot} root
 * @param {string} [css]
 */
export function ensureStyles(root, css = TIMELINE_CSS) {
  if (adopted.has(root)) return;
  const supportsAdopted = 'adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype;
  if (supportsAdopted) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      adopted.set(root, sheet);
      return;
    } catch {
      // fall through to <style>
    }
  }
  const doc = root instanceof Document ? root : root.ownerDocument;
  const host = root instanceof Document ? root.head : root;
  if (host.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = css;
  host.appendChild(style);
}
