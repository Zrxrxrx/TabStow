# Tabstow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial Tabstow Chrome MV3 extension prototype with local tab-session stowing, restoration, settings, context menu support, and fully usable manual GitHub Gist push/pull.

**Architecture:** Use a Bun workspace with `apps/extension` for the WXT/React extension runtime and `packages/core` for runtime-neutral domain schemas and pure helpers. Keep Chrome APIs, Dexie, WXT storage, fetch, and React UI inside the extension package; keep Zod validation and merge/export helpers in core.

**Tech Stack:** Bun workspaces, WXT, React, TypeScript, Chrome Manifest V3, Dexie/IndexedDB, WXT storage, Zod, Vitest, lucide-react.

## Global Constraints

- Use Bun for package management and scripts in this project.
- Do not use pnpm, npm, npx, or package-manager scaffolding commands from other ecosystems.
- Use `Tabstow` exactly in user-facing copy.
- Use package names such as `@tabstow/core`.
- Chrome extension runtime code must not use Bun-only APIs.
- Chrome extension runtime code must avoid Node-only APIs.
- Manifest permissions must stay minimal: `tabs`, `storage`, `contextMenus`.
- Host permissions must be limited to `https://api.github.com/*` and `https://gist.githubusercontent.com/*`.
- Do not add a content script for the MVP.
- Do not use `eval`, `new Function`, remote executable code, or CDN-loaded scripts.
- Treat the Manifest V3 background as a service worker and avoid durable in-memory state.
- Persist tab sessions in IndexedDB through Dexie.
- Persist lightweight settings in WXT storage, using `chrome.storage.local` only through WXT's wrapper.
- Never commit real tokens, secrets, credentials, or user-specific values.
- Never export `githubToken` inside a sync document.
- Manual Gist sync must be fully usable in this version.
- Gist information is user-provided in the options page; Tabstow does not create Gists.
- Pull from Gist merges by session ID: local-only stays, remote-only is added, matching IDs use remote.
- The new tab page should be a utilitarian dashboard.
- Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.

---

## File Structure

Create and maintain these files:

- `AGENTS.md`: project-local contributor guidance that records the Bun-only exception and extension constraints.
- `.gitignore`: ignores dependencies and WXT build artifacts.
- `package.json`: private Bun workspace root and root scripts.
- `tsconfig.base.json`: shared TypeScript compiler defaults.
- `docs/superpowers/specs/2026-07-06-tabstow-mvp-design.md`: approved design input; already committed.
- `docs/superpowers/plans/2026-07-06-tabstow-mvp.md`: this implementation plan.
- `packages/core/package.json`: core package metadata and scripts.
- `packages/core/tsconfig.json`: core package TypeScript config.
- `packages/core/src/index.ts`: public exports.
- `packages/core/src/schemas.ts`: Zod schemas and inferred types.
- `packages/core/src/tab-session.ts`: pure session helpers, including merge-by-ID behavior.
- `packages/core/src/sync-document.ts`: safe settings export and sync document builders/parsers.
- `packages/core/src/*.test.ts`: Vitest coverage for schemas and pure helpers.
- `apps/extension/package.json`: extension package metadata, dependencies, and WXT scripts.
- `apps/extension/tsconfig.json`: WXT TypeScript config.
- `apps/extension/vitest.config.ts`: unit-test config for extension pure helpers.
- `apps/extension/wxt.config.ts`: WXT config, React module, Manifest V3 settings, permissions, host permissions.
- `apps/extension/src/entrypoints/background.ts`: service worker entrypoint; registers context menu and message handlers.
- `apps/extension/src/entrypoints/newtab/index.html`: WXT new tab entrypoint.
- `apps/extension/src/entrypoints/newtab/main.tsx`: React mount for new tab.
- `apps/extension/src/entrypoints/newtab/App.tsx`: dashboard UI and interactions.
- `apps/extension/src/entrypoints/newtab/styles.css`: dashboard styling.
- `apps/extension/src/entrypoints/options/index.html`: WXT options entrypoint with `manifest.open_in_tab`.
- `apps/extension/src/entrypoints/options/main.tsx`: React mount for options.
- `apps/extension/src/entrypoints/options/OptionsApp.tsx`: settings and manual sync UI.
- `apps/extension/src/entrypoints/options/styles.css`: options styling.
- `apps/extension/src/components/StatusMessage.tsx`: shared status message component.
- `apps/extension/src/db/db.ts`: Dexie database and session repository functions.
- `apps/extension/src/features/context-menu/context-menu.ts`: context menu registration and click handler.
- `apps/extension/src/features/settings/settings-storage.ts`: settings storage and device ID creation.
- `apps/extension/src/features/sync/gist-client.ts`: GitHub Gist REST client.
- `apps/extension/src/features/sync/sync-service.ts`: manual push/pull orchestration.
- `apps/extension/src/features/tabs/session-service.ts`: current-window stow and restore orchestration.
- `apps/extension/src/features/tabs/tab-filter.ts`: pure tab eligibility helpers.
- `apps/extension/src/features/tabs/tab-filter.test.ts`: tab filtering tests.
- `apps/extension/src/lib/browser.ts`: WXT `browser` wrapper import boundary.
- `apps/extension/src/lib/errors.ts`: typed result and error helpers.
- `apps/extension/src/lib/messages.ts`: message request/response types and sender helper.

---

### Task 1: Workspace And WXT Shell

**Files:**
- Create: `AGENTS.md`
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `apps/extension/package.json`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/vitest.config.ts`
- Create: `apps/extension/wxt.config.ts`
- Create: `apps/extension/src/entrypoints/background.ts`
- Create: `apps/extension/src/entrypoints/newtab/index.html`
- Create: `apps/extension/src/entrypoints/newtab/main.tsx`
- Create: `apps/extension/src/entrypoints/newtab/App.tsx`
- Create: `apps/extension/src/entrypoints/newtab/styles.css`
- Create: `apps/extension/src/entrypoints/options/index.html`
- Create: `apps/extension/src/entrypoints/options/main.tsx`
- Create: `apps/extension/src/entrypoints/options/OptionsApp.tsx`
- Create: `apps/extension/src/entrypoints/options/styles.css`

**Interfaces:**
- Consumes: approved design spec in `docs/superpowers/specs/2026-07-06-tabstow-mvp-design.md`.
- Produces: Bun workspace scripts, WXT shell, React new tab page, React options page, and buildable package boundaries.

- [ ] **Step 1: Create project guidance**

Create `AGENTS.md`:

```markdown
# AGENTS.md

@/Users/zrx/.codex/RTK.md

Project-specific override: use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.

Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.

Browser-extension constraints:
- Chrome extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Treat the background entrypoint as a Manifest V3 service worker.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
```

- [ ] **Step 2: Create workspace files**

Create `.gitignore`:

```gitignore
node_modules/
bun.lockb
.DS_Store
.env
.env.*
!.env.example

apps/extension/.output/
apps/extension/.wxt/
apps/extension/dist/
packages/core/dist/
coverage/
```

Create `package.json`:

```json
{
  "name": "tabstow",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "bun --cwd apps/extension run dev",
    "build": "bun --cwd packages/core run build && bun --cwd apps/extension run build",
    "zip": "bun --cwd apps/extension run zip",
    "typecheck": "bun --cwd packages/core run typecheck && bun --cwd apps/extension run typecheck",
    "test": "bun --cwd packages/core run test && bun --cwd apps/extension run test"
  },
  "devDependencies": {
    "typescript": "latest",
    "vitest": "latest"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- [ ] **Step 3: Create package shells**

Create `packages/core/package.json`:

```json
{
  "name": "@tabstow/core",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "latest"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

Create `packages/core/src/index.ts`:

```ts
export {};
```

Create `apps/extension/package.json`:

```json
{
  "name": "@tabstow/extension",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build -b chrome",
    "zip": "wxt zip -b chrome",
    "typecheck": "wxt prepare && tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "postinstall": "wxt prepare"
  },
  "dependencies": {
    "@tabstow/core": "workspace:*",
    "@wxt-dev/module-react": "latest",
    "dexie": "latest",
    "lucide-react": "latest",
    "react": "latest",
    "react-dom": "latest",
    "wxt": "latest"
  },
  "devDependencies": {
    "@types/chrome": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "jsdom": "latest"
  }
}
```

Create `apps/extension/tsconfig.json`:

```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "types": ["chrome"]
  },
  "include": ["src", "wxt.config.ts", "vitest.config.ts"]
}
```

Create `apps/extension/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Configure WXT**

