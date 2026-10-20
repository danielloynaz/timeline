// Writes dist/timeline.css from the single CSS source of truth (src/styles/timeline.css.js).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMELINE_CSS } from '../src/styles/timeline.css.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../dist/timeline.css');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, TIMELINE_CSS.trimStart(), 'utf8');
console.log(`wrote ${out}`);
