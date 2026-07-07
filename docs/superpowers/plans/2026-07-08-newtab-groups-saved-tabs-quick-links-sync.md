# New Tab Groups, Saved Tabs, And Quick Links Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the new tab workspace, make Chrome-first two-way tab-group sync the default, render saved sessions as detailed tab lists, add minimal quick-link URL fetch, and sync quick links through Gist.

**Architecture:** Keep the existing React/WXT new tab shell and background message architecture. Add quick-link sync data to the core sync document, add extension-level quick-link merge helpers, make active tab grouping consume Chrome tab-group metadata, and keep saved/quick-link UI changes inside the existing new tab components.

**Tech Stack:** React, TypeScript, WXT, Chrome Manifest V3 APIs, Dexie, WXT storage, Zod, lucide-react, Vitest/jsdom, Bun scripts.

## Global Constraints

- Project-specific override: use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.
- Browser-extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Treat the background entrypoint as a Manifest V3 service worker.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
- No broad host permissions for arbitrary page-title scraping.
- No syncing uploaded quick-link image blobs through Gist.
- Chrome group sync is on by default; Chrome native group membership wins conflicts.
- Quick-link Fetch must not download arbitrary pages or parse remote `<title>` tags.
- Commit messages must use `type(scope): msg`.

---

## File Structure

- Modify `packages/core/src/schemas.ts`
  - Add sync-safe quick-link icon and quick-link schemas.
  - Add `quickLinks` to sync documents with a backward-compatible default.
  - Reject duplicate quick-link IDs in the same sync document.

- Modify `packages/core/src/sync-document.ts`
  - Accept `quickLinks` in `buildSyncDocument`.
  - Keep older callers valid by defaulting to an empty list.

- Modify `packages/core/src/schemas.test.ts`
  - Cover quick-link sync parsing, missing `quickLinks`, image-icon normalization, and duplicate IDs.

- Modify `packages/core/src/sync-document.test.ts`
  - Cover `buildSyncDocument` and `parseSyncDocument` with quick links.

- Modify `apps/extension/src/features/quick-links/quick-links.ts`
  - Add `previewQuickLinkUrl`, `toSyncedQuickLinks`, `fromSyncedQuickLinks`, `mergeQuickLinksForPush`, and `mergeQuickLinksForPull`.
  - Convert uploaded image icons to site icons for sync.
  - Preserve local uploaded image icons during pull when the remote record has only a site/default icon.

- Modify `apps/extension/src/features/quick-links/quick-links.test.ts`
  - Cover URL preview and sync merge behavior.

- Modify `apps/extension/src/features/sync/sync-service.ts`
  - Include quick links in push documents.
  - Save merged quick links on pull.
  - Return `quickLinkCount` in sync results.

- Modify `apps/extension/src/features/sync/sync-service.test.ts`
  - Mock quick-link storage.
  - Cover push and pull with quick links.

- Modify `apps/extension/src/lib/messages.ts`
  - Extend `SyncResult` with `quickLinkCount`.
  - Add `ActiveTabsSnapshot` response support for active-tabs messages.

- Modify `apps/extension/src/features/active-tabs/types.ts`
  - Add `ChromeTabGroupInfo`.
  - Add `ActiveTabsSnapshot`.
  - Add `chrome` to `ActiveTabGroupKind`.

- Modify `apps/extension/src/features/active-tabs/active-tab-groups.ts`
  - Prefer Chrome groups before manual/domain grouping.
  - Keep manual grouping only for ungrouped tabs.

- Modify `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`
  - Cover Chrome-first grouping.

- Modify `apps/extension/src/features/active-tabs/active-tabs-service.ts`
  - Add active-tabs snapshot read with tabs plus Chrome tab-group metadata.
  - Fall back to empty Chrome group metadata if `tabGroups.query` fails.

- Modify `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`
  - Cover snapshot success and metadata fallback.

- Modify `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
  - Normalize missing Chrome group sync state to `enabled: true`.

- Modify `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`
  - Update default expectations and legacy disabled-state expectations.

- Modify `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
  - Stop collapsing groups during default sync.
  - Keep explicit collapse behavior unchanged.

- Modify `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
  - Update sync expectations so `tabGroups.update` does not pass `collapsed: true`.

- Modify `apps/extension/src/entrypoints/background.ts`
  - Route the active-tabs snapshot message.

- Modify `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
  - Read active tab snapshots instead of tab arrays.
  - Remove the sync checkbox.
  - Show passive Chrome synced status and keep import/collapse controls.
  - Debounce refreshes from Chrome tab and tab-group events.

- Modify `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
  - Render every saved tab row with favicon/title/URL.
  - Add individual saved-tab open links.
  - Rename session action copy to Restore all.

- Modify `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
  - Add Fetch to the add-by-URL dialog.
  - Show URL preview with favicon and editable label before saving.

- Modify `apps/extension/src/features/i18n/i18n.ts`
  - Add strings for Chrome synced status, Fetch, fetched preview, Restore all, and saved-tab open labels.

- Modify `apps/extension/src/entrypoints/newtab/styles.css`
  - Widen shell and revise workspace grid.
  - Add saved tab list rows.
  - Add quick-link fetch preview controls.
  - Remove checkbox-specific Chrome sync layout dependencies.

- Modify `apps/extension/src/entrypoints/newtab/App.test.tsx`
  - Update integration tests for Chrome-first grouping UI, saved tab rows, quick-link Fetch, and sync status copy.

---