Create `apps/extension/wxt.config.ts`:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tabstow',
    description: 'Stow, organize, and restore your browser tabs.',
    permissions: ['tabs', 'storage', 'contextMenus'],
    host_permissions: ['https://api.github.com/*', 'https://gist.githubusercontent.com/*'],
    action: {
      default_title: 'Tabstow',
    },
  },
});
```

- [ ] **Step 5: Create smoke-test entrypoints**

Create `apps/extension/src/entrypoints/background.ts`:

```ts
export default defineBackground(() => {
  console.info('Tabstow background service worker loaded.');
});
```

Create `apps/extension/src/entrypoints/newtab/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tabstow</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Create `apps/extension/src/entrypoints/newtab/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

Create `apps/extension/src/entrypoints/newtab/App.tsx`:

```tsx
export function App() {
  return (
    <main className="newtab-shell">
      <section className="newtab-header" aria-labelledby="tabstow-title">
        <div>
          <h1 id="tabstow-title">Tabstow</h1>
          <p>Stow, organize, and restore your browser tabs.</p>
        </div>
        <button type="button">Stow current window</button>
      </section>
      <section className="empty-state" aria-live="polite">
        No saved sessions yet.
      </section>
    </main>
  );
}
```

Create `apps/extension/src/entrypoints/newtab/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #1e242c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
}

button,
input,
select {
  font: inherit;
}

.newtab-shell {
  width: min(1120px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 28px 0;
}

.newtab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid #d8dde5;
}

.newtab-header h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
}

.newtab-header p {
  margin: 6px 0 0;
  color: #596474;
}

.newtab-header button {
  min-height: 40px;
  border: 0;
  border-radius: 8px;
  padding: 0 14px;
  background: #234a7c;
  color: #fff;
  cursor: pointer;
}

.empty-state {
  margin-top: 24px;
  padding: 20px 0;
  color: #596474;
}
```

Create `apps/extension/src/entrypoints/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="manifest.open_in_tab" content="true" />
    <title>Tabstow Options</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Create `apps/extension/src/entrypoints/options/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsApp } from './OptionsApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
```

Create `apps/extension/src/entrypoints/options/OptionsApp.tsx`:

```tsx
export function OptionsApp() {
  return (
    <main className="options-shell">
      <h1>Tabstow Settings</h1>
      <p>Configure manual GitHub Gist sync.</p>
    </main>
  );
}
```

Create `apps/extension/src/entrypoints/options/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #1e242c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

.options-shell {
  width: min(820px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0;
}

.options-shell h1 {
  margin: 0;
  font-size: 28px;
}

.options-shell p {
  margin: 8px 0 0;
  color: #596474;
}
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
bun install
```

Expected: dependencies install, `bun.lock` is created, and WXT `postinstall` prepares `apps/extension/.wxt`.

- [ ] **Step 7: Verify scaffold**

Run:

```bash
bun run typecheck
```

Expected: command exits successfully with no TypeScript errors.

Run:

```bash
bun run build
```

Expected: WXT creates `apps/extension/.output/chrome-mv3` and exits successfully.

- [ ] **Step 8: Commit scaffold**

Run:

```bash
git add AGENTS.md .gitignore package.json tsconfig.base.json packages/core apps/extension bun.lock
git commit -m "chore(workspace): scaffold tabstow extension"
```

Expected: commit succeeds.

---

### Task 2: Core Domain Schemas And Pure Helpers

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/schemas.ts`
- Create: `packages/core/src/tab-session.ts`
- Create: `packages/core/src/sync-document.ts`
- Create: `packages/core/src/schemas.test.ts`
- Create: `packages/core/src/tab-session.test.ts`
- Create: `packages/core/src/sync-document.test.ts`

**Interfaces:**
- Consumes: `zod` from `packages/core/package.json`.
- Produces:
  - `SavedTab`, `TabSession`, `ExtensionSettings`, `SafeSyncSettings`, `SyncDocument`
  - `savedTabSchema`, `tabSessionSchema`, `extensionSettingsSchema`, `safeSyncSettingsSchema`, `syncDocumentSchema`
  - `DEFAULT_SETTINGS`
  - `mergeSessionsById(localSessions, remoteSessions): TabSession[]`
  - `toSafeSyncSettings(settings): SafeSyncSettings`
  - `toImportableSettings(settings): Partial<ExtensionSettings>`
  - `buildSyncDocument(input): SyncDocument`
  - `parseSyncDocument(value): SyncDocument`

- [ ] **Step 1: Write failing schema tests**

Create `packages/core/src/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  extensionSettingsSchema,
  savedTabSchema,
  syncDocumentSchema,
  tabSessionSchema,
} from './schemas';

describe('core schemas', () => {
  it('validates saved tabs and sessions', () => {
    const tab = savedTabSchema.parse({
      id: 'tab-1',
      url: 'https://example.com/',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: false,
      createdAt: '2026-07-06T00:00:00.000Z',
    });

    const session = tabSessionSchema.parse({
      id: 'session-1',
      title: 'Example session',
      tabs: [tab],
      sourceWindowId: 12,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      deviceId: 'device-1',
    });

    expect(session.tabs).toHaveLength(1);
  });

  it('keeps default settings aligned with the MVP', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: false,
      closePinnedTabs: false,
      theme: 'system',
    });

    expect(
      extensionSettingsSchema.parse({
        ...DEFAULT_SETTINGS,
        deviceId: 'device-1',
      }),
    ).toMatchObject(DEFAULT_SETTINGS);
  });

  it('rejects sync documents that contain githubToken in settings', () => {
    const result = syncDocumentSchema.safeParse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
        theme: 'system',
        githubToken: 'secret',
      },
    });

    expect(result.success).toBe(false);
  });
});
```

Create `packages/core/src/tab-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TabSession } from './schemas';
import { mergeSessionsById } from './tab-session';

const baseSession: TabSession = {
  id: 'session-1',
  title: 'Local',
  tabs: [],
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'local-device',
};

describe('mergeSessionsById', () => {
  it('keeps local-only sessions, adds remote-only sessions, and lets remote win on matching IDs', () => {
    const localOnly: TabSession = { ...baseSession, id: 'local-only', title: 'Local only' };
    const sharedLocal: TabSession = { ...baseSession, id: 'shared', title: 'Local shared' };
    const sharedRemote: TabSession = {
      ...baseSession,
      id: 'shared',
      title: 'Remote shared',
      deviceId: 'remote-device',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
    const remoteOnly: TabSession = {
      ...baseSession,
      id: 'remote-only',
      title: 'Remote only',
      deviceId: 'remote-device',
    };

    const merged = mergeSessionsById([localOnly, sharedLocal], [sharedRemote, remoteOnly]);

    expect(merged.map((session) => session.id).sort()).toEqual([
      'local-only',
      'remote-only',
      'shared',
    ]);
    expect(merged.find((session) => session.id === 'shared')?.title).toBe('Remote shared');
  });
});
```

Create `packages/core/src/sync-document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ExtensionSettings, TabSession } from './schemas';
import { buildSyncDocument, parseSyncDocument, toImportableSettings, toSafeSyncSettings } from './sync-document';

