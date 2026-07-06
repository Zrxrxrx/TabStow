# New Tab V1 Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Tabstow new tab React UI to match `design/v1/index.html` while preserving existing quick links, active tabs, saved sessions, todos, appearance, language, and sync behavior.

**Architecture:** Keep the current WXT/React component boundaries and change only the new tab entrypoint. `App.tsx` becomes the v1 page shell with topbar, quick links, two-column workspace, and an `Extra` drawer. Existing feature components keep their storage/message contracts and receive visual/class changes only where needed.

**Tech Stack:** Bun workspaces, WXT, React, TypeScript, Vitest, jsdom, lucide-react, Chrome Manifest V3 extension APIs.

## Global Constraints

- Project-specific override: use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.
- Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.
- Chrome extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Treat the background entrypoint as a Manifest V3 service worker.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
- This work is a front-end layout refactor. It must not change Chrome extension permissions, add content scripts, introduce remote executable code, or move durable data out of the existing storage paths.
- The `Extra` drawer is a deliberate temporary placement for secondary utilities.

---

## File Structure

- Modify `apps/extension/src/entrypoints/newtab/App.tsx`
  - Owns the v1 page shell.
  - Adds `extraOpen` state.
  - Renders topbar actions, quick links, workspace grid, and right-side `Extra` drawer.
  - Keeps existing session loading, busy action, status, active workspace refresh, language, and locale flows.

- Modify `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`
  - Keeps existing search behavior.
  - Adds v1 keyboard hint markup and class hooks.

- Modify `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
  - Keeps existing quick-link CRUD/reorder/upload behavior.
  - Changes markup to v1 full-width panel and card grid.
  - Keeps hidden file input behavior intact.

- Modify `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
  - Keeps existing active tab behavior.
  - Changes visible structure/classes to v1 workspace panel, group filters, tab cards, and tab rows.