### Task 1: Sync Document Quick-Link Schema

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/sync-document.ts`
- Modify: `packages/core/src/schemas.test.ts`
- Modify: `packages/core/src/sync-document.test.ts`

**Interfaces:**
- Produces: `SyncedQuickLinkIcon = { kind: 'emoji'; value: string } | { kind: 'site'; value: null }`.
- Produces: `SyncedQuickLink = { id: string; url: string; label: string; icon: SyncedQuickLinkIcon | null; createdAt: string }`.
- Produces: `SyncDocument.quickLinks: SyncedQuickLink[]`.
- Produces: `buildSyncDocument(input: { deviceId: string; exportedAt: string; sessions: TabSession[]; settings: ExtensionSettings; quickLinks?: SyncedQuickLink[] }): SyncDocument`.
- Consumed by later tasks: extension quick-link sync helpers and sync service import these core types and document functions.

- [ ] **Step 1: Write failing core schema tests**

Add these tests to `packages/core/src/schemas.test.ts`:

```ts
  it('parses sync documents with quick links and defaults older documents to an empty list', () => {
    const legacy = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(legacy.quickLinks).toEqual([]);

    const current = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'emoji', value: '*' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(current.quickLinks).toEqual([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('normalizes unsupported synced quick-link icons to site icons', () => {
    const document = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'image', value: 'quick-link-icon:local-only' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(document.quickLinks[0]?.icon).toEqual({ kind: 'site', value: null });
  });

  it('rejects sync documents with duplicate quick-link ids', () => {
    const result = syncDocumentSchema.safeParse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://a.example/',
          label: 'A',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'quick-1',
          url: 'https://b.example/',
          label: 'B',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(result.success).toBe(false);
  });
```

- [ ] **Step 2: Write failing sync document tests**

Add this test to `packages/core/src/sync-document.test.ts`:

```ts
  it('builds and parses sync documents with quick links', () => {
    const document = buildSyncDocument({
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [session],
      settings,
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
    });

    expect(document.quickLinks).toEqual([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    expect(parseSyncDocument(document).quickLinks).toHaveLength(1);
  });
```

- [ ] **Step 3: Run core tests to verify they fail**

Run:

```bash
bun --cwd packages/core run test src/schemas.test.ts src/sync-document.test.ts
```

Expected: FAIL with missing `quickLinks` and unknown `quickLinks` build input.

- [ ] **Step 4: Add sync-safe quick-link schemas**

In `packages/core/src/schemas.ts`, add these schemas before `syncDocumentSchema`:

```ts
const syncedQuickLinkIconSchema = z
  .preprocess((value) => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { kind?: unknown; value?: unknown };
    if (candidate.kind === 'emoji' && typeof candidate.value === 'string') {
      return { kind: 'emoji', value: candidate.value };
    }
    if (candidate.kind === 'site' && candidate.value === null) {
      return { kind: 'site', value: null };
    }
    return { kind: 'site', value: null };
  }, z.union([
    z.object({ kind: z.literal('emoji'), value: z.string() }),
    z.object({ kind: z.literal('site'), value: z.null() }),
  ]).nullable());

export const syncedQuickLinkSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  label: z.string().min(1),
  icon: syncedQuickLinkIconSchema,
  createdAt: z.string().datetime(),
});
```

Update `syncDocumentSchema` to include quick links:

```ts
  quickLinks: z.array(syncedQuickLinkSchema).default([]),
```

Add duplicate quick-link validation inside the existing `superRefine`:

```ts
  const seenQuickLinkIds = new Set<string>();

  for (const [index, quickLink] of document.quickLinks.entries()) {
    if (seenQuickLinkIds.has(quickLink.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quickLinks', index, 'id'],
        message: 'Quick link IDs must be unique.',
      });
      continue;
    }

    seenQuickLinkIds.add(quickLink.id);
  }
```

Export the new types at the bottom:

```ts
export type SyncedQuickLink = z.infer<typeof syncedQuickLinkSchema>;
export type SyncedQuickLinkIcon = NonNullable<z.infer<typeof syncedQuickLinkIconSchema>>;
```

- [ ] **Step 5: Add quickLinks to buildSyncDocument**

In `packages/core/src/sync-document.ts`, update `buildSyncDocument`:

```ts
export function buildSyncDocument(input: {
  deviceId: string;
  exportedAt: string;
  sessions: TabSession[];
  settings: ExtensionSettings;
  quickLinks?: SyncedQuickLink[];
}): SyncDocument {
  return syncDocumentSchema.parse({
    schemaVersion: 1,
    deviceId: input.deviceId,
    exportedAt: input.exportedAt,
    sessions: input.sessions,
    quickLinks: input.quickLinks ?? [],
    settings: toSafeSyncSettings(input.settings),
  });
}
```

Also import `type SyncedQuickLink` from `./schemas`.

- [ ] **Step 6: Run core tests to verify they pass**

Run:

```bash
bun --cwd packages/core run test src/schemas.test.ts src/sync-document.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/core/src/schemas.ts packages/core/src/sync-document.ts packages/core/src/schemas.test.ts packages/core/src/sync-document.test.ts
git commit -m "feat(sync): add quick link sync schema"
```

---

### Task 2: Quick-Link Preview And Sync Helpers

**Files:**
- Modify: `apps/extension/src/features/quick-links/quick-links.ts`
- Modify: `apps/extension/src/features/quick-links/quick-links.test.ts`

**Interfaces:**
- Consumes: `SyncedQuickLink` from `@tabstow/core`.
- Produces: `previewQuickLinkUrl(input: string): { url: string; label: string; icon: { kind: 'site'; value: null } }`.
- Produces: `toSyncedQuickLinks(links: QuickLink[]): SyncedQuickLink[]`.
- Produces: `fromSyncedQuickLinks(links: SyncedQuickLink[]): QuickLink[]`.
- Produces: `mergeQuickLinksForPush(remoteLinks: SyncedQuickLink[], localLinks: QuickLink[]): QuickLink[]`.
- Produces: `mergeQuickLinksForPull(localLinks: QuickLink[], remoteLinks: SyncedQuickLink[]): QuickLink[]`.
- Consumed by later tasks: `QuickLinks` uses `previewQuickLinkUrl`; `sync-service` uses all sync helpers.

- [ ] **Step 1: Write failing quick-link helper tests**

Add these tests to `apps/extension/src/features/quick-links/quick-links.test.ts`:

```ts
  it('previews a pasted URL without fetching page metadata', () => {
    expect(previewQuickLinkUrl('example.com/docs')).toEqual({
      url: 'https://example.com/docs',
      label: 'example.com',
      icon: { kind: 'site', value: null },
    });
  });

  it('exports quick links for sync without uploaded image icons', () => {
    expect(
      toSyncedQuickLinks([
        {
          id: 'image-link',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'image', value: 'quick-link-icon:local-only' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'emoji-link',
          url: 'https://emoji.example/',
          label: 'Emoji',
          icon: { kind: 'emoji', value: '*' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'image-link',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'emoji-link',
        url: 'https://emoji.example/',
        label: 'Emoji',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('merges quick links for push with local precedence and local order first', () => {
    const local = [
      { id: 'shared', url: 'https://local.example/', label: 'Local', icon: null, createdAt: '2026-07-07T00:00:00.000Z' },
      { id: 'local-only', url: 'https://local-only.example/', label: 'Local only', icon: null, createdAt: '2026-07-07T00:00:00.000Z' },
    ];
    const remote = [
      { id: 'remote-only', url: 'https://remote-only.example/', label: 'Remote only', icon: { kind: 'site', value: null }, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'shared', url: 'https://remote.example/', label: 'Remote', icon: { kind: 'site', value: null }, createdAt: '2026-07-06T00:00:00.000Z' },
    ];

    expect(mergeQuickLinksForPush(remote, local).map((link) => [link.id, link.label])).toEqual([
      ['shared', 'Local'],
      ['local-only', 'Local only'],
      ['remote-only', 'Remote only'],
    ]);
  });

  it('merges quick links for pull with remote precedence and preserves local uploaded icons', () => {
    const local = [
      {
        id: 'shared',
        url: 'https://old.example/',
        label: 'Old',
        icon: { kind: 'image' as const, value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      { id: 'local-only', url: 'https://local-only.example/', label: 'Local only', icon: null, createdAt: '2026-07-07T00:00:00.000Z' },
    ];
    const remote = [
      { id: 'shared', url: 'https://remote.example/', label: 'Remote', icon: { kind: 'site' as const, value: null }, createdAt: '2026-07-08T00:00:00.000Z' },
      { id: 'remote-only', url: 'https://remote-only.example/', label: 'Remote only', icon: { kind: 'site' as const, value: null }, createdAt: '2026-07-08T00:00:00.000Z' },
    ];

    expect(mergeQuickLinksForPull(local, remote)).toEqual([
      {
        id: 'shared',
        url: 'https://remote.example/',
        label: 'Remote',
        icon: { kind: 'image', value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'remote-only',
        url: 'https://remote-only.example/',
        label: 'Remote only',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'local-only',
        url: 'https://local-only.example/',
        label: 'Local only',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
  });
```

Update the import at the top of the test file:

```ts
import {
  createQuickLink,
  mergeQuickLinksForPull,
  mergeQuickLinksForPush,
  normalizeQuickLinks,
  previewQuickLinkUrl,
  reorderQuickLinks,
  toSyncedQuickLinks,
  updateQuickLink,
} from './quick-links';
```

- [ ] **Step 2: Run quick-link helper tests to verify they fail**

Run:

```bash
bun --cwd apps/extension run test src/features/quick-links/quick-links.test.ts
```

Expected: FAIL because the new helper exports are missing.

- [ ] **Step 3: Add quick-link preview and sync helpers**

In `apps/extension/src/features/quick-links/quick-links.ts`, import the sync type:

```ts
import type { SyncedQuickLink } from '@tabstow/core';
```

Add this helper after `hostnameInitial` is introduced or near `normalizeUrl`:

```ts
function hostnameLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}
```

Add the new exported helpers after `createQuickLink`:

```ts
export function previewQuickLinkUrl(input: string): Pick<QuickLink, 'url' | 'label' | 'icon'> {
  const url = normalizeUrl(input);
  if (!url) throw new Error('Quick link URL is invalid.');
  return {
    url,
    label: hostnameLabel(url),
    icon: { kind: 'site', value: null },
  };
}

export function toSyncedQuickLinks(links: QuickLink[]): SyncedQuickLink[] {
  return normalizeQuickLinks(links).map((link) => ({
    id: link.id,
    url: link.url,
    label: link.label,
    icon: link.icon?.kind === 'emoji' ? link.icon : { kind: 'site', value: null },
    createdAt: link.createdAt,
  }));
}

export function fromSyncedQuickLinks(links: SyncedQuickLink[]): QuickLink[] {
  return normalizeQuickLinks(
    links.map((link) => ({
      ...link,
      icon: link.icon?.kind === 'emoji' ? link.icon : { kind: 'site', value: null },
    })),
  );
}

function appendMissingById(primary: QuickLink[], secondary: QuickLink[]): QuickLink[] {
  const seen = new Set(primary.map((link) => link.id));
  return [...primary, ...secondary.filter((link) => !seen.has(link.id))];
}

export function mergeQuickLinksForPush(
  remoteLinks: SyncedQuickLink[],
  localLinks: QuickLink[],
): QuickLink[] {
  return appendMissingById(normalizeQuickLinks(localLinks), fromSyncedQuickLinks(remoteLinks));
}

export function mergeQuickLinksForPull(
  localLinks: QuickLink[],
  remoteLinks: SyncedQuickLink[],
): QuickLink[] {
  const localById = new Map(normalizeQuickLinks(localLinks).map((link) => [link.id, link]));
  const remoteNormalized = fromSyncedQuickLinks(remoteLinks).map((remoteLink) => {
    const localLink = localById.get(remoteLink.id);
    if (localLink?.icon?.kind === 'image' && remoteLink.icon?.kind !== 'emoji') {
      return { ...remoteLink, icon: localLink.icon };
    }
    return remoteLink;
  });
  return appendMissingById(remoteNormalized, normalizeQuickLinks(localLinks));
}
```

Update `createQuickLink` to use `hostnameLabel(url)`:

```ts
    label: input.label?.trim() || hostnameLabel(url),
```

Update `normalizeQuickLinks` to use `hostnameLabel(url)`:

```ts
        label: String(candidate.label ?? '').trim() || hostnameLabel(url),
```

- [ ] **Step 4: Run quick-link helper tests to verify they pass**

Run:

```bash
bun --cwd apps/extension run test src/features/quick-links/quick-links.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/extension/src/features/quick-links/quick-links.ts apps/extension/src/features/quick-links/quick-links.test.ts
git commit -m "feat(quick-links): add sync and preview helpers"
```

---

### Task 3: Gist Sync Includes Quick Links

**Files:**
- Modify: `apps/extension/src/features/sync/sync-service.ts`
- Modify: `apps/extension/src/features/sync/sync-service.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`

**Interfaces:**
- Consumes: `getQuickLinks(): Promise<QuickLink[]>` and `saveQuickLinks(links: QuickLink[]): Promise<QuickLink[]>`.
- Consumes: `toSyncedQuickLinks`, `mergeQuickLinksForPush`, and `mergeQuickLinksForPull`.
- Produces: `SyncResult = { sessionCount: number; quickLinkCount: number; exportedAt?: string; importedAt?: string }`.
- Consumed by later tasks: saved panel push/pull status copy uses `quickLinkCount`.

- [ ] **Step 1: Write failing sync service tests**

In `apps/extension/src/features/sync/sync-service.test.ts`, add a quick-link storage mock near the existing hoisted mocks:

```ts
const quickLinkMocks = vi.hoisted(() => ({
  getQuickLinks: vi.fn(),
  saveQuickLinks: vi.fn(),
}));
```

Add this `vi.mock` block:

```ts
vi.mock('@/features/quick-links/quick-links-storage', () => quickLinkMocks);
```

Add default mocks in `beforeEach`:

```ts
    quickLinkMocks.getQuickLinks.mockResolvedValue([]);
    quickLinkMocks.saveQuickLinks.mockImplementation(async (links: unknown) => links);
```

Add this test:

```ts
  it('pushes quick links while excluding uploaded image icon tokens', async () => {
    const localOnly = createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z');

    dbMocks.exportSessions.mockResolvedValue([localOnly]);
    quickLinkMocks.getQuickLinks.mockResolvedValue([
      {
        id: 'quick-image',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    gistMocks.getFileContent.mockRejectedValue(
      new gistMocks.GistFileNotFoundError('Gist file was not found.'),
    );
    gistMocks.updateFile.mockResolvedValue(undefined);

    const result = await pushToGist();

    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 1,
        quickLinkCount: 1,
        exportedAt: expect.any(String),
      },
    });

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.quickLinks).toEqual([
      {
        id: 'quick-image',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('pulls and saves merged quick links from the configured gist', async () => {
    dbMocks.listSessions.mockResolvedValue([]);
    dbMocks.importSessions.mockResolvedValue([]);
    quickLinkMocks.getQuickLinks.mockResolvedValue([
      {
        id: 'local-only',
        url: 'https://local.example/',
        label: 'Local',
        icon: null,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-09T00:00:00.000Z',
        sessions: [],
        quickLinks: [
          {
            id: 'remote-only',
            url: 'https://remote.example/',
            label: 'Remote',
            icon: { kind: 'site', value: null },
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        ],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );

    const result = await pullFromGist();

    expect(quickLinkMocks.saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'remote-only', label: 'Remote' }),
      expect.objectContaining({ id: 'local-only', label: 'Local' }),
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 0,
        quickLinkCount: 2,
        importedAt: expect.any(String),
      },
    });
  });
```

Update existing expected success results in this test file to include `quickLinkCount: 0`.

- [ ] **Step 2: Run sync tests to verify they fail**

Run:

```bash
bun --cwd apps/extension run test src/features/sync/sync-service.test.ts
```

Expected: FAIL because sync service does not read or write quick links and `SyncResult` lacks `quickLinkCount`.

- [ ] **Step 3: Extend SyncResult**

In `apps/extension/src/lib/messages.ts`, update `SyncResult`:

```ts
export type SyncResult = {
  sessionCount: number;
  quickLinkCount: number;
  exportedAt?: string;
  importedAt?: string;
};
```

- [ ] **Step 4: Include quick links in push and pull**

In `apps/extension/src/features/sync/sync-service.ts`, add imports:

```ts
import {
  getQuickLinks,
  saveQuickLinks,
} from '@/features/quick-links/quick-links-storage';
import {
  mergeQuickLinksForPull,
  mergeQuickLinksForPush,
  toSyncedQuickLinks,
} from '@/features/quick-links/quick-links';
```

In `pushToGist`, after `const localSessions = await exportSessions();`, add:

```ts
    const localQuickLinks = await getQuickLinks();
    let quickLinksToPush = localQuickLinks;
```

Inside the remote document parse block, after merging sessions, add:

```ts
      quickLinksToPush = mergeQuickLinksForPush(remoteDocument.quickLinks, localQuickLinks);
```

Pass quick links to `buildSyncDocument`:

```ts
      quickLinks: toSyncedQuickLinks(quickLinksToPush),
```

Return the count:

```ts
    return ok({ sessionCount: sessionsToPush.length, quickLinkCount: quickLinksToPush.length, exportedAt });
```

In `pullFromGist`, after `const merged = mergeSessionsById(await listSessions(), document.sessions);`, add:

```ts
    const mergedQuickLinks = mergeQuickLinksForPull(await getQuickLinks(), document.quickLinks);
```

Save them after importing sessions:

```ts
    await saveQuickLinks(mergedQuickLinks);
```

Return the count:

```ts
      quickLinkCount: mergedQuickLinks.length,
```

- [ ] **Step 5: Run sync tests to verify they pass**

Run:

```bash
bun --cwd apps/extension run test src/features/sync/sync-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/extension/src/features/sync/sync-service.ts apps/extension/src/features/sync/sync-service.test.ts apps/extension/src/lib/messages.ts
git commit -m "feat(sync): include quick links in gist sync"
```

---

### Task 4: Chrome-First Active Tab Grouping Foundation

**Files:**
- Modify: `apps/extension/src/features/active-tabs/types.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-groups.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tabs-service.ts`
- Modify: `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`
- Modify: `apps/extension/src/features/active-tabs/active-workspace-storage.ts`
- Modify: `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`
- Modify: `apps/extension/src/lib/messages.ts`
- Modify: `apps/extension/src/entrypoints/background.ts`

**Interfaces:**
- Produces: `ChromeTabGroupInfo = Pick<chrome.tabGroups.TabGroup, 'id' | 'windowId' | 'title' | 'color' | 'collapsed'>`.
- Produces: `ActiveTabsSnapshot = { tabs: ActiveBrowserTab[]; chromeGroups: ChromeTabGroupInfo[] }`.
- Produces: `buildActiveTabGroups(tabs, manualState, orderState, chromeGroups?)`.
- Produces message: `{ type: 'active-tabs:snapshot' }` returning `AppResult<ActiveTabsSnapshot>`.
- Consumed by later tasks: `ActiveWorkspace` uses snapshots and Chrome-first grouping.

- [ ] **Step 1: Write failing storage test for default sync enabled**

In `apps/extension/src/features/active-tabs/active-workspace-storage.test.ts`, update the default expectation in `returns default local-only active workspace state`:

```ts
      chromeTabGroups: { enabled: true, mappings: [] },
```

Also update the `dedupes persisted order arrays while preserving first-seen order` expected `chromeTabGroups` to:

```ts
      chromeTabGroups: { enabled: true, mappings: [] },
```

Add this test:

```ts
  it('preserves an explicit disabled Chrome group sync state', async () => {
    storageMocks.getItem.mockResolvedValue({
      chromeTabGroups: {
        enabled: false,
        mappings: [],
      },
    });

    const { getActiveWorkspaceState } = await import('./active-workspace-storage');
    await expect(getActiveWorkspaceState()).resolves.toEqual({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: false, mappings: [] },
    });
  });
```

- [ ] **Step 2: Write failing Chrome-first grouping test**

In `apps/extension/src/features/active-tabs/active-tab-groups.test.ts`, add:

```ts
  it('prefers native Chrome group membership over stale manual assignments', () => {
    const groups = buildActiveTabGroups(
      [
        {
          id: 2,
          windowId: 7,
          groupId: 31,
          index: 1,
          active: true,
          pinned: false,
          title: 'Issue tracker',
          url: 'https://github.com/openai/tabstow/issues/10',
        },
      ],
      {
        groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }],
        assignments: { '2': 'manual-1' },
      },
      { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      [{ id: 31, windowId: 7, title: 'Reading', color: 'blue', collapsed: false }],
    );

    expect(groups).toEqual([
      expect.objectContaining({
        key: 'chrome:7:31',
        kind: 'chrome',
        title: 'Reading',
        tabs: [expect.objectContaining({ id: 2 })],
      }),
    ]);
  });
```

- [ ] **Step 3: Write failing active-tabs snapshot service tests**

In `apps/extension/src/features/active-tabs/active-tabs-service.test.ts`, add `tabGroups` to `browserMocks`:

```ts
  tabGroups: {
    query: vi.fn(),
  },
```

Add default reset behavior in `beforeEach`:

```ts
    browserMocks.tabGroups.query.mockResolvedValue([]);
```

Add these tests:

```ts
  it('lists active tabs with Chrome tab-group metadata', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' },
    ]);
    browserMocks.tabGroups.query.mockResolvedValue([
      { id: 31, windowId: 2, title: 'Reading', color: 'blue', collapsed: false },
    ]);

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');
    const result = await listActiveTabsSnapshot();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
    expect(browserMocks.tabGroups.query).toHaveBeenCalledWith({});
    expect(result).toEqual({
      ok: true,
      data: {
        tabs: [{ id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' }],
        chromeGroups: [{ id: 31, windowId: 2, title: 'Reading', color: 'blue', collapsed: false }],
      },
    });
  });

  it('keeps active tabs when Chrome group metadata cannot be read', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' },
    ]);
    browserMocks.tabGroups.query.mockRejectedValue(new Error('tabGroups unavailable'));

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');
    const result = await listActiveTabsSnapshot();

    expect(result).toEqual({
      ok: true,
      data: {
        tabs: [{ id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' }],
        chromeGroups: [],
      },
    });
  });
```

- [ ] **Step 4: Run active-tabs tests to verify they fail**

Run:

```bash
bun --cwd apps/extension run test src/features/active-tabs/active-workspace-storage.test.ts src/features/active-tabs/active-tab-groups.test.ts src/features/active-tabs/active-tabs-service.test.ts
```

Expected: FAIL because defaults, Chrome group kind, and snapshot service are missing.

- [ ] **Step 5: Add active tab snapshot and Chrome group types**

In `apps/extension/src/features/active-tabs/types.ts`, add:

```ts
export type ChromeTabGroupInfo = Pick<
  chrome.tabGroups.TabGroup,
  'id' | 'windowId' | 'title' | 'color' | 'collapsed'
>;

export type ActiveTabsSnapshot = {
  tabs: ActiveBrowserTab[];
  chromeGroups: ChromeTabGroupInfo[];
};
```

Change:

```ts
export type ActiveTabGroupKind = 'landing' | 'manual' | 'domain';
```

to:

```ts
export type ActiveTabGroupKind = 'chrome' | 'landing' | 'manual' | 'domain';
```

- [ ] **Step 6: Implement Chrome-first grouping**

In `apps/extension/src/features/active-tabs/active-tab-groups.ts`, import `ChromeTabGroupInfo`:

```ts
  ChromeTabGroupInfo,
```

Add helper functions before `buildActiveTabGroups`:

```ts
function chromeGroupKey(tab: ActiveBrowserTab): string | null {
  if (typeof tab.groupId !== 'number' || tab.groupId < 0 || typeof tab.windowId !== 'number') return null;
  return `chrome:${tab.windowId}:${tab.groupId}`;
}

function chromeGroupsByKey(groups: ChromeTabGroupInfo[]): Map<string, ChromeTabGroupInfo> {
  return new Map(groups.map((group) => [`chrome:${group.windowId}:${group.id}`, group]));
}
```

Change the `buildActiveTabGroups` signature:

```ts
export function buildActiveTabGroups(
  tabs: ActiveBrowserTab[],
  manualState: ManualGroupsState,
  orderState: ActiveWorkspaceOrderState,
  chromeGroups: ChromeTabGroupInfo[] = [],
): ActiveTabGroup[] {
```

After `manualGroupsById`, add:

```ts
  const nativeGroupsByKey = chromeGroupsByKey(chromeGroups);
```

Inside the loop, replace the key/title/kind selection block with:

```ts
    const nativeKey = chromeGroupKey(tab);
    const nativeGroup = nativeKey ? nativeGroupsByKey.get(nativeKey) : undefined;
    const manualGroupId = nativeGroup ? undefined : manualState.assignments[String(tab.id)];
    const manualGroup = manualGroupId ? manualGroupsById.get(manualGroupId) : undefined;
    const key = nativeGroup
      ? nativeKey as string
      : manualGroup
        ? `manual:${manualGroup.id}`
        : isLandingPage(tab.url)
          ? LANDING_GROUP_KEY
          : `domain:${getTabHostname(tab) || 'unknown'}`;

    const title = nativeGroup
      ? nativeGroup.title?.trim() || `Chrome group ${nativeGroup.id}`
      : manualGroup
        ? manualGroup.name
        : key === LANDING_GROUP_KEY
          ? 'Homepages'
          : friendlyDomain(key.replace(/^domain:/, '')) || 'Other';

    const kind: ActiveTabGroup['kind'] = nativeGroup
      ? 'chrome'
      : manualGroup
        ? 'manual'
        : key === LANDING_GROUP_KEY
          ? 'landing'
          : 'domain';
```

- [ ] **Step 7: Implement active tab snapshot service and message**

In `apps/extension/src/features/active-tabs/active-tabs-service.ts`, import `ActiveTabsSnapshot`:

```ts
import type { ActiveBrowserTab, ActiveTabsSnapshot, ChromeTabGroupInfo } from './types';
```

Add:

```ts
async function listChromeTabGroups(): Promise<ChromeTabGroupInfo[]> {
  try {
    return await browser.tabGroups.query({});
  } catch {
    return [];
  }
}

export async function listActiveTabsSnapshot(): Promise<AppResult<ActiveTabsSnapshot>> {
  const response = await listActiveTabs();
  if (!response.ok) return response;

  return ok({
    tabs: response.data,
    chromeGroups: await listChromeTabGroups(),
  });
}
```

In `apps/extension/src/lib/messages.ts`, add message and response types:

```ts
  ActiveTabsSnapshot,
```

Add to `ExtensionMessage`:

```ts
  | { type: 'active-tabs:snapshot' }
```

Add to `ExtensionMessageResponse`:

```ts
  | AppResult<ActiveTabsSnapshot>
```

In `apps/extension/src/entrypoints/background.ts`, import `listActiveTabsSnapshot` and add:

```ts
      case 'active-tabs:snapshot':
        return listActiveTabsSnapshot();
```

- [ ] **Step 8: Default Chrome group sync to enabled**

In `apps/extension/src/features/active-tabs/active-workspace-storage.ts`, replace `normalizeChromeGroups` with:

```ts
function normalizeChromeGroups(input: Partial<ChromeTabGroupsState> | undefined): ChromeTabGroupsState {
  const mappings = Array.isArray(input?.mappings) ? (input.mappings as unknown[]) : [];

  return {
    enabled: input?.enabled === false ? false : true,
    mappings: mappings
      .filter(
        (mapping): mapping is ChromeTabGroupMappingCandidate =>
          Boolean(mapping && typeof mapping === 'object'),
      )
      .filter(
        (mapping): mapping is ChromeTabGroupMapping =>
          typeof mapping.virtualGroupKey === 'string' &&
          mapping.virtualGroupKey.length > 0 &&
          Number.isInteger(mapping.windowId) &&
          Number.isInteger(mapping.chromeGroupId),
      ),
  };
}
```

- [ ] **Step 9: Run active-tabs tests to verify they pass**

Run:

```bash
bun --cwd apps/extension run test src/features/active-tabs/active-workspace-storage.test.ts src/features/active-tabs/active-tab-groups.test.ts src/features/active-tabs/active-tabs-service.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add apps/extension/src/features/active-tabs apps/extension/src/lib/messages.ts apps/extension/src/entrypoints/background.ts
git commit -m "feat(active-tabs): prefer chrome tab groups"
```

---

### Task 5: Chrome Sync UI And No Auto-Collapse

**Files:**
- Modify: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`
- Modify: `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `active-tabs:snapshot`.
- Consumes: `buildActiveTabGroups(tabs, manualState, orderState, chromeGroups)`.
- Produces UI text keys: `chromeGroupsSynced`, `refreshChromeGroups`.
- Produces behavior: default sync does not pass `collapsed: true` to `tabGroups.update`.

- [ ] **Step 1: Write failing Chrome sync no-collapse test updates**

In `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.test.ts`, replace expectations like:

```ts
expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(99, { title: 'Launch', collapsed: true });
```

with:

```ts
expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(99, { title: 'Launch' });
```

Update every `syncChromeTabGroups` test that expects `collapsed: true`. Keep the explicit `collapseChromeTabGroups` test unchanged.

- [ ] **Step 2: Write failing App tests for passive Chrome sync status**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, update `defaultWorkspace()`:

```ts
    chromeTabGroups: { enabled: true, mappings: [] },
```

Update `mockMessages` so active tab reads support snapshots:

```ts
    if (message.type === 'active-tabs:snapshot') {
      return { ok: true, data: { tabs: activeTabs, chromeGroups: [] } };
    }
```

Leave the existing `active-tabs:list` branch for add-open-tab quick-link flows.

Add this test:

```ts
  it('shows Chrome group sync as a default passive status instead of a checkbox', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(sentMessageTypes()).toEqual(expect.arrayContaining(['active-tabs:snapshot', 'sessions:list']));
  });
```

Update tests that query `.active-workspace .meta-row input[type="checkbox"]` to assert the passive status exists and the import/collapse buttons are disabled while busy:

```ts
    expect(container.querySelector('.active-workspace .meta-row input[type="checkbox"]')).toBeNull();
    expect(screen().getByText('Chrome groups synced')).not.toBeNull();
```

Remove the old `toggles Chrome tab group sync from the active workspace controls` test because the checkbox no longer exists.

- [ ] **Step 3: Run targeted tests to verify they fail**

Run:

```bash
bun --cwd apps/extension run test src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because sync still collapses groups and `ActiveWorkspace` still uses the checkbox and `active-tabs:list`.

- [ ] **Step 4: Stop default sync from collapsing Chrome groups**

In `apps/extension/src/features/chrome-tab-groups/chrome-tab-groups.ts`, replace:

```ts
        await browser.tabGroups.update(chromeGroupId, { title: group.title, collapsed: true });
```

with:

```ts
        await browser.tabGroups.update(chromeGroupId, { title: group.title });
```

- [ ] **Step 5: Add i18n keys**

In `apps/extension/src/features/i18n/i18n.ts`, add English keys:

```ts
    chromeGroupsSynced: 'Chrome groups synced',
    refreshChromeGroups: 'Refresh Chrome groups',
```

Add Simplified Chinese keys:

```ts
    chromeGroupsSynced: 'Chrome 分组已同步',
    refreshChromeGroups: '刷新 Chrome 分组',
```

- [ ] **Step 6: Update ActiveWorkspace to use snapshots and passive status**

In `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`, add state:

```ts
  const [chromeGroups, setChromeGroups] = useState<ChromeTabGroupInfo[]>([]);
```

Import the type:

```ts
import type { ActiveBrowserTab, ActiveTabsSnapshot, ChromeTabGroupInfo } from '@/features/active-tabs/types';
```

In `refresh`, replace the active tabs message:

```ts
      sendExtensionMessage<AppResult<ActiveTabsSnapshot>>({ type: 'active-tabs:snapshot' }),
```

Replace `tabsResponse.data` usages in `refresh` with `tabsResponse.data.tabs`, and set both pieces of state:

```ts
    const snapshot = tabsResponse.data;
    const openIds = snapshot.tabs
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');
```

Then:

```ts
    setTabs(snapshot.tabs);
    setChromeGroups(snapshot.chromeGroups);
```

Update group building:

```ts
  const groups = useMemo(
    () => (workspace ? buildActiveTabGroups(tabs, workspace.manualGroups, workspace.order, chromeGroups) : []),
    [chromeGroups, tabs, workspace],
  );
```

Remove `toggleChromeTabGroups` and the checkbox markup. Replace the control row with:

```tsx
        <span className="status-pill">{t(locale, 'chromeGroupsSynced')}</span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refresh()}
          disabled={chromeGroupControlsDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          {t(locale, 'refreshChromeGroups')}
        </button>
```

Keep the existing collapse and import buttons.

In `importExistingChromeGroups`, force imported state to remain enabled when sending:

```ts
      state: { ...workspace.chromeTabGroups, enabled: true },
```

In `removeTabFromManualGroup`, continue calling `syncChromeGroupsForWorkspace(nextWorkspace)` because explicit Tabstow grouping changes should write back to Chrome.

- [ ] **Step 7: Add debounced Chrome tab event refresh**

In `ActiveWorkspace.tsx`, add this effect after the existing `refreshKey` effect:

```ts
  useEffect(() => {
    if (typeof chrome === 'undefined') return;

    const tabsApi = chrome?.tabs;
    const tabGroupsApi = chrome?.tabGroups;
    let timeoutId: number | null = null;

    function scheduleRefresh() {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void refresh();
      }, 150);
    }

    tabsApi?.onCreated?.addListener(scheduleRefresh);
    tabsApi?.onUpdated?.addListener(scheduleRefresh);
    tabsApi?.onRemoved?.addListener(scheduleRefresh);
    tabsApi?.onMoved?.addListener(scheduleRefresh);
    tabGroupsApi?.onCreated?.addListener(scheduleRefresh);
    tabGroupsApi?.onUpdated?.addListener(scheduleRefresh);
    tabGroupsApi?.onRemoved?.addListener(scheduleRefresh);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      tabsApi?.onCreated?.removeListener(scheduleRefresh);
      tabsApi?.onUpdated?.removeListener(scheduleRefresh);
      tabsApi?.onRemoved?.removeListener(scheduleRefresh);
      tabsApi?.onMoved?.removeListener(scheduleRefresh);
      tabGroupsApi?.onCreated?.removeListener(scheduleRefresh);
      tabGroupsApi?.onUpdated?.removeListener(scheduleRefresh);
      tabGroupsApi?.onRemoved?.removeListener(scheduleRefresh);
    };
  }, []);
```

- [ ] **Step 8: Run targeted tests to verify they pass**

Run:

```bash
bun --cwd apps/extension run test src/features/chrome-tab-groups/chrome-tab-groups.test.ts src/entrypoints/newtab/App.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/extension/src/features/chrome-tab-groups apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/features/i18n/i18n.ts apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "feat(newtab): default chrome group sync"
```

---

### Task 6: Saved Sessions Render Detailed Tab Rows

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `TabSession.tabs[]` with `title`, `url`, `favIconUrl`, and `pinned`.
- Produces: `.saved-tab-list`, `.saved-tab-row`, `.saved-tab-favicon`.
- Produces i18n keys: `restoreAll`, `openSavedTab`.
- Produces behavior: saved tab row link opens an individual saved URL in a new tab.

- [ ] **Step 1: Write failing saved-tab row App test**

Add this test to `apps/extension/src/entrypoints/newtab/App.test.tsx`:

```ts
  it('renders every saved tab with favicon title and URL detail', async () => {
    const sessions: TabSession[] = [
      {
        id: 'session-1',
        title: '2 tabs stowed',
        tabs: [
          {
            id: 'saved-tab-1',
            title: 'Example Docs',
            url: 'https://docs.example.com/path',
            favIconUrl: 'https://docs.example.com/favicon.ico',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
          {
            id: 'saved-tab-2',
            title: 'Example Blog',
            url: 'https://blog.example.com/post',
            createdAt: '2026-07-07T00:00:00.000Z',
          },
        ],
        sourceWindowId: 4,
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
        deviceId: 'device-1',
      },
    ];
    mockMessages({ activeTabs: [UNIQUE_TAB], sessions });

    await renderApp();

    expect(screen().getByText('2 tabs')).not.toBeNull();
    expect(screen().getByText('Example Docs')).not.toBeNull();
    expect(screen().getByText('https://docs.example.com/path')).not.toBeNull();
    expect(screen().getByText('Example Blog')).not.toBeNull();
    expect(screen().getByText('https://blog.example.com/post')).not.toBeNull();
    expect(container.querySelectorAll('.saved-tab-row')).toHaveLength(2);
    expect(container.querySelector<HTMLImageElement>('img.saved-tab-favicon')?.getAttribute('src')).toBe(
      'https://docs.example.com/favicon.ico',
    );
    expect(screen().getByRole('button', { name: 'Restore all' })).not.toBeNull();
    expect(container.querySelector<HTMLAnchorElement>('a.saved-tab-row')?.getAttribute('href')).toBe(
      'https://docs.example.com/path',
    );
  });
```

- [ ] **Step 2: Run App test to verify it fails**

Run:

```bash
bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because saved sessions only render a preview string and the restore button says `Restore`.

- [ ] **Step 3: Add i18n keys**

In `apps/extension/src/features/i18n/i18n.ts`, add English:

```ts
    openSavedTab: 'Open {{label}}',
    restoreAll: 'Restore all',
```

Add Simplified Chinese:

```ts
    openSavedTab: '打开 {{label}}',
    restoreAll: '全部恢复',
```

- [ ] **Step 4: Implement saved tab favicon and row rendering**

In `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`, add:

```ts
function faviconUrlForSavedTab(tab: TabSession['tabs'][number]): string | null {
  if (tab.favIconUrl) return tab.favIconUrl;

  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.getURL !== 'function') return null;
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url.toString())}&size=32`);
  } catch {
    return null;
  }
}

function SavedTabFavicon({ tab }: { tab: TabSession['tabs'][number] }) {
  const src = faviconUrlForSavedTab(tab);
  if (!src) {
    return (
      <span className="favicon tone-blue saved-tab-fallback" aria-hidden="true">
        {(tab.title.match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return <img alt="" aria-hidden="true" className="saved-tab-favicon" src={src} />;
}
```

Remove `sessionPreview`. Replace the session card body with:

```tsx
              <header>
                <div className="tab-copy">
                  <span className="session-title">
                    {session.tabs.length} {session.tabs.length === 1 ? 'tab' : 'tabs'}
                  </span>
                  <span className="session-preview">{formatDate(session.createdAt)}</span>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void onRunAction(
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
                    {t(locale, 'restoreAll')}
                  </button>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() =>
                      void onRunAction(
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
                    {t(locale, 'delete')}
                  </button>
                </div>
              </header>
              <div className="saved-tab-list">
                {session.tabs.map((tab) => (
                  <a
                    className="saved-tab-row"
                    href={tab.url}
                    key={tab.id}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t(locale, 'openSavedTab', { label: tab.title || tab.url })}
                  >
                    <SavedTabFavicon tab={tab} />
                    <span className="tab-copy">
                      <span className="tab-title">{tab.title || tab.url}</span>
                      <span className="tab-url">{tab.url}</span>
                    </span>
                  </a>
                ))}
              </div>
```

- [ ] **Step 5: Add saved tab row CSS and widen layout**

In `apps/extension/src/entrypoints/newtab/styles.css`, change `.page-shell`:

```css
  width: min(100%, 1760px);
  padding: clamp(12px, 1.6vw, 24px);
```

Change `.workspace-grid`:

```css
  grid-template-columns: minmax(0, 1fr) minmax(460px, 1fr);
```

Add:

```css
.saved-tab-list {
  display: grid;
  gap: 6px;
}

.saved-tab-row {
  min-width: 0;
  min-height: 34px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-sm);
  padding: 4px;
}

.saved-tab-row:hover,
.saved-tab-row:focus-visible {
  background: color-mix(in oklab, var(--accent), transparent 88%);
}

.saved-tab-favicon,
.saved-tab-fallback {
  width: 22px;
  height: 22px;
  border-radius: 6px;
}
```

In `@media (max-width: 1080px)`, keep `.workspace-grid { grid-template-columns: 1fr; }`.

- [ ] **Step 6: Run App test to verify it passes**

Run:

```bash
bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/features/i18n/i18n.ts apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "feat(newtab): show saved tab details"
```

---

### Task 7: Quick-Link Fetch UI

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `previewQuickLinkUrl(input: string)`.
- Produces add URL dialog state with `preview: { url: string; label: string; icon: { kind: 'site'; value: null } } | null`.
- Produces i18n keys: `fetchQuickLink`, `quickLinkPreview`.

- [ ] **Step 1: Write failing quick-link Fetch App test**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, add:

```ts
  it('fetches a quick-link preview from a pasted URL before saving', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'example.com/docs');
    await click(screen().getByRole('button', { name: 'Fetch' }));

    expect(screen().getByText('example.com')).not.toBeNull();
    expect(container.querySelector<HTMLImageElement>('img.quick-link-site-icon')?.getAttribute('src')).toBe(
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=32',
    );

    await change(screen().getByLabelText('Quick link label'), 'Docs');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/docs',
        label: 'Docs',
        icon: { kind: 'site', value: null },
      }),
    ]);
  });
```

Update existing add-by-URL tests so they click Fetch before Add:

```ts
    await click(screen().getByRole('button', { name: 'Fetch' }));
```

- [ ] **Step 2: Run App test to verify it fails**

Run:

```bash
bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: FAIL because Fetch button and preview state do not exist.

- [ ] **Step 3: Add i18n keys**

In `apps/extension/src/features/i18n/i18n.ts`, add English:

```ts
    fetchQuickLink: 'Fetch',
    quickLinkPreview: 'Quick link preview',
```

Add Simplified Chinese:

```ts
    fetchQuickLink: '获取',
    quickLinkPreview: '快捷链接预览',
```

- [ ] **Step 4: Update QuickLinks add dialog state**

In `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`, import the helper:

```ts
  previewQuickLinkUrl,
```

Change the `add-url` state variant:

```ts
  | {
      kind: 'add-url';
      url: string;
      label: string;
      preview: { url: string; label: string; icon: QuickLinkIcon | null } | null;
      error: string | null;
      submitting: boolean;
    }
```

Update `openAddByUrlDialog`:

```ts
    setDialog({ kind: 'add-url', url: '', label: '', preview: null, error: null, submitting: false });
```

Add:

```ts
  function fetchAddByUrlPreview() {
    if (!dialog || dialog.kind !== 'add-url') return;

    try {
      const preview = previewQuickLinkUrl(dialog.url);
      setDialog({
        ...dialog,
        label: dialog.label.trim() || preview.label,
        preview,
        error: null,
      });
    } catch (error) {
      setDialog({
        ...dialog,
        preview: null,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
      });
    }
  }
```

Update URL input `onChange` to clear stale preview:

```ts
                  setDialog((current) =>
                    current?.kind === 'add-url'
                      ? { ...current, url: nextUrl, preview: null }
                      : current,
                  );
```

Update `submitAddByUrl`:

```ts
      const preview = dialog.preview ?? previewQuickLinkUrl(dialog.url);
      await persistLinks([
        ...links,
        createQuickLink({
          url: preview.url,
          label: dialog.label || preview.label,
          icon: preview.icon,
        }),
      ]);
```

- [ ] **Step 5: Add Fetch button and preview markup**

Inside the add URL dialog, after the URL field and before the label field, add:

```tsx
            <button
              type="button"
              className="secondary-button quick-link-fetch-button"
              onClick={fetchAddByUrlPreview}
            >
              {t(locale, 'fetchQuickLink')}
            </button>
            {dialog.preview ? (
              <div className="quick-link-preview" aria-label={t(locale, 'quickLinkPreview')}>
                <QuickLinkSiteIcon
                  link={{
                    id: 'preview',
                    url: dialog.preview.url,
                    label: dialog.label || dialog.preview.label,
                    icon: { kind: 'site', value: null },
                    createdAt: new Date().toISOString(),
                  }}
                />
                <span className="tab-copy">
                  <span className="tab-title">{dialog.label || dialog.preview.label}</span>
                  <span className="tab-url">{dialog.preview.url}</span>
                </span>
              </div>
            ) : null}
```

- [ ] **Step 6: Add quick-link fetch CSS**

In `apps/extension/src/entrypoints/newtab/styles.css`, add:

```css
.quick-link-fetch-button {
  justify-self: start;
}

.quick-link-preview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-warm);
}
```

- [ ] **Step 7: Run App test to verify it passes**

Run:

```bash
bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/features/i18n/i18n.ts apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "feat(quick-links): add url fetch preview"
```

---

### Task 8: Final Integration Verification

**Files:**
- No planned file changes.

**Interfaces:**
- Consumes all tasks above.
- Produces a verified working branch with all tests and typecheck passing.

- [ ] **Step 1: Run package tests**

Run:

```bash
bun run test
```

Expected: PASS for core and extension test suites.

- [ ] **Step 2: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Build the extension**

Run:

```bash
bun run build
```

Expected: PASS and output under `apps/extension/.output/chrome-mv3`.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --stat HEAD
git diff --check
```

Expected: `git diff --check` prints no whitespace errors. The stat should only include files listed in this plan.

---

## Self-Review Notes

- Spec coverage: layout width is in Task 6; Chrome-first grouping and default sync are in Tasks 4 and 5; saved tab rows are in Task 6; quick-link Fetch is in Task 7; Gist quick-link sync is in Tasks 1 through 3.
- Placeholder scan: no deferred implementation markers are intentionally left in task steps.
- Type consistency: core `SyncedQuickLink` flows into extension quick-link helpers, then into `sync-service`; `ActiveTabsSnapshot` flows from service to messages to `ActiveWorkspace`.