const settings: ExtensionSettings = {
  deviceId: 'device-1',
  githubToken: 'secret-token',
  gistId: 'gist-1',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: true,
  closePinnedTabs: false,
  theme: 'dark',
};

const session: TabSession = {
  id: 'session-1',
  title: 'Session',
  tabs: [],
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'device-1',
};

describe('sync documents', () => {
  it('exports safe settings without githubToken', () => {
    expect(toSafeSyncSettings(settings)).toEqual({
      deviceId: 'device-1',
      gistId: 'gist-1',
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: true,
      closePinnedTabs: false,
      theme: 'dark',
    });
  });

  it('imports remote settings without githubToken or deviceId', () => {
    expect(toImportableSettings(toSafeSyncSettings(settings))).toEqual({
      gistId: 'gist-1',
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: true,
      closePinnedTabs: false,
      theme: 'dark',
    });
  });

  it('builds and parses a schema version 1 sync document', () => {
    const document = buildSyncDocument({
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [session],
      settings,
    });

    expect(document.settings).not.toHaveProperty('githubToken');
    expect(parseSyncDocument(document).sessions).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun --cwd packages/core run test
```

Expected: FAIL because `schemas.ts`, `tab-session.ts`, and `sync-document.ts` do not exist.

- [ ] **Step 3: Implement schemas and helpers**

Create `packages/core/src/schemas.ts`:

```ts
import { z } from 'zod';

export const savedTabSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  favIconUrl: z.string().url().optional(),
  pinned: z.boolean().optional(),
  createdAt: z.string().datetime(),
});

export const tabSessionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tabs: z.array(savedTabSchema),
  sourceWindowId: z.number().int().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deviceId: z.string().min(1),
});

export const themeSchema = z.enum(['system', 'light', 'dark']);

export const defaultSettingsSchema = z.object({
  gistFileName: z.string().min(1),
  includePinnedTabs: z.boolean(),
  closePinnedTabs: z.boolean(),
  theme: themeSchema,
});

export const extensionSettingsSchema = defaultSettingsSchema.extend({
  deviceId: z.string().min(1),
  githubToken: z.string().min(1).optional(),
  gistId: z.string().min(1).optional(),
});

export const safeSyncSettingsSchema = extensionSettingsSchema
  .omit({ githubToken: true })
  .strict();

export const syncDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(1),
  exportedAt: z.string().datetime(),
  sessions: z.array(tabSessionSchema),
  settings: safeSyncSettingsSchema,
});

export const DEFAULT_SETTINGS = {
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
} as const satisfies z.infer<typeof defaultSettingsSchema>;

export type SavedTab = z.infer<typeof savedTabSchema>;
export type TabSession = z.infer<typeof tabSessionSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type DefaultSettings = z.infer<typeof defaultSettingsSchema>;
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;
export type SafeSyncSettings = z.infer<typeof safeSyncSettingsSchema>;
export type SyncDocument = z.infer<typeof syncDocumentSchema>;
```

Create `packages/core/src/tab-session.ts`:

```ts
import type { TabSession } from './schemas';

