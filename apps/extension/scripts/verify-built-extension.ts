import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.output/chrome-mv3',
);
const manifestPath = resolve(outputDirectory, 'manifest.json');

assert.ok(existsSync(manifestPath), `Missing built manifest: ${manifestPath}`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  chrome_url_overrides?: Record<string, string>;
  content_scripts?: unknown[];
  permissions?: string[];
};

assert.deepEqual(manifest.permissions, [
  'tabs',
  'storage',
  'contextMenus',
  'tabGroups',
  'search',
  'favicon',
]);
assert.ok(!('content_scripts' in manifest), 'Built manifest must not register content scripts');
assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'newtab.html' });
assert.ok(
  existsSync(resolve(outputDirectory, 'saved-history.html')),
  'Build must emit saved-history.html',
);
assert.ok(
  !existsSync(resolve(outputDirectory, 'history.html')),
  'Build must not emit the reserved history.html entrypoint',
);

console.log('Verified built Chrome manifest and saved-history entrypoint.');