- Modify `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
  - Keeps existing session/sync behavior.
  - Changes visible structure/classes to v1 saved panel and session cards.
  - Removes duplicated Settings/Stow controls from this component because they move to the topbar.

- Modify `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`
  - Keeps the same props.
  - Changes group buttons to v1 pill classes.

- Modify `apps/extension/src/entrypoints/newtab/styles.css`
  - Replaces the current dashboard layout with v1 tokens, topbar, quick links, workspace grid, panels, drawer, responsive rules, and state styles.
  - Preserves theme preference hooks: `data-theme-mode`, `data-theme-palette`, `--surface-opacity`, and `--dashboard-background-image`.

- Modify `apps/extension/src/entrypoints/newtab/App.test.tsx`
  - Updates tests for v1 layout, `Extra` drawer, moved utility panels, and retained behavior.

---

### Task 1: App Shell And Extra Drawer

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes:
  - `SearchBox({ disabled?: boolean; locale: Locale; onStatus: (tone: 'success' | 'error', message: string) => void })`
  - `QuickLinks({ locale: Locale })`
  - `ActiveWorkspace({ busy: boolean; locale: Locale; onStatus: (tone: 'success' | 'error', message: string) => void; onStowCurrentWindow: () => Promise<void>; refreshKey: number })`
  - `StowedSessions({ busyAction: string | null; locale: Locale; sessions: TabSession[]; status: StatusState; onOpenOptions: () => void; onRunAction: <T>(actionId: string, action: () => Promise<AppResult<T>>, success: (data: T) => string) => Promise<void> })`
  - `TodosPanel({ locale: Locale })`
  - `ThemeControls({ language: LanguagePreference; locale: Locale; onLanguageChange: (language: LanguagePreference) => void })`
- Produces:
  - Topbar `Extra` button with accessible name `Extra`
  - Search form with `.dashboard-search` and visible keyboard hint `.kbd`
  - Drawer `<aside className="extra-drawer-backdrop is-open">` when `extraOpen === true`
  - Drawer dialog labelled by `extra-drawer-title`
  - Topbar stow button using `t(locale, 'stowCurrentWindow')` that calls the existing `runAction('stow', ...)`

- [ ] **Step 1: Add a failing layout/drawer test**

Append this test inside `describe('App', () => { ... })` in `apps/extension/src/entrypoints/newtab/App.test.tsx` after the Simplified Chinese label test:

```tsx
  it('renders the v1 shell and moves secondary utilities into the Extra drawer', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();

    expect(container.querySelector('.page-shell')).not.toBeNull();
    expect(container.querySelector('.topbar')).not.toBeNull();
    expect(container.querySelector('.workspace-grid')).not.toBeNull();
    expect(container.querySelector('.extra-drawer-backdrop')).toBeNull();
    expect(screen().getByRole('button', { name: 'Extra' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Open settings' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Stow current window' })).not.toBeNull();
    expect(screen().getByText('Example')).not.toBeNull();

    expect(screen().getByRole('heading', { name: 'Active tabs' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Stowed sessions' })).not.toBeNull();
    expect(() => screen().getByRole('heading', { name: 'Todos' })).toThrow();
    expect(() => screen().getByRole('heading', { name: 'Appearance' })).toThrow();

    await click(screen().getByRole('button', { name: 'Extra' }));

    expect(container.querySelector('.extra-drawer-backdrop.is-open')).not.toBeNull();
    expect(screen().getByRole('dialog', { name: 'Extra' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Todos' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: 'Appearance' })).not.toBeNull();

    await click(screen().getByRole('button', { name: 'Close extra drawer' }));

    expect(container.querySelector('.extra-drawer-backdrop')).toBeNull();
  });
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "renders the v1 shell"
```

Expected: FAIL because `.page-shell`, `.topbar`, `.workspace-grid`, `Extra`, and the drawer do not exist yet.

- [ ] **Step 3: Refactor `App.tsx` to the v1 shell**

Replace the `App` component body in `apps/extension/src/entrypoints/newtab/App.tsx` with this structure while keeping the existing imports. Add `Settings`, `SlidersHorizontal`, `X`, and `Archive` to a new lucide import:

```tsx
import { Archive, Settings, SlidersHorizontal, X } from 'lucide-react';
```

Add `t` to the existing i18n import:

```tsx
import {
  getLanguagePreference,
  resolveLocale,
  t,
  type LanguagePreference,
} from '@/features/i18n/i18n';
```

Inside `export function App()`, add drawer state after the language state:

```tsx
  const [extraOpen, setExtraOpen] = useState(false);
```

Add Escape-close behavior after the `document.documentElement.lang` effect:

```tsx
  useEffect(() => {
    if (!extraOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setExtraOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [extraOpen]);
```

Replace the current `return (` block with:

```tsx
  return (
    <>
      <main className="page-shell" data-od-id="newtab-shell">
        <header className="topbar" data-od-id="topbar">
          <div className="brand-lockup" data-od-id="brand-lockup">
            <div className="mark" aria-hidden="true">
              T
            </div>
            <div>
              <h1 id="tabstow-title" data-od-id="page-title">
                Tabstow
              </h1>
              <p className="subtle">Stow, organize, and restore your browser tabs.</p>
            </div>
          </div>

          <SearchBox
            disabled={busyAction !== null}
            locale={locale}
            onStatus={(tone, message) => setStatus({ tone, message })}
          />

          <div className="header-actions" data-od-id="topbar-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setExtraOpen(true)}
              aria-expanded={extraOpen}
              aria-controls="extra-drawer"
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Extra
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={openOptions}
              aria-label="Open settings"
            >
              <Settings size={16} aria-hidden="true" />
              Settings
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
                  (result) => `Stowed ${result.savedTabCount} tabs and closed ${result.closedTabCount}.`,
                )
              }
              disabled={busyAction !== null}
            >
              <Archive size={16} aria-hidden="true" />
              {t(locale, 'stowCurrentWindow')}
            </button>
          </div>
        </header>

        <QuickLinks locale={locale} />

        <section className="workspace-grid" aria-label="Tab workspace" data-od-id="workspace-grid">
          <ActiveWorkspace
            busy={busyAction !== null}
            locale={locale}
            onStatus={(tone, message) => setStatus({ tone, message })}
            refreshKey={activeWorkspaceRefreshKey}
            onStowCurrentWindow={() =>
              runAction(
                'stow',
                () =>
                  sendExtensionMessage<AppResult<StowResult>>({
                    type: 'sessions:stow-current-window',
                  }),
                (result) => `Stowed ${result.savedTabCount} tabs and closed ${result.closedTabCount}.`,
              )
            }
          />

          <StowedSessions
            busyAction={busyAction}
            locale={locale}
            onOpenOptions={openOptions}
            onRunAction={runAction}
            sessions={sessions}
            status={status}
          />
        </section>
      </main>

      {extraOpen ? (
        <aside
          className="extra-drawer-backdrop is-open"
          id="extra-drawer"
          aria-hidden="false"
          onClick={(event) => {
            if (event.target === event.currentTarget) setExtraOpen(false);
          }}
        >
          <section
            className="extra-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extra-drawer-title"
          >
            <header>
              <div>
                <h2 id="extra-drawer-title">Extra</h2>
                <p className="subtle">Secondary tools stay here while the main workspace follows the v1 layout.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close extra drawer"
                onClick={() => setExtraOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <TodosPanel locale={locale} />
            <ThemeControls language={language} locale={locale} onLanguageChange={setLanguage} />
          </section>
        </aside>
      ) : null}
    </>
  );
```

- [ ] **Step 4: Add the v1 search keyboard hint**

In `apps/extension/src/entrypoints/newtab/components/SearchBox.tsx`, add this span after the `<input ... />` element and before the closing `</form>`:

```tsx
      <span className="kbd" aria-hidden="true">
        /
      </span>
```

The final form body should be:

```tsx
    <form className="dashboard-search" onSubmit={(event) => void submit(event)}>
      <Search size={16} aria-hidden="true" />
      <input
        aria-label={t(locale, 'searchTheWeb')}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t(locale, 'searchWithDefaultEngine')}
        type="search"
        value={query}
      />
      <span className="kbd" aria-hidden="true">
        /
      </span>
    </form>
```

- [ ] **Step 5: Remove duplicate old shell classes**

Update the existing test `renders utility panels from stored quick links, todos, and theme preferences` so the todo and appearance assertions happen after opening the `Extra` drawer. Replace this block:

```tsx
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
```

with:

```tsx
    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
```

Update the existing test `renders migrated dashboard labels in Simplified Chinese when selected` so secondary utilities are asserted after opening the `Extra` drawer. Replace:

```tsx
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
```

with:

```tsx
    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(screen().getByRole('heading', { name: '待办' })).not.toBeNull();
    expect(screen().getByRole('heading', { name: '外观' })).not.toBeNull();
```

In `apps/extension/src/entrypoints/newtab/App.tsx`, make sure the old classes below no longer appear:

```tsx
<main className="newtab-shell dashboard-shell">
<section className="dashboard-topbar">
<section className="utility-grid" aria-label="Utilities">
<section className="stowed-sessions">
```

Use this check:

```bash
rg -n "newtab-shell|dashboard-shell|dashboard-topbar|utility-grid|className=\"stowed-sessions\"" apps/extension/src/entrypoints/newtab/App.tsx
```

Expected: no matches.

- [ ] **Step 6: Run the focused test**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "renders the v1 shell"
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/SearchBox.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "refactor(newtab): add v1 shell and extra drawer"
```

Expected: commit succeeds.

---

### Task 2: Quick Links V1 Panel

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes:
  - Existing `QuickLink` type from `@/features/quick-links/quick-links`
  - Existing `persistLinks(nextLinks: QuickLink[]): Promise<QuickLink[]>`
  - Existing `QuickLinkImageIcon({ token, label }: { token: string; label: string })`
- Produces:
  - `<section className="panel quick-links-panel" aria-labelledby="quick-links-title">`
  - Quick-link cards as `<div className="quick-link-card-shell">` with child `<a className="quick-link-card">`
  - Icon block class `.favicon`
  - Controls class `.quick-link-card-actions`

- [ ] **Step 1: Add a failing quick-link structure assertion**

In the existing test `renders utility panels from stored quick links, todos, and theme preferences`, after `expect(screen().getByText('Example')).not.toBeNull();`, add:

```tsx
    expect(container.querySelector('.quick-links-panel')).not.toBeNull();
    expect(container.querySelector('.quick-link-card')).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).not.toBeNull();
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "renders utility panels"
```

Expected: FAIL because current quick links use `.utility-panel` and `.quick-link`.

- [ ] **Step 3: Add local icon helpers in `QuickLinks.tsx`**

In `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`, add these helpers below `getImageIconToken`:

```tsx
function hostnameInitial(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 1).toUpperCase() || 'T';
  } catch {
    return 'T';
  }
}

function renderTextIcon(link: QuickLink) {
  if (link.icon?.kind === 'emoji') return link.icon.value;
  return hostnameInitial(link.url);
}
```

- [ ] **Step 4: Replace the quick-link section markup**

In `QuickLinks.tsx`, replace the JSX returned by `return (` with:

```tsx
    <section className="panel quick-links-panel" aria-labelledby="quick-links-title" data-od-id="quick-links-section">
      <div className="section-header">
        <div>
          <h2 id="quick-links-title" data-od-id="quick-links-title">
            {t(locale, 'quickLinks')}
          </h2>
          <p className="subtle">Custom web icons stay one click away at the top of the new tab page.</p>
        </div>
        <div className="header-actions" data-od-id="quick-link-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t(locale, 'addQuickLink')}
            onClick={() => void addByUrl()}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={() => void addFromOpenTabs()}>
            {t(locale, 'addOpenTab')}
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="empty-state utility-empty-state">{t(locale, 'noQuickLinks')}</div>
      ) : (
        <div className="quick-link-grid" data-od-id="quick-link-grid">
          {links.map((link, index) => (
            <div className="quick-link-card-shell" key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer" className="quick-link-card">
                {link.icon?.kind === 'image' ? (
                  <QuickLinkImageIcon token={link.icon.value} label={link.label} />
                ) : (
                  <span className="favicon tone-blue" aria-hidden="true">
                    {renderTextIcon(link)}
                  </span>
                )}
                <span className="quick-link-label">{link.label}</span>
              </a>
              <div className="quick-link-card-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'moveUp', { label: link.label })}
                  onClick={() => void move(link.id, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'moveDown', { label: link.label })}
                  onClick={() => void move(link.id, 1)}
                  disabled={index === links.length - 1}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'uploadQuickLinkIcon', { label: link.label })}
                  onClick={() => uploadInputRefs.current.get(link.id)?.click()}
                >
                  <ImageUp size={14} aria-hidden="true" />
                </button>
                <input
                  accept="image/*"
                  aria-label={t(locale, 'uploadQuickLinkIcon', { label: link.label })}
                  data-quick-link-upload-id={link.id}
                  hidden
                  ref={(node) => {
                    if (node) {
                      uploadInputRefs.current.set(link.id, node);
                      return;
                    }

                    uploadInputRefs.current.delete(link.id);
                  }}
                  onChange={(event) => {
                    void uploadIcon(link, event.target.files?.[0]);
                    event.target.value = '';
                  }}
                  type="file"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'editQuickLink', { label: link.label })}
                  onClick={() => void edit(link)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'removeQuickLink', { label: link.label })}
                  onClick={() => void remove(link.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {errorMessage ? (
        <p className="status-message status-message--error utility-status" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </section>
```

- [ ] **Step 5: Run quick-link behavior tests**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "quick links"
```

Expected: PASS for add/remove, edit, reorder, invalid URL, javascript URL rejection, image upload, and structure assertions.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "refactor(newtab): restyle quick links as v1 panel"
```

Expected: commit succeeds.

---

### Task 3: Active And Saved Workspace Panels

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes:
  - Existing props for `ActiveWorkspace`, `GroupNav`, and `StowedSessions`
  - Existing `getTabLabel(tab: ActiveBrowserTab): string`
  - Existing `sessionPreview(session: TabSession): string`
- Produces:
  - `ActiveWorkspace` root: `<section className="panel column active-workspace" aria-labelledby="active-tabs-title">`
  - `GroupNav` root: `<nav className="tabs-toolbar group-nav" aria-label="Active tab groups">`
  - `StowedSessions` root: `<section className="panel column saved-sessions" aria-labelledby="saved-title">`
  - Saved heading text: `Saved for later`

- [ ] **Step 1: Add failing workspace structure assertions**

In the test `renders the v1 shell and moves secondary utilities into the Extra drawer`, after the existing heading assertions for Active tabs and Saved for later, add:

```tsx
    expect(container.querySelector('.active-workspace.panel.column')).not.toBeNull();
    expect(container.querySelector('.saved-sessions.panel.column')).not.toBeNull();
    expect(container.querySelector('.meta-pill')).not.toBeNull();
```

In the test `renders Chrome group controls below the active workspace header and before the stow hint`, replace the old sibling assertions:

```tsx
    const sectionHeader = container.querySelector('.active-workspace .section-header');
    const controls = container.querySelector('.active-workspace .active-workspace-controls');
    const hint = container.querySelector('.active-workspace .active-workspace-hint');

    expect(sectionHeader?.nextElementSibling).toBe(controls);
    expect(controls?.nextElementSibling).toBe(hint);
```

with:

```tsx
    expect(container.querySelector('.active-workspace .section-header')).not.toBeNull();
    expect(container.querySelector('.active-workspace .tabs-toolbar')).not.toBeNull();
    expect(container.querySelector('.active-workspace .meta-row')).not.toBeNull();
    expect(container.querySelector('.active-workspace .active-workspace-hint')).not.toBeNull();
```

- [ ] **Step 2: Run focused workspace tests**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "v1 shell|Chrome group controls"
```

Expected: FAIL because panel/column saved classes and `Saved for later` are not implemented yet.

- [ ] **Step 3: Update `GroupNav.tsx` to v1 filter pills**

Replace the return JSX in `apps/extension/src/entrypoints/newtab/components/GroupNav.tsx` with:

```tsx
  return (
    <nav className="tabs-toolbar group-nav" aria-label="Active tab groups">
      <button className="group-filter" type="button" onClick={() => onJump(groups[0]?.key ?? '')} aria-pressed="true">
        <span>All</span>
        <strong>{groups.reduce((count, group) => count + group.tabs.length, 0)}</strong>
      </button>
      {groups.map((group) => (
        <button className="group-filter" key={group.key} type="button" onClick={() => onJump(group.key)}>
          <span>{group.title}</span>
          <strong>{group.tabs.length}</strong>
        </button>
      ))}
    </nav>
  );
```

Then adjust the empty guard at the top so the `All` button does not use an empty key:

```tsx
  if (groups.length === 0) return null;
```

This keeps the same props and scroll behavior; the `All` button jumps to the first group because the current component does not own filter state.

- [ ] **Step 4: Update `ActiveWorkspace.tsx` panel structure**

In `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`, change the root opening tag from:

```tsx
    <section className="active-workspace" aria-labelledby="active-tabs-title">
```

to:

```tsx
    <section className="panel column active-workspace" aria-labelledby="active-tabs-title" data-od-id="active-tabs-column">
```

Replace the section header block with:

```tsx
      <div className="section-header">
        <div>
          <h2 id="active-tabs-title" data-od-id="active-tabs-title">
            {t(locale, 'activeTabs')}
          </h2>
          <p className="subtle">Equivalent to open Chrome tabs, grouped by domain or manual workspace.</p>
        </div>
        <span className="meta-pill" id="active-count" data-od-id="active-tabs-count">
          {tabs.length} open
        </span>
      </div>
```

Change the controls wrapper class from:

```tsx
      <div className="active-workspace-controls">
```

to:

```tsx
      <div className="meta-row" data-od-id="active-actions">
```

Change group article class from:

```tsx
            className="active-group"
```

to:

```tsx
            className="tab-group"
```

Change active tab row wrapper class from:

```tsx
                <div className="active-tab-row" key={tab.id ?? tab.url}>
```

to:

```tsx
                <div className="tab-row" key={tab.id ?? tab.url}>
```

Change the focus button from:

```tsx
                  <button type="button" onClick={() => void focusTab(tab)}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{getTabLabel(tab)}</span>
                  </button>
```

to:

```tsx
                  <button className="tab-open-button" type="button" onClick={() => void focusTab(tab)}>
                    <span className="favicon tone-blue" aria-hidden="true">
                      {(getTabLabel(tab).match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="tab-copy">
                      <span className="tab-title">{getTabLabel(tab)}</span>
                      <span className="tab-url">{tab.url ?? ''}</span>
                    </span>
                  </button>
```

Wrap the row action buttons in:

```tsx
                  <div className="row-actions">
                    ...
                  </div>
```

Move the existing move/manual/delete action buttons inside that wrapper without changing their `onClick`, `disabled`, or `aria-label` values.

- [ ] **Step 5: Update `StowedSessions.tsx` to v1 saved panel**

In `apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx`, change the return from a fragment to a section:

```tsx
    <section className="panel column saved-sessions" aria-labelledby="saved-title" data-od-id="saved-tabs-column">
```

Replace the header and stats rows with:

```tsx
      <header className="section-header">
        <div>
          <h2 id="saved-title" data-od-id="saved-tabs-title">
            Saved for later
          </h2>
          <p className="subtle">Durable stowed sessions sorted newest first. Restoring keeps the saved copy.</p>
        </div>
        <span className="meta-row" id="saved-count" aria-label="Saved sessions and tabs count">
          <span className="meta-pill">{sessions.length} sessions</span>
          <span className="meta-pill">{totalTabs} tabs</span>
        </span>
      </header>
```

Replace the controls section with Pull and Push only:

```tsx
      <section className="session-toolbar" aria-label="Session controls" data-od-id="saved-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onRunAction<SyncResult>(
              'sync-pull',
              () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:pull' }),
              (result) => `Pulled ${result.sessionCount} sessions from Gist.`,
            )
          }
          disabled={busyAction !== null}
        >
          <RefreshCcw size={16} aria-hidden="true" />
          {t(locale, 'pull')}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void onRunAction<SyncResult>(
              'sync-push',
              () => sendExtensionMessage<AppResult<SyncResult>>({ type: 'sync:push' }),
              (result) => `Pushed ${result.sessionCount} sessions to Gist.`,
            )
          }
          disabled={busyAction !== null}
        >
          <UploadCloud size={16} aria-hidden="true" />
          {t(locale, 'push')}
        </button>
      </section>
```

Delete the old `stats-row` section from this component because counts are now pills in the header.

Change each session article class from:

```tsx
            <article className="session-row" key={session.id}>
```

to:

```tsx
            <article className="session-card" key={session.id}>
```

Change the session main wrapper from:

```tsx
              <div className="session-main">
```

to:

```tsx
              <header>
                <div className="tab-copy">
```

Use this inner session copy:

```tsx
                  <span className="session-title">{session.title}</span>
                  <span className="session-preview">
                    {formatDate(session.createdAt)} · {session.tabs.length}{' '}
                    {session.tabs.length === 1 ? 'tab' : 'tabs'}
                  </span>
                  <span className="session-preview">{sessionPreview(session)}</span>
```

Move the existing restore/delete buttons into:

```tsx
                <div className="row-actions">
                  ...
                </div>
              </header>
```

Remove unused imports `Archive` and `Settings` from `StowedSessions.tsx` after moving those controls to the topbar. Keep `RefreshCcw`, `RotateCcw`, `Trash2`, and `UploadCloud`.

Remove `onOpenOptions` from the `Props` type and from the function parameter destructuring in `StowedSessions.tsx`:

```tsx
type Props = {
  busyAction: string | null;
  locale: Locale;
  sessions: TabSession[];
  status: StatusState;
  onRunAction: <T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
  ) => Promise<void>;
};
```

```tsx
export function StowedSessions({
  busyAction,
  locale,
  onRunAction,
  sessions,
  status,
}: Props) {
```

Remove the `onOpenOptions={openOptions}` prop from the `<StowedSessions ... />` call in `App.tsx`:

```tsx
          <StowedSessions
            busyAction={busyAction}
            locale={locale}
            onRunAction={runAction}
            sessions={sessions}
            status={status}
          />
```

- [ ] **Step 6: Run focused workspace tests**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "v1 shell|Chrome group controls"
```

Expected: PASS.

- [ ] **Step 7: Run session behavior tests**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "restore|delete|sync|stow"
```

Expected: PASS for tests matching these names. If no tests match one term, Vitest reports only the matching tests it found; this is acceptable as long as matched tests pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/components/GroupNav.tsx apps/extension/src/entrypoints/newtab/components/StowedSessions.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "refactor(newtab): align workspace panels with v1"
```

Expected: commit succeeds.

---

### Task 4: V1 Styling, Responsive Rules, And Full Verification

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes:
  - Class names produced by Tasks 1-3: `.page-shell`, `.topbar`, `.brand-lockup`, `.mark`, `.panel`, `.quick-links-panel`, `.quick-link-grid`, `.quick-link-card`, `.workspace-grid`, `.column`, `.meta-pill`, `.group-filter`, `.tab-group`, `.tab-row`, `.tab-open-button`, `.session-card`, `.extra-drawer-backdrop`, `.extra-drawer`
- Produces:
  - CSS custom properties matching v1 while preserving theme preference attributes.
  - Responsive behavior at `max-width: 1080px` and `max-width: 620px`.
  - No horizontal overflow at mobile widths.

- [ ] **Step 1: Add a CSS contract test**

Append this test to `apps/extension/src/entrypoints/newtab/App.test.tsx`:

```tsx
  it('keeps v1 layout class contract stable for CSS', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });

    await renderApp();

    const requiredSelectors = [
      '.page-shell',
      '.topbar',
      '.brand-lockup',
      '.mark',
      '.quick-links-panel',
      '.workspace-grid',
      '.active-workspace.panel.column',
      '.saved-sessions.panel.column',
    ];

    for (const selector of requiredSelectors) {
      expect(container.querySelector(selector), selector).not.toBeNull();
    }

    await click(screen().getByRole('button', { name: 'Extra' }));
    expect(container.querySelector('.extra-drawer')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the CSS contract test**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx -t "keeps v1 layout class contract"
```

Expected: PASS if Tasks 1-3 are complete. If it fails, fix class names in component files before changing CSS.

- [ ] **Step 3: Replace `styles.css` with v1-compatible CSS**

Replace `apps/extension/src/entrypoints/newtab/styles.css` with this CSS:

```css
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --bg: #0b1020;
  --surface: #131b2f;
  --surface-warm: #182343;
  --fg: #f8fafc;
  --fg-2: #cbd5e1;
  --muted: #8ea0b8;
  --meta: #60a5fa;
  --border: #293653;
  --border-soft: #1e2a43;
  --accent: #60a5fa;
  --accent-on: #06111f;
  --success: #22c55e;
  --warn: #fbbf24;
  --danger: #fb7185;
  --surface-opacity: 0.96;
  --dashboard-background-image: none;
  --page-background: var(--bg);
  --text-color: var(--fg);
  --surface-rgb: 19, 27, 47;
  --muted-text: var(--muted);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-pill: 9999px;
  --elev-ring: 0 0 0 1px var(--border);
  --elev-raised: 0 24px 72px rgba(0, 0, 0, 0.36);
  --focus-ring: 0 0 0 4px rgba(96, 165, 250, 0.28);
  background: var(--page-background);
  color: var(--text-color);
}

* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  background: var(--page-background);
}

body {
  background:
    var(--dashboard-background-image) center / cover no-repeat fixed,
    radial-gradient(circle at top left, color-mix(in oklab, var(--accent), transparent 82%), transparent 32%),
    radial-gradient(circle at 82% 12%, color-mix(in oklab, var(--surface-warm), transparent 26%), transparent 30%),
    var(--page-background);
  color: var(--text-color);
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

button,
input,
select {
  font: inherit;
}

button {
  border: 0;
  border-radius: var(--radius-md);
  min-height: 38px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: inherit;
  cursor: pointer;
  transition:
    transform 130ms cubic-bezier(0.2, 0, 0, 1),
    background 130ms cubic-bezier(0.2, 0, 0, 1),
    border-color 130ms cubic-bezier(0.2, 0, 0, 1);
}

button:active {
  transform: translateY(1px);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
a:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: clamp(32px, 3.2vw, 48px);
  line-height: 1.06;
  font-weight: 600;
}

h2 {
  font-size: 22px;
  line-height: 1.2;
  font-weight: 590;
}

h3 {
  font-size: 15px;
  line-height: 1.25;
  font-weight: 590;
}

.subtle {
  color: var(--muted);
  font-size: 13px;
}

.page-shell {
  width: min(100%, 1440px);
  min-height: 100vh;
  margin: 0 auto;
  padding: clamp(16px, 2.4vw, 32px);
  display: grid;
  gap: 18px;
}

.topbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(260px, 440px) auto;
  gap: 16px;
  align-items: center;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.mark {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  color: var(--accent-on);
  background: var(--accent);
  font-weight: 590;
  font-size: 18px;
  box-shadow: var(--elev-ring);
}

.dashboard-search {
  min-height: 44px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  background: color-mix(in oklab, var(--surface), transparent 4%);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.dashboard-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
}

.kbd {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 6px;
  color: var(--muted);
  font: 12px/1.3 "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  background: var(--bg);
}

.header-actions,
.row-actions,
.meta-row,
.tabs-toolbar,
.session-toolbar,
.utility-panel-actions,
.todo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.header-actions {
  justify-content: flex-end;
}

.primary-button {
  background: var(--accent);
  color: var(--accent-on);
}

.secondary-button,
.icon-button {
  background: var(--surface);
  border: 1px solid var(--border);
}

.danger-button {
  color: var(--danger);
  background: color-mix(in oklab, var(--danger), transparent 84%);
  border: 1px solid color-mix(in oklab, var(--danger), var(--border) 70%);
}

.icon-button {
  width: 38px;
  padding: 0;
}

.panel,
.utility-panel {
  background: color-mix(in oklab, rgba(var(--surface-rgb), var(--surface-opacity)), var(--bg) 14%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-ring);
}

.quick-links-panel {
  padding: 14px;
  display: grid;
  gap: 12px;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

.quick-link-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(90px, 1fr));
  gap: 8px;
}

.quick-link-card-shell {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.quick-link-card {
  min-width: 0;
  min-height: 78px;
  padding: 10px;
  display: grid;
  gap: 7px;
  align-content: center;
  justify-items: center;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.quick-link-card:hover {
  border-color: var(--accent);
  background: color-mix(in oklab, var(--accent), transparent 88%);
}

.quick-link-card-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}

.favicon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: var(--accent-on);
  font-size: 13px;
  font-weight: 590;
  background: var(--meta);
  box-shadow: var(--elev-ring);
  flex: 0 0 auto;
}

.tone-blue { background: var(--accent); }
.tone-green { background: var(--success); }
.tone-red { background: var(--danger); }
.tone-gold { background: var(--warn); }
.tone-slate { background: var(--fg-2); }

.quick-link-label {
  width: 100%;
  overflow: hidden;
  color: var(--fg);
  font-size: 13px;
  font-weight: 510;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-link-image-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  object-fit: cover;
  box-shadow: var(--elev-ring);
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 18px;
  align-items: start;
}

.column {
  min-width: 0;
  display: grid;
  gap: 12px;
  padding: 14px;
}

.meta-pill,
.group-filter,
.status-pill {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-pill);
  padding: 0 10px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 510;
}

.group-filter {
  cursor: pointer;
}

.group-filter[aria-pressed="true"] {
  color: var(--accent-on);
  background: var(--accent);
  border-color: var(--accent);
}

.active-workspace-hint {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px;
}

.active-workspace-hint p {
  color: var(--muted);
}

.active-group-list,
.tab-groups,
.session-list,
.active-tab-list,
.tab-list,
.todo-list,
.compact-controls {
  display: grid;
  gap: 10px;
}

.tab-group,
.session-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.tab-group header,
.session-card header,
.active-group header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.tab-row {
  min-height: 50px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--surface-warm), var(--surface) 46%);
}

.tab-open-button {
  min-width: 0;
  min-height: 34px;
  padding: 0;
  justify-content: flex-start;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  background: transparent;
  border-radius: 6px;
  text-align: left;
}

.tab-open-button:hover,
.tab-open-button:focus-visible {
  background: color-mix(in oklab, var(--accent), transparent 88%);
  outline: 1px solid var(--accent);
  outline-offset: 3px;
}

.tab-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.tab-title,
.session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 510;
}

.tab-url,
.session-preview {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  min-height: 132px;
  display: grid;
  place-items: center;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  text-align: center;
  padding: 18px;
}

.status-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--radius-md);
}

.status-message--info {
  background: color-mix(in oklab, var(--accent), transparent 84%);
  color: var(--fg);
}

.status-message--success {
  background: color-mix(in oklab, var(--success), transparent 84%);
  color: var(--fg);
}

.status-message--error {
  background: color-mix(in oklab, var(--danger), transparent 84%);
  color: var(--fg);
}

.utility-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.utility-panel header,
.todo-row {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.utility-panel h2 {
  font-size: 17px;
}

.utility-input,
.utility-field select,
.utility-field input[type="file"] {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: inherit;
  min-height: 38px;
  padding: 0 12px;
}

.todo-row {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  background: var(--surface);
}

.todo-copy {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.todo-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-row--completed .todo-copy span {
  color: var(--muted);
  text-decoration: line-through;
}

.utility-field {
  display: grid;
  gap: 6px;
}

.utility-field span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 510;
  text-transform: uppercase;
}

.extra-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in oklab, var(--bg), transparent 18%);
  backdrop-filter: blur(3px);
}

.extra-drawer {
  width: min(100%, 430px);
  height: 100%;
  overflow: auto;
  padding: 18px;
  display: grid;
  align-content: start;
  gap: 14px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: var(--elev-raised);
}

.extra-drawer > header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

:root[data-theme-mode="light"] {
  color-scheme: light;
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-warm: #f6f8fb;
  --fg: #111827;
  --fg-2: #334155;
  --muted: #64748b;
  --meta: #2563eb;
  --border: #d8e0ec;
  --border-soft: #e7ecf4;
  --accent: #2563eb;
  --accent-on: #ffffff;
  --success: #16a34a;
  --warn: #d97706;
  --danger: #dc2626;
  --page-background: var(--bg);
  --text-color: var(--fg);
  --surface-rgb: 255, 255, 255;
}

:root[data-theme-mode="dark"] {
  color-scheme: dark;
}

:root[data-theme-mode="system"] {
  color-scheme: light dark;
}

@media (prefers-color-scheme: light) {
  :root[data-theme-mode="system"] {
    --bg: #ffffff;
    --surface: #ffffff;
    --surface-warm: #f6f8fb;
    --fg: #111827;
    --fg-2: #334155;
    --muted: #64748b;
    --meta: #2563eb;
    --border: #d8e0ec;
    --border-soft: #e7ecf4;
    --accent: #2563eb;
    --accent-on: #ffffff;
    --success: #16a34a;
    --warn: #d97706;
    --danger: #dc2626;
    --page-background: var(--bg);
    --text-color: var(--fg);
    --surface-rgb: 255, 255, 255;
  }
}

:root[data-theme-palette="sage"] {
  --accent: #5f9f78;
  --meta: #5f9f78;
}

:root[data-theme-palette="mist"] {
  --accent: #60a5fa;
  --meta: #60a5fa;
}

:root[data-theme-palette="blush"] {
  --accent: #fb7185;
  --meta: #fb7185;
}

@media (max-width: 1080px) {
  .topbar,
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .topbar {
    align-items: stretch;
  }

  .header-actions {
    justify-content: flex-start;
  }

  .quick-link-grid {
    grid-template-columns: repeat(4, minmax(90px, 1fr));
  }
}

@media (max-width: 620px) {
  .page-shell {
    padding: 12px;
  }

  .quick-link-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .tab-row,
  .session-card header {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-actions,
  .session-card header > .row-actions {
    justify-content: flex-start;
  }

  .section-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .active-workspace-hint {
    align-items: flex-start;
    flex-direction: column;
  }

  .extra-drawer {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run full new tab tests**

Run:

```bash
bun run --cwd apps/extension test App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run all extension tests**

Run:

```bash
bun run --cwd apps/extension test
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Build the extension**

Run:

```bash
bun run build
```

Expected: PASS and WXT writes the extension build output under `apps/extension/.output`.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/entrypoints/newtab/App.test.tsx
git commit -m "refactor(newtab): apply v1 visual system"
```

Expected: commit succeeds.

---

## Final Verification

- [ ] Run the complete repository test suite:

```bash
bun run test
```

Expected: PASS.

- [ ] Run the complete repository typecheck:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] Inspect final diff:

```bash
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- apps/extension/src/entrypoints/newtab
```

Expected: Diff is limited to the new tab implementation and tests, with no manifest permission changes.

## Self-Review Notes

- Spec coverage: Tasks 1-4 cover the v1 shell, full-width quick links, two-column active/saved workspace, `Extra` drawer, preserved data flows, responsive CSS, accessibility hooks, and test/typecheck/build verification.
- No unresolved markers are intentionally present.
- Type consistency: Component prop signatures remain unchanged except internal `App.tsx` state; no new exported interfaces are required.