export function sortSessionsNewestFirst(sessions: TabSession[]): TabSession[] {
  return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergeSessionsById(
  localSessions: TabSession[],
  remoteSessions: TabSession[],
): TabSession[] {
  const mergedById = new Map<string, TabSession>();

  for (const session of localSessions) {
    mergedById.set(session.id, session);
  }

  for (const session of remoteSessions) {
    mergedById.set(session.id, session);
  }

  return sortSessionsNewestFirst(Array.from(mergedById.values()));
}
```

Create `packages/core/src/sync-document.ts`:

```ts
import {
  safeSyncSettingsSchema,
  syncDocumentSchema,
  type ExtensionSettings,
  type SafeSyncSettings,
  type SyncDocument,
  type TabSession,
} from './schemas';

export function toSafeSyncSettings(settings: ExtensionSettings): SafeSyncSettings {
  const { githubToken: _githubToken, ...safeSettings } = settings;
  return safeSyncSettingsSchema.parse(safeSettings);
}

export function toImportableSettings(
  settings: SafeSyncSettings,
): Partial<Omit<ExtensionSettings, 'githubToken' | 'deviceId'>> {
  const { deviceId: _deviceId, ...importableSettings } = settings;
  return importableSettings;
}

export function buildSyncDocument(input: {
  deviceId: string;
  exportedAt: string;
  sessions: TabSession[];
  settings: ExtensionSettings;
}): SyncDocument {
  return syncDocumentSchema.parse({
    schemaVersion: 1,
    deviceId: input.deviceId,
    exportedAt: input.exportedAt,
    sessions: input.sessions,
    settings: toSafeSyncSettings(input.settings),
  });
}

export function parseSyncDocument(value: unknown): SyncDocument {
  return syncDocumentSchema.parse(value);
}
```

Modify `packages/core/src/index.ts`:

```ts
export * from './schemas';
export * from './sync-document';
export * from './tab-session';
```

- [ ] **Step 4: Run core tests**

Run:

```bash
bun --cwd packages/core run test
```

Expected: PASS.

- [ ] **Step 5: Typecheck core**

Run:

```bash
bun --cwd packages/core run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit core domain model**

Run:

```bash
git add packages/core
git commit -m "feat(core): add tab session schemas"
```

Expected: commit succeeds.

---

### Task 3: Extension Result, Settings, Database, And Messages

**Files:**
- Create: `apps/extension/src/lib/errors.ts`
- Create: `apps/extension/src/lib/browser.ts`
- Create: `apps/extension/src/lib/messages.ts`
- Create: `apps/extension/src/features/settings/settings-storage.ts`
- Create: `apps/extension/src/db/db.ts`

**Interfaces:**
- Consumes: core types from `@tabstow/core`.
- Produces:
  - `AppResult<T>`, `AppError`, `ok(data)`, `err(code, message)`
  - `browser` wrapper
  - `ExtensionMessage`, `ExtensionMessageResponse`, `sendExtensionMessage`
  - `getSettings()`, `updateSettings(partial)`, `getOrCreateDeviceId()`
  - session repository functions required by later tasks

- [ ] **Step 1: Implement typed results and browser wrapper**

Create `apps/extension/src/lib/errors.ts`:

```ts
export type AppErrorCode =
  | 'missing-sync-settings'
  | 'github-api-error'
  | 'gist-file-not-found'
  | 'invalid-sync-document'
  | 'chrome-tabs-error'
  | 'no-eligible-tabs'
  | 'session-not-found'
  | 'unknown-error';

export type AppError = {
  code: AppErrorCode;
  message: string;
};

export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function ok<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

export function err<T = never>(code: AppErrorCode, message: string): AppResult<T> {
  return { ok: false, error: { code, message } };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}
```

Create `apps/extension/src/lib/browser.ts`:

```ts
import { browser } from '#imports';

export { browser };
```

- [ ] **Step 2: Implement message types**

Create `apps/extension/src/lib/messages.ts`:

```ts
import type { ExtensionSettings, TabSession } from '@tabstow/core';
import type { AppResult } from './errors';
import { browser } from './browser';

export type RestoreMode = 'current-window' | 'new-window';

export type StowResult = {
  session: TabSession;
  savedTabCount: number;
  closedTabCount: number;
};

export type SyncResult = {
  sessionCount: number;
  exportedAt?: string;
  importedAt?: string;
};

export type ExtensionMessage =
  | { type: 'sessions:list' }
  | { type: 'sessions:stow-current-window' }
  | { type: 'sessions:restore'; sessionId: string; mode: RestoreMode }
  | { type: 'sessions:delete'; sessionId: string }
  | { type: 'settings:get' }
  | { type: 'settings:update'; settings: Partial<ExtensionSettings> }
  | { type: 'sync:push' }
  | { type: 'sync:pull' };

export type ExtensionMessageResponse =
  | AppResult<TabSession[]>
  | AppResult<TabSession>
  | AppResult<StowResult>
  | AppResult<ExtensionSettings>
  | AppResult<SyncResult>
  | AppResult<{ deleted: true }>
  | AppResult<{ restored: true; tabCount: number }>;

export async function sendExtensionMessage<T extends ExtensionMessageResponse = ExtensionMessageResponse>(
  message: ExtensionMessage,
): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
```

- [ ] **Step 3: Implement settings storage**

Create `apps/extension/src/features/settings/settings-storage.ts`:

```ts
import { DEFAULT_SETTINGS, extensionSettingsSchema, type ExtensionSettings } from '@tabstow/core';
import { storage } from '#imports';

const SETTINGS_KEY = 'local:tabstow-settings';

function createDeviceId(): string {
  return crypto.randomUUID();
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storage.getItem<Partial<ExtensionSettings>>(SETTINGS_KEY);
  const candidate = {
    ...DEFAULT_SETTINGS,
    ...stored,
    deviceId: stored?.deviceId ?? createDeviceId(),
  };
  const settings = extensionSettingsSchema.parse(candidate);

  if (!stored?.deviceId) {
    await storage.setItem(SETTINGS_KEY, settings);
  }

  return settings;
}

export async function updateSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = extensionSettingsSchema.parse({
    ...current,
    ...partial,
    deviceId: current.deviceId,
  });

  await storage.setItem(SETTINGS_KEY, next);
  return next;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const settings = await getSettings();
  return settings.deviceId;
}
```

- [ ] **Step 4: Implement Dexie session repository**

Create `apps/extension/src/db/db.ts`:

```ts
import Dexie, { type Table } from 'dexie';
import { sortSessionsNewestFirst, tabSessionSchema, type TabSession } from '@tabstow/core';

class TabstowDatabase extends Dexie {
  sessions!: Table<TabSession, string>;

  constructor() {
    super('tabstow');
    this.version(1).stores({
      sessions: 'id, createdAt, updatedAt, deviceId',
    });
  }
}

export const db = new TabstowDatabase();

export async function createSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  await db.sessions.put(parsed);
  return parsed;
}

export async function listSessions(): Promise<TabSession[]> {
  const sessions = await db.sessions.toArray();
  return sortSessionsNewestFirst(sessions);
}

export async function getSession(id: string): Promise<TabSession | undefined> {
  return db.sessions.get(id);
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

export async function updateSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  await db.sessions.put(parsed);
  return parsed;
}

export async function clearSessions(): Promise<void> {
  await db.sessions.clear();
}

export async function exportSessions(): Promise<TabSession[]> {
  return listSessions();
}

export async function importSessions(sessions: TabSession[]): Promise<TabSession[]> {
  const parsed = sessions.map((session) => tabSessionSchema.parse(session));
  await db.transaction('rw', db.sessions, async () => {
    await db.sessions.bulkPut(parsed);
  });
  return sortSessionsNewestFirst(parsed);
}
```

- [ ] **Step 5: Verify types**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit infrastructure modules**

Run:

```bash
git add apps/extension/src/lib apps/extension/src/features/settings apps/extension/src/db
git commit -m "feat(extension): add storage and messaging foundations"
```

Expected: commit succeeds.

---

### Task 4: Tab Filtering, Stowing, And Restoring

**Files:**
- Create: `apps/extension/src/features/tabs/tab-filter.ts`
- Create: `apps/extension/src/features/tabs/tab-filter.test.ts`
- Create: `apps/extension/src/features/tabs/session-service.ts`

**Interfaces:**
- Consumes:
  - `getSettings()` from `settings-storage.ts`
  - session repository functions from `db.ts`
  - `browser` from `lib/browser.ts`
  - `ok`, `err`, `toErrorMessage` from `lib/errors.ts`
  - `StowResult`, `RestoreMode` from `lib/messages.ts`
- Produces:
  - `isBlockedTabUrl(url): boolean`
  - `isStowableTab(tab, settings): boolean`
  - `shouldCloseSavedTab(tab, settings): boolean`
  - `saveCurrentWindowAsSession(): Promise<AppResult<StowResult>>`
  - `restoreSession(sessionId, mode): Promise<AppResult<{ restored: true; tabCount: number }>>`

- [ ] **Step 1: Write failing tab-filter tests**

Create `apps/extension/src/features/tabs/tab-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ExtensionSettings } from '@tabstow/core';
import { isBlockedTabUrl, isStowableTab, shouldCloseSavedTab, type StowableBrowserTab } from './tab-filter';

const settings: ExtensionSettings = {
  deviceId: 'device-1',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
};

function tab(partial: Partial<StowableBrowserTab>): StowableBrowserTab {
  return {
    id: 1,
    windowId: 1,
    url: 'https://example.com/',
    title: 'Example',
    pinned: false,
    active: false,
    ...partial,
  };
}

describe('tab filtering', () => {
  it('blocks browser and extension URLs', () => {
    expect(isBlockedTabUrl('chrome://settings')).toBe(true);
    expect(isBlockedTabUrl('edge://settings')).toBe(true);
    expect(isBlockedTabUrl('about:blank')).toBe(true);
    expect(isBlockedTabUrl('chrome-extension://abc/newtab.html')).toBe(true);
    expect(isBlockedTabUrl('https://example.com/')).toBe(false);
  });

  it('skips pinned tabs unless includePinnedTabs is enabled', () => {
    expect(isStowableTab(tab({ pinned: true }), settings)).toBe(false);
    expect(isStowableTab(tab({ pinned: true }), { ...settings, includePinnedTabs: true })).toBe(true);
  });

  it('closes pinned saved tabs only when closePinnedTabs is enabled', () => {
    expect(shouldCloseSavedTab(tab({ pinned: true }), { ...settings, includePinnedTabs: true })).toBe(false);
    expect(
      shouldCloseSavedTab(tab({ pinned: true }), {
        ...settings,
        includePinnedTabs: true,
        closePinnedTabs: true,
      }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing extension tests**

Run:

```bash
bun --cwd apps/extension run test
```

Expected: FAIL because `tab-filter.ts` does not exist.

- [ ] **Step 3: Implement tab filtering**

Create `apps/extension/src/features/tabs/tab-filter.ts`:

```ts
import type { ExtensionSettings } from '@tabstow/core';

export type StowableBrowserTab = Pick<
  chrome.tabs.Tab,
  'active' | 'favIconUrl' | 'id' | 'pinned' | 'title' | 'url' | 'windowId'
>;

const BLOCKED_URL_PREFIXES = ['chrome://', 'edge://', 'about:', 'chrome-extension://'];

export function isBlockedTabUrl(url: string | undefined): boolean {
  if (!url) return true;
  return BLOCKED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function isStowableTab(
  tab: StowableBrowserTab,
  settings: Pick<ExtensionSettings, 'includePinnedTabs'>,
): boolean {
  if (tab.id == null) return false;
  if (isBlockedTabUrl(tab.url)) return false;
  if (tab.pinned && !settings.includePinnedTabs) return false;
  return true;
}

export function shouldCloseSavedTab(
  tab: StowableBrowserTab,
  settings: Pick<ExtensionSettings, 'closePinnedTabs'>,
): boolean {
  if (tab.id == null) return false;
  if (tab.pinned && !settings.closePinnedTabs) return false;
  return true;
}
```

- [ ] **Step 4: Run tab-filter tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/tabs/tab-filter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Implement session service**

Create `apps/extension/src/features/tabs/session-service.ts`:

```ts
import type { SavedTab, TabSession } from '@tabstow/core';
import { createSession, getSession } from '@/db/db';
import { getSettings } from '@/features/settings/settings-storage';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { RestoreMode, StowResult } from '@/lib/messages';
import { isStowableTab, shouldCloseSavedTab, type StowableBrowserTab } from './tab-filter';

function nowIso(): string {
  return new Date().toISOString();
}

function titleFromTabs(tabs: SavedTab[]): string {
  if (tabs.length === 1) return tabs[0]?.title || '1 tab';
  return `${tabs.length} tabs stowed`;
}

function toSavedTab(tab: StowableBrowserTab, createdAt: string): SavedTab {
  if (!tab.url) {
    throw new Error('Cannot save a tab without a URL.');
  }

  const savedTab: SavedTab = {
    id: crypto.randomUUID(),
    url: tab.url,
    title: tab.title || tab.url || 'Untitled tab',
    createdAt,
  };

  if (tab.favIconUrl) {
    savedTab.favIconUrl = tab.favIconUrl;
  }

  if (typeof tab.pinned === 'boolean') {
    savedTab.pinned = tab.pinned;
  }

  return savedTab;
}

async function ensureWindowSurvivesRemoval(
  windowId: number | undefined,
  totalCurrentWindowTabs: number,
  tabIdsToClose: number[],
): Promise<void> {
  if (windowId == null) return;
  if (tabIdsToClose.length < totalCurrentWindowTabs) return;

  await browser.tabs.create({
    windowId,
    url: browser.runtime.getURL('/newtab.html'),
    active: true,
  });
}

export async function getCurrentWindowTabs(): Promise<StowableBrowserTab[]> {
  return browser.tabs.query({ currentWindow: true });
}

export async function saveCurrentWindowAsSession(): Promise<AppResult<StowResult>> {
  try {
    const settings = await getSettings();
    const tabs = await getCurrentWindowTabs();
    const eligibleTabs = tabs.filter((tab) => isStowableTab(tab, settings));

    if (eligibleTabs.length === 0) {
      return err('no-eligible-tabs', 'No eligible tabs were found in the current window.');
    }

    const createdAt = nowIso();
    const savedTabs = eligibleTabs.map((tab) => toSavedTab(tab, createdAt));
    const session: TabSession = {
      id: crypto.randomUUID(),
      title: titleFromTabs(savedTabs),
      tabs: savedTabs,
      sourceWindowId: eligibleTabs[0]?.windowId,
      createdAt,
      updatedAt: createdAt,
      deviceId: settings.deviceId,
    };

    await createSession(session);

    const tabIdsToClose = eligibleTabs
      .filter((tab) => shouldCloseSavedTab(tab, settings))
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');

    await ensureWindowSurvivesRemoval(session.sourceWindowId, tabs.length, tabIdsToClose);

    if (tabIdsToClose.length > 0) {
      await browser.tabs.remove(tabIdsToClose);
    }

    return ok({
      session,
      savedTabCount: savedTabs.length,
      closedTabCount: tabIdsToClose.length,
    });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

export async function restoreSession(
  sessionId: string,
  mode: RestoreMode,
): Promise<AppResult<{ restored: true; tabCount: number }>> {
  try {
    const session = await getSession(sessionId);
    if (!session) {
      return err('session-not-found', 'Saved session was not found.');
    }

    if (mode === 'new-window') {
      await browser.windows.create({
        url: session.tabs.map((tab) => tab.url),
        focused: true,
      });
      return ok({ restored: true, tabCount: session.tabs.length });
    }

    for (const tab of session.tabs) {
      const createProperties: chrome.tabs.CreateProperties = {
        url: tab.url,
        active: false,
      };

      if (tab.pinned) {
        createProperties.pinned = true;
      }

      await browser.tabs.create(createProperties);
    }

    return ok({ restored: true, tabCount: session.tabs.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
```

- [ ] **Step 6: Verify tab service**

Run:

```bash
bun --cwd apps/extension run test
```

Expected: PASS.

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit tab services**

Run:

```bash
git add apps/extension/src/features/tabs
git commit -m "feat(tabs): add stow and restore services"
```

Expected: commit succeeds.

---

### Task 5: Background Messages And Context Menu

**Files:**
- Create: `apps/extension/src/features/context-menu/context-menu.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`

**Interfaces:**
- Consumes:
  - `ExtensionMessage` from `lib/messages.ts`
  - `listSessions`, `deleteSession` from `db.ts`
  - `getSettings`, `updateSettings` from `settings-storage.ts`
  - `saveCurrentWindowAsSession`, `restoreSession` from `session-service.ts`
- Produces:
  - context menu item with ID `tabstow-stow-current-window`
  - background message handlers for session and settings operations

- [ ] **Step 1: Implement context menu module**

Create `apps/extension/src/features/context-menu/context-menu.ts`:

```ts
import { saveCurrentWindowAsSession } from '@/features/tabs/session-service';
import { browser } from '@/lib/browser';

const STOW_CURRENT_WINDOW_MENU_ID = 'tabstow-stow-current-window';

export async function registerContextMenu(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: STOW_CURRENT_WINDOW_MENU_ID,
    title: 'Stow current window tabs',
    contexts: ['page'],
  });
}

export function registerContextMenuClickHandler(): void {
  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== STOW_CURRENT_WINDOW_MENU_ID) return;
    void saveCurrentWindowAsSession();
  });
}
```

- [ ] **Step 2: Replace background smoke entrypoint**

Modify `apps/extension/src/entrypoints/background.ts`:

```ts
import { deleteSession, listSessions } from '@/db/db';
import {
  registerContextMenu,
  registerContextMenuClickHandler,
} from '@/features/context-menu/context-menu';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { restoreSession, saveCurrentWindowAsSession } from '@/features/tabs/session-service';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage, ExtensionMessageResponse } from '@/lib/messages';

async function handleMessage(message: ExtensionMessage): Promise<ExtensionMessageResponse> {
  try {
    switch (message.type) {
      case 'sessions:list':
        return ok(await listSessions());
      case 'sessions:stow-current-window':
        return saveCurrentWindowAsSession();
      case 'sessions:restore':
        return restoreSession(message.sessionId, message.mode);
      case 'sessions:delete':
        await deleteSession(message.sessionId);
        return ok({ deleted: true });
      case 'settings:get':
        return ok(await getSettings());
      case 'settings:update':
        return ok(await updateSettings(message.settings));
      case 'sync:push':
      case 'sync:pull':
        return err('unknown-error', 'Sync is not available until the sync service is installed.');
    }
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void registerContextMenu();
  });

  browser.runtime.onStartup.addListener(() => {
    void registerContextMenu();
  });

  registerContextMenuClickHandler();

  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    return handleMessage(message) as Promise<AppResult<unknown>>;
  });
});
```

- [ ] **Step 3: Verify background build**

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun run build
```

