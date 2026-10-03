// Copies the orb's static assets next to the compiled main process. tsc only
// emits JavaScript, so the HTML, CSS, and renderer script must be placed in the
// build output by hand.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'desktop', 'preload');
const target = join(root, 'dist-desktop', 'desktop', 'preload');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`orb assets copied to ${target}`);
