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
  action?: {
    default_popup?: unknown;
  };
  chrome_url_overrides?: Record<string, string>;
  content_scripts?: unknown[];
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  side_panel?: {
    default_path?: string;
  };
};

assert.equal(manifest.minimum_chrome_version, '114');
assert.deepEqual(manifest.permissions, [
  'tabs',
  'storage',
  'contextMenus',
  'tabGroups',
  'search',
  'favicon',
  'alarms',
  'sidePanel',
]);
assert.deepEqual(manifest.host_permissions, [
  'https://api.github.com/*',
  'https://gist.githubusercontent.com/*',
  'https://github.com/*',
]);
assert.ok(!manifest.permissions?.includes('identity'), 'Built manifest must not request identity');
assert.ok(!('content_scripts' in manifest), 'Built manifest must not register content scripts');
assert.ok(!manifest.action?.default_popup, 'Built manifest action must not declare a popup');
assert.deepEqual(manifest.chrome_url_overrides, { newtab: 'newtab.html' });
assert.deepEqual(manifest.side_panel, { default_path: 'sidepanel.html' });
assert.ok(
  existsSync(resolve(outputDirectory, 'sidepanel.html')),
  'Build must emit sidepanel.html',
);
assert.ok(
  !existsSync(resolve(outputDirectory, 'popup.html')),
  'Build must not emit popup.html',
);
assert.ok(
  existsSync(resolve(outputDirectory, 'saved-history.html')),
  'Build must emit saved-history.html',
);
assert.ok(
  !existsSync(resolve(outputDirectory, 'history.html')),
  'Build must not emit the reserved history.html entrypoint',
);

console.log('Verified built Chrome manifest, Side Panel, and saved-history entrypoint.');