Expected: PASS and generated manifest includes `tabs`, `storage`, and `contextMenus`.

- [ ] **Step 4: Commit background wiring**

Run:

```bash
git add apps/extension/src/entrypoints/background.ts apps/extension/src/features/context-menu
git commit -m "feat(background): wire messages and context menu"
```

Expected: commit succeeds.

---

### Task 6: Manual GitHub Gist Sync

**Files:**
- Create: `apps/extension/src/features/sync/gist-client.ts`
- Create: `apps/extension/src/features/sync/gist-client.test.ts`
- Create: `apps/extension/src/features/sync/sync-service.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`

**Interfaces:**
- Consumes:
  - `buildSyncDocument`, `parseSyncDocument`, `mergeSessionsById`, `toImportableSettings` from `@tabstow/core`
  - settings storage from `settings-storage.ts`
  - session repository functions from `db.ts`
  - `SyncResult` from `lib/messages.ts`
- Produces:
  - `GistClient.getFileContent(gistId, fileName): Promise<string>`
  - `GistClient.updateFile(gistId, fileName, content): Promise<void>`
  - `pushToGist(): Promise<AppResult<SyncResult>>`
  - `pullFromGist(): Promise<AppResult<SyncResult>>`

- [ ] **Step 1: Write failing Gist client tests**

