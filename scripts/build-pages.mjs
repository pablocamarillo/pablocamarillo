import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateSnapshot } from './contributions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const snapshot = JSON.parse(await readFile(resolve(root, 'data/contributions.json'), 'utf8'));
validateSnapshot(snapshot);
// An explicit allowlist prevents repository files or credentials entering Pages.
await mkdir(resolve(root, '_site/data'), { recursive: true });
for (const name of ['index.html', 'calendar.css', 'calendar.js', '.nojekyll']) {
  await copyFile(resolve(root, 'docs', name), resolve(root, '_site', name));
}
await copyFile(resolve(root, 'data/contributions.json'), resolve(root, '_site/data/contributions.json'));
console.log(`Built _site with ${snapshot.days.length} verified days and ${snapshot.total} contributions.`);