Create `apps/extension/src/features/sync/gist-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { GistClient } from './gist-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GistClient', () => {
  it('reads a configured gist file by name', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse({
        files: {
          'tabstow.sync.json': {
            content: '{"schemaVersion":1}',
            truncated: false,
          },
        },
      }),
    );

    const client = new GistClient('token-1', fetcher);
    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).resolves.toBe(
      '{"schemaVersion":1}',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/gists/gist-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('updates a configured gist file by name', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}));
    const client = new GistClient('token-1', fetcher);

    await client.updateFile('gist-1', 'tabstow.sync.json', '{"schemaVersion":1}');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/gists/gist-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          files: {
            'tabstow.sync.json': {
              content: '{"schemaVersion":1}',
            },
          },
        }),
      }),
    );
  });

  it('throws when a configured file is missing', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ files: {} }));
    const client = new GistClient('token-1', fetcher);

    await expect(client.getFileContent('gist-1', 'tabstow.sync.json')).rejects.toThrow(
      'Gist file was not found.',
    );
  });
});
```

- [ ] **Step 2: Run failing Gist tests**

Run:

```bash
bun --cwd apps/extension run test -- src/features/sync/gist-client.test.ts
```

Expected: FAIL because `gist-client.ts` does not exist.

- [ ] **Step 3: Implement Gist client**

Create `apps/extension/src/features/sync/gist-client.ts`:

```ts
type Fetcher = typeof fetch;

type GistFileResponse = {
  content?: string;
  raw_url?: string;
  truncated?: boolean;
};

type GistResponse = {
  files?: Record<string, GistFileResponse>;
};

const GITHUB_API_VERSION = '2022-11-28';

export class GistClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private headers(): HeadersInit {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }

  async getFileContent(gistId: string, fileName: string): Promise<string> {
    const response = await this.fetcher(`https://api.github.com/gists/${gistId}`, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while reading the Gist.`);
    }

    const gist = (await response.json()) as GistResponse;
    const file = gist.files?.[fileName];

    if (!file) {
      throw new Error('Gist file was not found.');
    }

    if (!file.truncated && typeof file.content === 'string') {
      return file.content;
    }

    if (!file.raw_url) {
      throw new Error('Gist file content was unavailable.');
    }

    const rawResponse = await this.fetcher(file.raw_url, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!rawResponse.ok) {
      throw new Error(`GitHub returned ${rawResponse.status} while reading raw Gist content.`);
    }

    return rawResponse.text();
  }

  async updateFile(gistId: string, fileName: string, content: string): Promise<void> {
    const response = await this.fetcher(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [fileName]: {
            content,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} while updating the Gist.`);
    }
  }
}
```

- [ ] **Step 4: Implement sync service**

Create `apps/extension/src/features/sync/sync-service.ts`:

```ts
import {
  buildSyncDocument,
  mergeSessionsById,
  parseSyncDocument,
  toImportableSettings,
} from '@tabstow/core';
import { exportSessions, importSessions, listSessions } from '@/db/db';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import type { SyncResult } from '@/lib/messages';
import { GistClient } from './gist-client';

function requireSyncSettings(settings: {
  githubToken?: string;
  gistId?: string;
  gistFileName?: string;
}): AppResult<{ githubToken: string; gistId: string; gistFileName: string }> {
  if (!settings.githubToken || !settings.gistId || !settings.gistFileName) {
    return err(
      'missing-sync-settings',
      'GitHub token, Gist ID, and Gist filename are required for manual sync.',
    );
  }

  return ok({
    githubToken: settings.githubToken,
    gistId: settings.gistId,
    gistFileName: settings.gistFileName,
  });
}

export async function pushToGist(): Promise<AppResult<SyncResult>> {
  try {
    const settings = await getSettings();
    const required = requireSyncSettings(settings);
    if (!required.ok) return required;

    const sessions = await exportSessions();
    const exportedAt = new Date().toISOString();
    const document = buildSyncDocument({
      deviceId: settings.deviceId,
      exportedAt,
      sessions,
      settings,
    });

    const client = new GistClient(required.data.githubToken);
    await client.updateFile(
      required.data.gistId,
      required.data.gistFileName,
      JSON.stringify(document, null, 2),
    );

    return ok({ sessionCount: sessions.length, exportedAt });
  } catch (error) {
    return err('github-api-error', toErrorMessage(error));
  }
}

export async function pullFromGist(): Promise<AppResult<SyncResult>> {
  try {
    const settings = await getSettings();
    const required = requireSyncSettings(settings);
    if (!required.ok) return required;

    const client = new GistClient(required.data.githubToken);
    const content = await client.getFileContent(required.data.gistId, required.data.gistFileName);
    const document = parseSyncDocument(JSON.parse(content));
    const merged = mergeSessionsById(await listSessions(), document.sessions);

    await importSessions(merged);
    await updateSettings(toImportableSettings(document.settings));

    return ok({
      sessionCount: merged.length,
      importedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = toErrorMessage(error);
    if (message === 'Gist file was not found.') {
      return err('gist-file-not-found', message);
    }
    if (error instanceof SyntaxError) {
      return err('invalid-sync-document', 'The configured Gist file did not contain valid JSON.');
    }
    if (message.includes('Invalid') || message.includes('Expected')) {
      return err('invalid-sync-document', 'The configured Gist file was not a valid Tabstow sync document.');
    }
    return err('github-api-error', message);
  }
}
```

- [ ] **Step 5: Wire sync messages in background**

Modify `apps/extension/src/entrypoints/background.ts` so the import block includes:

```ts
import { pullFromGist, pushToGist } from '@/features/sync/sync-service';
```

Replace the `sync:push` and `sync:pull` switch cases with:

```ts
      case 'sync:push':
        return pushToGist();
      case 'sync:pull':
        return pullFromGist();
```

- [ ] **Step 6: Verify sync**

Run:

```bash
bun --cwd apps/extension run test -- src/features/sync/gist-client.test.ts
```

Expected: PASS.

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Gist sync**

Run:

```bash
git add apps/extension/src/features/sync apps/extension/src/entrypoints/background.ts
git commit -m "feat(sync): add manual gist push and pull"
```

Expected: commit succeeds.

---

### Task 7: New Tab Dashboard

**Files:**
- Create: `apps/extension/src/components/StatusMessage.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes:
  - `sendExtensionMessage` from `lib/messages.ts`
  - session message responses from background
- Produces:
  - working Tabstow dashboard
  - stow, restore, delete, push, pull actions from new tab page

- [ ] **Step 1: Create shared status component**

Create `apps/extension/src/components/StatusMessage.tsx`:

```tsx
type StatusTone = 'info' | 'success' | 'error';

export function StatusMessage({
  message,
  tone = 'info',
}: {
  message: string | null;
  tone?: StatusTone;
}) {
  if (!message) return null;

  return (
    <p className={`status-message status-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
    </p>
  );
}
```

- [ ] **Step 2: Implement dashboard React UI**

Replace `apps/extension/src/entrypoints/newtab/App.tsx`:

```tsx
import { Archive, RefreshCcw, RotateCcw, Settings, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type StowResult, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sessionPreview(session: TabSession): string {
  return session.tabs
    .slice(0, 4)
    .map((tab) => tab.title || domainFromUrl(tab.url))
    .join(' · ');
}

export function App() {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });

  const totalTabs = useMemo(
    () => sessions.reduce((count, session) => count + session.tabs.length, 0),
    [sessions],
  );

  async function loadSessions() {
    const response = await sendExtensionMessage<AppResult<TabSession[]>>({ type: 'sessions:list' });
    if (response.ok) {
      setSessions(response.data);
      return;
    }
    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function runAction<T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
  ) {
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const response = await action();
    setBusyAction(null);

    if (response.ok) {
      setStatus({ tone: 'success', message: success(response.data) });
      await loadSessions();
      return;
    }

    setStatus({ tone: 'error', message: response.error.message });
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
  }

  return (
    <main className="newtab-shell">
      <section className="newtab-header" aria-labelledby="tabstow-title">
        <div>
          <h1 id="tabstow-title">Tabstow</h1>
          <p>Stow, organize, and restore your browser tabs.</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void runAction<SyncResult>(
                'sync-pull',
                () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:pull' }),
                (result) => `Pulled ${result.sessionCount} sessions from Gist.`,
              )
            }
            disabled={busyAction !== null}
          >
            <RefreshCcw size={16} aria-hidden="true" />
            Pull
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              void runAction<SyncResult>(
                'sync-push',
                () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:push' }),
                (result) => `Pushed ${result.sessionCount} sessions to Gist.`,
              )
            }
            disabled={busyAction !== null}
          >
            <UploadCloud size={16} aria-hidden="true" />
            Push
          </button>
          <button type="button" className="icon-button" onClick={openOptions} aria-label="Open settings">
            <Settings size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              void runAction<StowResult>(
                'stow',
                () =>
                  sendExtensionMessage<AppResult<StowResult>>({
                    type: 'sessions:stow-current-window',
                  }),
                (result) =>
                  `Stowed ${result.savedTabCount} tabs and closed ${result.closedTabCount}.`,
              )
            }
            disabled={busyAction !== null}
          >
            <Archive size={16} aria-hidden="true" />
            Stow current window
          </button>
        </div>
      </section>

      <section className="stats-row" aria-label="Session summary">
        <span>{sessions.length} sessions</span>
        <span>{totalTabs} tabs stored</span>
      </section>

      <StatusMessage message={status.message} tone={status.tone} />

      <section className="session-list" aria-label="Saved sessions">
        {sessions.length === 0 ? (
          <div className="empty-state">No saved sessions yet.</div>
        ) : (
          sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div className="session-main">
                <h2>{session.title}</h2>
                <p>
                  {formatDate(session.createdAt)} · {session.tabs.length}{' '}
                  {session.tabs.length === 1 ? 'tab' : 'tabs'}
                </p>
                <p className="session-preview">{sessionPreview(session)}</p>
              </div>
              <div className="session-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void runAction(
                      `restore-${session.id}`,
                      () =>
                        sendExtensionMessage<AppResult<{ restored: true; tabCount: number }>>({
                          type: 'sessions:restore',
                          sessionId: session.id,
                          mode: 'current-window',
                        }),
                      (result) => `Restored ${result.tabCount} tabs.`,
                    )
                  }
                  disabled={busyAction !== null}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  Restore
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={() =>
                    void runAction(
                      `delete-${session.id}`,
                      () =>
                        sendExtensionMessage<AppResult<{ deleted: true }>>({
                          type: 'sessions:delete',
                          sessionId: session.id,
                        }),
                      () => 'Deleted saved session.',
                    )
                  }
                  disabled={busyAction !== null}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Replace dashboard CSS**

Replace `apps/extension/src/entrypoints/newtab/styles.css` with compact dashboard styling:

```css
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #1e242c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
}

button,
input,
select {
  font: inherit;
}

button {
  border: 0;
  border-radius: 8px;
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.newtab-shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 26px 0;
}

.newtab-header {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid #d8dde5;
}

.newtab-header h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.1;
}

.newtab-header p {
  margin: 6px 0 0;
  color: #596474;
}

.header-actions,
.session-actions,
.stats-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.primary-button {
  background: #234a7c;
  color: #fff;
}

.secondary-button {
  background: #e8edf4;
  color: #243246;
}

.danger-button {
  background: #f5e5e5;
  color: #8f2424;
}

.icon-button {
  width: 38px;
  padding: 0;
  background: #e8edf4;
  color: #243246;
}

.stats-row {
  margin-top: 16px;
  color: #596474;
  font-size: 14px;
}

.stats-row span {
  padding-right: 10px;
  border-right: 1px solid #cbd3dd;
}

.stats-row span:last-child {
  border-right: 0;
}

.status-message {
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
}

.status-message--info {
  background: #e8edf4;
  color: #243246;
}

.status-message--success {
  background: #e2f2e8;
  color: #235b35;
}

.status-message--error {
  background: #f5e5e5;
  color: #8f2424;
}

.session-list {
  margin-top: 18px;
  display: grid;
  gap: 10px;
}

.empty-state {
  padding: 22px 0;
  color: #596474;
}

.session-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid #d8dde5;
}

.session-main h2 {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
}

.session-main p {
  margin: 5px 0 0;
  color: #596474;
  font-size: 14px;
}

.session-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .newtab-header,
  .session-row {
    grid-template-columns: 1fr;
  }

  .header-actions,
  .session-actions {
    justify-content: flex-start;
  }
}
```

- [ ] **Step 4: Verify dashboard**

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 5: Commit dashboard**

Run:

```bash
git add apps/extension/src/components apps/extension/src/entrypoints/newtab
git commit -m "feat(ui): add new tab dashboard"
```

Expected: commit succeeds.

---

### Task 8: Options Page And Final Verification

**Files:**
- Modify: `apps/extension/src/entrypoints/options/OptionsApp.tsx`
- Modify: `apps/extension/src/entrypoints/options/styles.css`
- Create: `README.md`

**Interfaces:**
- Consumes:
  - `sendExtensionMessage` from `lib/messages.ts`
  - settings and sync message responses from background
- Produces:
  - options page for GitHub token, Gist ID, filename, pinned-tab settings, theme, manual push, and manual pull
  - README with local development and manual QA notes

- [ ] **Step 1: Implement options page**

Replace `apps/extension/src/entrypoints/options/OptionsApp.tsx`:

```tsx
import { DownloadCloud, Save, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExtensionSettings } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

const EMPTY_FORM: ExtensionSettings = {
  deviceId: '',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
};

export function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });

  async function loadSettings() {
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({ type: 'settings:get' });
    if (response.ok) {
      setSettings(response.data);
      return;
    }
    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  function updateField<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setBusyAction('save');
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings,
    });
    setBusyAction(null);

    if (response.ok) {
      setSettings(response.data);
      setStatus({ tone: 'success', message: 'Settings saved.' });
      return;
    }

    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  async function runSync(
    actionId: string,
    type: 'sync:push' | 'sync:pull',
    success: (result: SyncResult) => string,
  ) {
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const saved = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings,
    });

    if (!saved.ok) {
      setBusyAction(null);
      setStatus({ tone: 'error', message: saved.error.message });
      return;
    }

    const response = await sendExtensionMessage<AppResult<SyncResult>>({ type });
    setBusyAction(null);

    if (response.ok) {
      setStatus({ tone: 'success', message: success(response.data) });
      return;
    }

    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  return (
    <main className="options-shell">
      <header className="options-header">
        <div>
          <h1>Tabstow Settings</h1>
          <p>Configure manual GitHub Gist sync.</p>
        </div>
      </header>

      <StatusMessage message={status.message} tone={status.tone} />

      <section className="settings-section" aria-labelledby="gist-heading">
        <h2 id="gist-heading">Gist Sync</h2>
        <label>
          GitHub token
          <input
            type="password"
            value={settings.githubToken ?? ''}
            onChange={(event) => updateField('githubToken', event.target.value || undefined)}
            autoComplete="off"
          />
        </label>
        <label>
          Gist ID
          <input
            type="text"
            value={settings.gistId ?? ''}
            onChange={(event) => updateField('gistId', event.target.value || undefined)}
          />
        </label>
        <label>
          Gist filename
          <input
            type="text"
            value={settings.gistFileName}
            onChange={(event) => updateField('gistFileName', event.target.value)}
          />
        </label>
      </section>

      <section className="settings-section" aria-labelledby="behavior-heading">
        <h2 id="behavior-heading">Tab Behavior</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.includePinnedTabs}
            onChange={(event) => updateField('includePinnedTabs', event.target.checked)}
          />
          Save pinned tabs when stowing
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.closePinnedTabs}
            onChange={(event) => updateField('closePinnedTabs', event.target.checked)}
            disabled={!settings.includePinnedTabs}
          />
          Close pinned tabs after saving
        </label>
        <label>
          Theme
          <select
            value={settings.theme}
            onChange={(event) =>
              updateField('theme', event.target.value as ExtensionSettings['theme'])
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="settings-section" aria-labelledby="device-heading">
        <h2 id="device-heading">Device</h2>
        <p className="device-id">{settings.deviceId || 'Device ID will be created on first save.'}</p>
      </section>

      <footer className="options-actions">
        <button type="button" className="primary-button" onClick={() => void saveSettings()} disabled={busyAction !== null}>
          <Save size={16} aria-hidden="true" />
          Save
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void runSync('pull', 'sync:pull', (result) => `Pulled ${result.sessionCount} sessions.`)
          }
          disabled={busyAction !== null}
        >
          <DownloadCloud size={16} aria-hidden="true" />
          Pull
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void runSync('push', 'sync:push', (result) => `Pushed ${result.sessionCount} sessions.`)
          }
          disabled={busyAction !== null}
        >
          <UploadCloud size={16} aria-hidden="true" />
          Push
        </button>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Replace options CSS**

Replace `apps/extension/src/entrypoints/options/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #1e242c;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

button {
  border: 0;
  border-radius: 8px;
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

input,
select {
  width: 100%;
  min-height: 38px;
  margin-top: 6px;
  border: 1px solid #cbd3dd;
  border-radius: 8px;
  padding: 0 10px;
  background: #fff;
  color: #1e242c;
}

.options-shell {
  width: min(840px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0;
}

.options-header {
  padding-bottom: 18px;
  border-bottom: 1px solid #d8dde5;
}

.options-header h1 {
  margin: 0;
  font-size: 28px;
}

.options-header p {
  margin: 8px 0 0;
  color: #596474;
}

.settings-section {
  display: grid;
  gap: 14px;
  padding: 22px 0;
  border-bottom: 1px solid #d8dde5;
}

.settings-section h2 {
  margin: 0;
  font-size: 17px;
}

.settings-section label {
  display: block;
  color: #344255;
}

.checkbox-row {
  display: flex !important;
  align-items: center;
  gap: 10px;
}

.checkbox-row input {
  width: 18px;
  min-height: 18px;
  margin: 0;
}

.device-id {
  margin: 0;
  color: #596474;
  overflow-wrap: anywhere;
}

.options-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 22px;
}

.primary-button {
  background: #234a7c;
  color: #fff;
}

.secondary-button {
  background: #e8edf4;
  color: #243246;
}

.status-message {
  margin: 16px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
}

.status-message--info {
  background: #e8edf4;
  color: #243246;
}

.status-message--success {
  background: #e2f2e8;
  color: #235b35;
}

.status-message--error {
  background: #f5e5e5;
  color: #8f2424;
}
```

- [ ] **Step 3: Create README**

Create `README.md`:

```markdown
# Tabstow

Tabstow is a Chrome Manifest V3 extension that replaces the default new tab page with a utilitarian workspace for stowing, restoring, and manually syncing browser tab sessions.

## Development

Install dependencies:

```bash
bun install
```

Run the extension in development:

```bash
bun run dev
```

Build:

```bash
bun run build
```

Typecheck:

```bash
bun run typecheck
```

Test:

```bash
bun run test
```

Package:

```bash
bun run zip
```

## Gist Sync

Create a GitHub Gist manually, add a file named `tabstow.sync.json`, and paste the GitHub token, Gist ID, and filename into the Tabstow options page. The token must have permission to read and update the configured Gist. Tabstow does not create a Gist automatically.

## Manual QA

- Load `apps/extension/.output/chrome-mv3` as an unpacked extension in Chrome.
- Open a new tab and confirm the Tabstow dashboard appears.
- Open several ordinary web tabs and use **Stow current window**.
- Confirm the saved session appears and eligible tabs close.
- Restore the saved session.
- Delete the saved session.
- Open the options page and save Gist settings.
- Push to the configured Gist.
- Pull from the configured Gist and confirm sessions merge by ID.
```

- [ ] **Step 4: Run automated verification**

Run:

```bash
bun run test
```

Expected: PASS.

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun run build
```

Expected: PASS.

Run:

```bash
bun run zip
```

Expected: PASS and a Chrome zip appears under `apps/extension/.output`.

- [ ] **Step 5: Inspect generated manifest**

Run:

```bash
bun --eval "const m=require('./apps/extension/.output/chrome-mv3/manifest.json'); console.log(JSON.stringify({name:m.name, permissions:m.permissions, host_permissions:m.host_permissions, chrome_url_overrides:m.chrome_url_overrides, options_ui:m.options_ui}, null, 2))"
```

Expected output includes:

```json
{
  "name": "Tabstow",
  "permissions": ["tabs", "storage", "contextMenus"],
  "host_permissions": ["https://api.github.com/*", "https://gist.githubusercontent.com/*"],
  "chrome_url_overrides": {
    "newtab": "newtab.html"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  }
}
```

- [ ] **Step 6: Commit options UI and verification docs**

Run:

```bash
git add apps/extension/src/entrypoints/options README.md
git commit -m "feat(options): add gist sync settings"
```

Expected: commit succeeds.

---

## Final Verification Checklist

- [ ] `bun run test` passes.
- [ ] `bun run typecheck` passes.
- [ ] `bun run build` passes.
- [ ] `bun run zip` passes.
- [ ] Generated manifest name is `Tabstow`.
- [ ] Generated manifest includes only `tabs`, `storage`, and `contextMenus` permissions.
- [ ] Generated manifest includes only `https://api.github.com/*` and `https://gist.githubusercontent.com/*` host permissions.
- [ ] Generated manifest includes the new tab override.
- [ ] Generated manifest includes an options page that opens in a tab.
- [ ] Source search finds no committed token-like sample values beyond labels and test strings.
- [ ] Manual Chrome QA confirms stow, restore, delete, settings save, push, and pull.

## Reference Links

- WXT installation and Bun command: https://wxt.dev/guide/installation.html
- WXT project structure and `srcDir`: https://wxt.dev/guide/essentials/project-structure
- WXT React module and multiple app entrypoints: https://wxt.dev/guide/essentials/frontend-frameworks
- WXT new tab, options, and background entrypoints: https://wxt.dev/guide/essentials/entrypoints.html
- WXT manifest configuration and permissions: https://wxt.dev/guide/essentials/config/manifest
- WXT storage wrapper: https://wxt.dev/guide/essentials/storage.html
- GitHub Gist REST API: https://docs.github.com/en/rest/gists/gists
