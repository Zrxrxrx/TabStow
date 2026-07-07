# Top Bar Language, Theme, And Quick Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add top-bar English/Chinese and light/dark SVG-icon switches, remove system theme from new tab preferences, show default quick-link favicons, hide quick-link edit controls behind edit mode, and remove the duplicate active workspace stow hint.

**Architecture:** Keep state ownership in the existing new tab React tree: `App` owns language and top-bar controls, `useThemePreferencesController` owns theme persistence/application, and `QuickLinks` owns local show/edit mode. Use Chrome's extension favicon URL with the `favicon` permission instead of broad host permissions or page scraping.

**Tech Stack:** React, TypeScript, WXT, Chrome Manifest V3, lucide-react SVG icons, Vitest/jsdom, Bun scripts.

## Global Constraints

- Project-specific override: use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.
- Browser-extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
- Use lucide-react SVG icons for the top-bar language and theme switches.
- Keep visible language choices to English and Simplified Chinese.
- Keep visible theme choices to light and dark only.
- Commit messages must use `type(scope): msg`.

---

## File Structure

- Modify `apps/extension/src/features/theme/theme-preferences.ts`
  - Narrow new-tab theme mode to `light | dark`.
  - Normalize legacy `system` and invalid values to `light`.

- Modify `apps/extension/src/features/theme/theme-preferences.test.ts`
  - Cover legacy `system` normalization and new default `light` behavior.

- Modify `apps/extension/src/features/i18n/i18n.ts`
  - Add labels for top-bar switch controls and quick-link mode.
  - Keep legacy `auto` language normalization for reads, but UI will not save or display `auto`.

- Modify `apps/extension/src/features/i18n/i18n.test.ts`
  - Cover new labels and visible language constraints.

- Modify `apps/extension/wxt.config.ts`
  - Add the `favicon` permission only.

- Modify `apps/extension/src/tests/manifest.test.ts`
  - Assert `favicon` is approved and host permissions remain narrow.

- Modify `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`
  - Remove `system` and `auto` options from the Appearance panel.
  - Keep applying `data-theme-mode` to `document.documentElement`.

- Modify `apps/extension/src/entrypoints/newtab/App.tsx`
  - Add top-bar language and theme icon switch buttons.
  - Use `Languages`, `Sun`, and `Moon` from `lucide-react`.
  - Stop passing `onStowCurrentWindow` to `ActiveWorkspace`.

- Modify `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
  - Add local `editing` state.
  - Add Chrome favicon rendering and fallback initials for `site`/`null` icons.
  - Hide add/open-tab and card edit controls until edit mode is enabled.

- Modify `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
  - Remove `onStowCurrentWindow` prop and the `.active-workspace-hint` markup.

- Modify `apps/extension/src/entrypoints/newtab/styles.css`
  - Add compact top-bar preference switch styles.
  - Add quick-link favicon image styles.
  - Remove `.active-workspace-hint` styles.
  - Remove unused system-theme CSS.

- Modify `apps/extension/src/entrypoints/newtab/App.test.tsx`
  - Update integration tests for top-bar switches, quick-link modes, favicons, and hint removal.

---

### Task 1: Theme, I18n, And Manifest Foundations

**Files:**
- Modify: `apps/extension/src/features/theme/theme-preferences.ts`
- Modify: `apps/extension/src/features/theme/theme-preferences.test.ts`
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`
- Modify: `apps/extension/wxt.config.ts`
- Modify: `apps/extension/src/tests/manifest.test.ts`

**Interfaces:**
- Produces: `ThemeMode = 'light' | 'dark'`.
- Produces: `normalizeThemePreferences(input): ThemePreferences` returns `mode: 'light'` for `system`, invalid, missing, or null input.
- Produces i18n keys: `switchLanguage`, `switchTheme`, `editQuickLinksMode`, `showQuickLinksMode`, `lightMode`, `darkMode`.
- Consumed by later tasks: `ThemeControls`, `App`, and `QuickLinks` use these types and message keys.

- [ ] **Step 1: Write failing theme preference tests**

Replace the mode expectations in `apps/extension/src/features/theme/theme-preferences.test.ts` so invalid and legacy system values normalize to `light`:

```ts
  it('loads normalized theme preferences from storage', async () => {
    storageMocks.getItem.mockResolvedValue({
      mode: 'twilight',
      paletteId: 'dawn',
      surfaceOpacity: '12',
      customBackground: 'data:image/png;base64,abc',
    });

    const { getThemePreferences } = await import('./theme-preferences');

    await expect(getThemePreferences()).resolves.toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 35,
      customBackground: null,
    });
  });

  it('normalizes legacy system theme mode to light', async () => {
    const { normalizeThemePreferences } = await import('./theme-preferences');

    expect(normalizeThemePreferences({ mode: 'system' as never }).mode).toBe('light');
  });
```

Also update the existing `rejects persisted raw data urls for custom backgrounds` expectation to:

```ts
    expect(
      normalizeThemePreferences({
        customBackground: 'data:image/png;base64,abc',
      }),
    ).toEqual({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
```

- [ ] **Step 2: Run theme tests to verify they fail**

Run:

```bash
rtk bun --cwd apps/extension run test src/features/theme/theme-preferences.test.ts
```

Expected: FAIL because `normalizeMode` still returns `system`.

- [ ] **Step 3: Implement light/dark theme normalization**

In `apps/extension/src/features/theme/theme-preferences.ts`, change the mode constants and type to:

```ts
const VALID_MODES = new Set(['light', 'dark']);

export type ThemeMode = 'light' | 'dark';
```

Replace `normalizeMode` with:

```ts
function normalizeMode(value: unknown): ThemeMode {
  return typeof value === 'string' && VALID_MODES.has(value) ? (value as ThemeMode) : 'light';
}
```

- [ ] **Step 4: Run theme tests to verify they pass**

Run:

```bash
rtk bun --cwd apps/extension run test src/features/theme/theme-preferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing i18n tests for new labels**

Append these assertions to `includes Simplified Chinese labels for migrated dashboard surfaces` in `apps/extension/src/features/i18n/i18n.test.ts`:

```ts
    expect(t('zh-CN', 'switchLanguage')).toBe('切换语言');
    expect(t('zh-CN', 'switchTheme')).toBe('切换主题');
    expect(t('zh-CN', 'editQuickLinksMode')).toBe('编辑快捷链接');
    expect(t('zh-CN', 'showQuickLinksMode')).toBe('显示快捷链接');
    expect(t('zh-CN', 'lightMode')).toBe('浅色模式');
    expect(t('zh-CN', 'darkMode')).toBe('深色模式');
```

Add these English assertions to `falls back to English messages`:

```ts
    expect(t('en', 'switchLanguage')).toBe('Switch language');
    expect(t('en', 'switchTheme')).toBe('Switch theme');
    expect(t('en', 'editQuickLinksMode')).toBe('Edit quick links');
    expect(t('en', 'showQuickLinksMode')).toBe('Show quick links');
    expect(t('en', 'lightMode')).toBe('Light mode');
    expect(t('en', 'darkMode')).toBe('Dark mode');
```

- [ ] **Step 6: Run i18n tests to verify they fail**

Run:

```bash
rtk bun --cwd apps/extension run test src/features/i18n/i18n.test.ts
```

Expected: FAIL because the new message keys are missing.

- [ ] **Step 7: Add i18n message keys**

In `apps/extension/src/features/i18n/i18n.ts`, add these keys to the English `messages.en` object:

```ts
    darkMode: 'Dark mode',
    editQuickLinksMode: 'Edit quick links',
    lightMode: 'Light mode',
    showQuickLinksMode: 'Show quick links',
    switchLanguage: 'Switch language',
    switchTheme: 'Switch theme',
```

Add these keys to the Simplified Chinese `messages['zh-CN']` object:

```ts
    darkMode: '深色模式',
    editQuickLinksMode: '编辑快捷链接',
    lightMode: '浅色模式',
    showQuickLinksMode: '显示快捷链接',
    switchLanguage: '切换语言',
    switchTheme: '切换主题',
```

Keep `LanguagePreference = 'auto' | 'en' | 'zh-CN'` so legacy stored `auto` values still load safely. Later UI changes must not render or save `auto`.

- [ ] **Step 8: Run i18n tests to verify they pass**

Run:

```bash
rtk bun --cwd apps/extension run test src/features/i18n/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write failing manifest test for favicon permission**

In `apps/extension/src/tests/manifest.test.ts`, update the permissions assertion to:

```ts
  it('uses the approved permissions for this migration', () => {
    expect(manifest?.permissions).toEqual(
      expect.arrayContaining(['tabs', 'storage', 'contextMenus', 'tabGroups', 'search', 'favicon']),
    );
    expect(manifest?.permissions).not.toContain('clipboardRead');
  });
```

Extend the `manifest` type near the top so host permissions can be checked:

```ts
const manifest = config.manifest as
  | {
      action?: {
        default_title?: string;
        default_popup?: unknown;
      };
      permissions?: string[];
      host_permissions?: string[];
    }
  | undefined;
```

Add this test:

```ts
  it('keeps host permissions narrow while enabling Chrome favicon resolution', () => {
    expect(manifest?.host_permissions).toEqual([
      'https://api.github.com/*',
      'https://gist.githubusercontent.com/*',
    ]);
  });
```

- [ ] **Step 10: Run manifest test to verify it fails**

Run:

```bash
rtk bun --cwd apps/extension run test src/tests/manifest.test.ts
```

Expected: FAIL because `favicon` is not in `permissions`.

- [ ] **Step 11: Add the favicon permission**

In `apps/extension/wxt.config.ts`, update the `permissions` array:

```ts
    permissions: ['tabs', 'storage', 'contextMenus', 'tabGroups', 'search', 'favicon'],
```

Do not change `host_permissions`.

- [ ] **Step 12: Run foundation tests**

Run:

```bash
rtk bun --cwd apps/extension run test src/features/theme/theme-preferences.test.ts src/features/i18n/i18n.test.ts src/tests/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 13: Commit foundation changes**

Run:

```bash
rtk git add apps/extension/src/features/theme/theme-preferences.ts apps/extension/src/features/theme/theme-preferences.test.ts apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts apps/extension/wxt.config.ts apps/extension/src/tests/manifest.test.ts
rtk git commit -m "feat(newtab): simplify theme and favicon permissions"
```

Expected: commit succeeds.

---

### Task 2: Top-Bar Language And Theme Switches

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `ThemeMode = 'light' | 'dark'` from Task 1.
- Consumes: i18n keys `switchLanguage`, `switchTheme`, `lightMode`, `darkMode`.
- Produces: top-bar buttons with `aria-label="Switch language"` and `aria-label="Switch theme"`.
- Produces: Appearance panel language select with only `en` and `zh-CN`.
- Produces: Appearance panel theme select with only `light` and `dark`.

- [ ] **Step 1: Write failing App integration test for top-bar switches**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, add this test after `renders utility panels from stored quick links, todos, and theme preferences`:

```tsx
  it('renders top-bar language and light-dark switches without auto or system choices', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getLanguagePreference.mockResolvedValue('en');
    getThemePreferences.mockResolvedValue({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
    saveLanguagePreference.mockImplementation(async (language: unknown) => language);
    saveThemePreferences.mockImplementation(async (preferences: unknown) => ({
      mode: (preferences as { mode: 'light' | 'dark' }).mode,
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    }));

    await renderApp();

    const languageSwitch = screen().getByRole('button', { name: 'Switch language' });
    const themeSwitch = screen().getByRole('button', { name: 'Switch theme' });
    expect(languageSwitch.querySelector('svg')).not.toBeNull();
    expect(themeSwitch.querySelector('svg')).not.toBeNull();
    expect(languageSwitch.textContent).toContain('English');
    expect(themeSwitch.textContent).toContain('Light');

    await click(languageSwitch);
    expect(saveLanguagePreference).toHaveBeenCalledWith('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(languageSwitch.textContent).toContain('简体中文');

    await click(themeSwitch);
    expect(saveThemePreferences).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dark' }));
    expect(document.documentElement.dataset.themeMode).toBe('dark');

    await click(screen().getByRole('button', { name: 'Extra' }));
    const languageSelect = screen().getByLabelText('语言');
    const themeSelect = screen().getByLabelText('主题模式');
    expect(Array.from(languageSelect.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'en',
      'zh-CN',
    ]);
    expect(Array.from(themeSelect.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'light',
      'dark',
    ]);
    expect(container.textContent).not.toContain('Auto');
    expect(container.textContent).not.toContain('System');
  });
```

- [ ] **Step 2: Run the new App test to verify it fails**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "renders top-bar language"
```

Expected: FAIL because the top-bar switch buttons do not exist and Appearance still contains `auto`/`system`.

- [ ] **Step 3: Expose reusable theme update state from the controller**

In `apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx`, keep the existing `useThemePreferencesController` return shape but make sure `updateTheme` and `theme` remain returned:

```ts
  return {
    errorMessage,
    theme,
    updateBackground,
    updateTheme,
  };
```

No new hook is required. `App` will use `themeControls.theme` and `themeControls.updateTheme`.

- [ ] **Step 4: Remove system and auto from Appearance panel controls**

In `ThemeControls`, replace the theme mode select options with:

```tsx
            <option value="light">{t(locale, 'light')}</option>
            <option value="dark">{t(locale, 'dark')}</option>
```

Replace the language select `value` and options with:

```tsx
            value={language === 'auto' ? locale : language}
            onChange={(event) => void updateLanguage(event.target.value as LanguagePreference)}
          >
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
```

Keep `updateLanguage` unchanged:

```ts
  async function updateLanguage(nextLanguage: LanguagePreference) {
    const saved = await saveLanguagePreference(nextLanguage);
    onLanguageChange(saved);
  }
```

- [ ] **Step 5: Add top-bar switch imports and handlers**

In `apps/extension/src/entrypoints/newtab/App.tsx`, update imports:

```tsx
import { Archive, Languages, Moon, Settings, SlidersHorizontal, Sun, X } from 'lucide-react';
```

Also import `saveLanguagePreference`:

```tsx
  getLanguagePreference,
  resolveLocale,
  saveLanguagePreference,
  t,
  type LanguagePreference,
```

Add these helpers inside `App`, after `openOptions`:

```tsx
  async function updateLanguage(nextLanguage: Exclude<LanguagePreference, 'auto'>) {
    const saved = await saveLanguagePreference(nextLanguage);
    setLanguage(saved);
  }

  async function toggleLanguage() {
    await updateLanguage(locale === 'en' ? 'zh-CN' : 'en');
  }

  async function toggleTheme() {
    const currentMode = themeControls.theme?.mode ?? 'light';
    await themeControls.updateTheme({ mode: currentMode === 'dark' ? 'light' : 'dark' });
  }

  const currentThemeMode = themeControls.theme?.mode ?? 'light';
  const currentLanguageLabel = locale === 'zh-CN' ? '简体中文' : 'English';
  const currentThemeLabel = currentThemeMode === 'dark' ? t(locale, 'dark') : t(locale, 'light');
```

- [ ] **Step 6: Render SVG-icon switches in the top bar**

In the `.header-actions` block in `App.tsx`, add these buttons before `Extra`:

```tsx
            <button
              type="button"
              className="preference-switch"
              onClick={() => void toggleLanguage()}
              aria-label={t(locale, 'switchLanguage')}
            >
              <Languages size={16} aria-hidden="true" />
              <span>{currentLanguageLabel}</span>
            </button>
            <button
              type="button"
              className="preference-switch"
              onClick={() => void toggleTheme()}
              aria-label={t(locale, 'switchTheme')}
              disabled={!themeControls.theme}
            >
              {currentThemeMode === 'dark' ? (
                <Moon size={16} aria-hidden="true" />
              ) : (
                <Sun size={16} aria-hidden="true" />
              )}
              <span>{currentThemeLabel}</span>
            </button>
```

Keep the existing `Extra`, `Settings`, and primary stow buttons after these switches.

- [ ] **Step 7: Add switch styles**

In `apps/extension/src/entrypoints/newtab/styles.css`, add `.preference-switch` beside the button styles:

```css
.preference-switch {
  min-height: 38px;
  padding: 0 10px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.preference-switch span {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Keep `.header-actions` flex wrapping as-is so the switches wrap on narrow widths instead of overlapping.

- [ ] **Step 8: Remove system CSS mode**

In `apps/extension/src/entrypoints/newtab/styles.css`, delete these blocks:

```css
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
```

Keep `:root[data-theme-mode="light"]` and `:root[data-theme-mode="dark"]`.

- [ ] **Step 9: Update tests that still mock system theme**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, change default and unrelated mocks from `mode: 'system'` to `mode: 'light'`, except tests that intentionally pass legacy system as `mode: 'system' as never`.

Use this default in `beforeEach`:

```ts
    getThemePreferences.mockResolvedValue({
      mode: 'light',
      paletteId: 'paper',
      surfaceOpacity: 92,
      customBackground: null,
    });
```

Update `saveThemePreferences` mocks that return `mode: 'system'` to return `mode: 'light'`.

- [ ] **Step 10: Run App tests for top-bar switches**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "renders top-bar language"
```

Expected: PASS.

- [ ] **Step 11: Run full new tab App tests**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Commit top-bar switch changes**

Run:

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "feat(newtab): add topbar language and theme switches"
```

Expected: commit succeeds.

---

### Task 3: Quick-Link Favicons And Show/Edit Mode

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `editQuickLinksMode` and `showQuickLinksMode` i18n keys from Task 1.
- Produces: `getFaviconUrl(url: string): string | null` internal helper.
- Produces: `QuickLinkSiteIcon({ link }: { link: QuickLink })` internal component.
- Produces: `.quick-link-site-icon` image class.
- Produces: quick-link header edit toggle button with `aria-label="Edit quick links"` in show mode and `aria-label="Show quick links"` in edit mode.

- [ ] **Step 1: Add Chrome runtime mock for favicon tests**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, add a hoisted runtime mock near the existing hoisted mocks:

```ts
const { chromeRuntimeMocks } = vi.hoisted(() => ({
  chromeRuntimeMocks: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
    openOptionsPage: vi.fn(),
  },
}));
```

In `beforeEach`, after `document.documentElement.style.removeProperty('--dashboard-background-image');`, add:

```ts
    chromeRuntimeMocks.getURL.mockClear();
    chromeRuntimeMocks.openOptionsPage.mockClear();
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: chromeRuntimeMocks,
      },
    });
```

This preserves the existing settings button behavior while giving favicon code a deterministic `chrome.runtime.getURL`.

- [ ] **Step 2: Write failing test for show/edit mode**

Add this test near the existing quick-link tests:

```tsx
  it('keeps quick-link editing controls hidden until edit mode is enabled', async () => {
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

    expect(screen().getByText('Example')).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).toBeNull();
    expect(() => screen().getByLabelText('Add quick link')).toThrow();

    await click(screen().getByRole('button', { name: 'Edit quick links' }));

    expect(screen().getByLabelText('Add quick link')).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Add open tab' })).not.toBeNull();
    expect(container.querySelector('.quick-link-card-actions')).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Show quick links' })).not.toBeNull();
  });
```

- [ ] **Step 3: Write failing test for default favicon and fallback**

Add this test near the quick-link image upload test:

```tsx
  it('renders Chrome default favicons for site quick links and falls back to initials on image error', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    getQuickLinks.mockResolvedValue([
      {
        id: 'link-1',
        url: 'https://example.com/docs',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);

    await renderApp();

    const favicon = container.querySelector<HTMLImageElement>('img.quick-link-site-icon');
    expect(favicon).not.toBeNull();
    expect(favicon?.getAttribute('src')).toBe(
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=32',
    );

    await act(async () => {
      favicon?.dispatchEvent(new Event('error', { bubbles: true }));
    });

    expect(container.querySelector('img.quick-link-site-icon')).toBeNull();
    expect(screen().getByText('E')).not.toBeNull();
  });
```

- [ ] **Step 4: Run quick-link tests to verify they fail**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "quick-link"
```

Expected: FAIL because quick-link controls are always visible, edit toggle is missing, and favicon images are not rendered.

- [ ] **Step 5: Add favicon helper and site icon component**

In `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`, add `PencilLine` to the lucide import:

```tsx
import { ChevronDown, ChevronUp, ImageUp, Pencil, PencilLine, Plus, Trash2 } from 'lucide-react';
```

Add this helper above `QuickLinkImageIcon`:

```tsx
function getFaviconUrl(url: string): string | null {
  try {
    const pageUrl = new URL(url);
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') return null;
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.getURL !== 'function') return null;

    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl.toString())}&size=32`);
  } catch {
    return null;
  }
}
```

Add this component below `QuickLinkImageIcon`:

```tsx
function QuickLinkSiteIcon({ link }: { link: QuickLink }) {
  const [failed, setFailed] = useState(false);
  const faviconUrl = failed ? null : getFaviconUrl(link.url);

  useEffect(() => {
    setFailed(false);
  }, [link.url]);

  if (!faviconUrl) {
    return (
      <span className="favicon tone-blue" aria-hidden="true">
        {renderTextIcon(link)}
      </span>
    );
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="quick-link-site-icon"
      onError={() => setFailed(true)}
      src={faviconUrl}
      title={link.label}
    />
  );
}
```

- [ ] **Step 6: Add quick-link edit state and header toggle**

Inside `QuickLinks`, add state near the existing `dialog` state:

```tsx
  const [editing, setEditing] = useState(false);
```

In the quick-link section header, replace the existing header actions block with:

```tsx
        <div className="header-actions" data-od-id="quick-link-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={editing ? t(locale, 'showQuickLinksMode') : t(locale, 'editQuickLinksMode')}
            aria-pressed={editing}
            onClick={() => setEditing((value) => !value)}
          >
            <PencilLine size={16} aria-hidden="true" />
          </button>
          {editing ? (
            <>
              <button
                type="button"
                className="icon-button"
                aria-label={t(locale, 'addQuickLink')}
                onClick={openAddByUrlDialog}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <button type="button" className="secondary-button" onClick={() => void openOpenTabsDialog()}>
                {t(locale, 'addOpenTab')}
              </button>
            </>
          ) : null}
        </div>
```

- [ ] **Step 7: Render favicon/site icon and hide per-card actions in show mode**

In the card render branch, replace the icon rendering block with:

```tsx
                {link.icon?.kind === 'image' ? (
                  <QuickLinkImageIcon token={link.icon.value} label={link.label} />
                ) : link.icon?.kind === 'emoji' ? (
                  <span className="favicon tone-blue" aria-hidden="true">
                    {renderTextIcon(link)}
                  </span>
                ) : (
                  <QuickLinkSiteIcon link={link} />
                )}
```

Wrap the existing `.quick-link-card-actions` block with:

```tsx
              {editing ? (
                <div className="quick-link-card-actions">
                  ...
                </div>
              ) : null}
```

Move the existing hidden file input inside the `editing ? ... : null` block so upload inputs are not in the show-mode DOM.

- [ ] **Step 8: Preserve existing edit behavior and image icons**

Do not change `openEditDialog`, `submitEdit`, `uploadIcon`, `remove`, or `move` in this task except for moving the rendered buttons into the edit-mode block. The existing tests for add, edit, reorder, delete, and upload should be updated to click `Edit quick links` before using edit controls.

For each existing test that calls one of these controls while in show mode, insert this line after `await renderApp();` and before the first quick-link edit action:

```ts
    await click(screen().getByRole('button', { name: 'Edit quick links' }));
```

Apply this to tests whose first action is:

```ts
screen().getByLabelText('Add quick link')
screen().getByRole('button', { name: 'Add open tab' })
screen().getByLabelText('Edit Example')
screen().getByLabelText('Move B up')
screen().getByLabelText('Remove Example')
container.querySelector<HTMLInputElement>('input[data-quick-link-upload-id="link-1"]')
```

- [ ] **Step 9: Add favicon CSS**

In `apps/extension/src/entrypoints/newtab/styles.css`, update the image icon selector:

```css
.quick-link-image-icon,
.quick-link-site-icon {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  object-fit: cover;
  box-shadow: var(--elev-ring);
}
```

Remove the old standalone `.quick-link-image-icon` block after replacing it.

- [ ] **Step 10: Run focused quick-link tests**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "quick-link"
```

Expected: PASS for quick-link-focused tests.

- [ ] **Step 11: Run full App tests and fix only quick-link regressions from this task**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx
```

Expected: failures, if any, should be in tests still assuming quick-link edit controls exist before edit mode. Add the `Edit quick links` click to those tests only.

- [ ] **Step 12: Commit quick-link changes**

Run:

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "feat(newtab): add quick link favicons and edit mode"
```

Expected: commit succeeds.

---

### Task 4: Remove Active Workspace Hint

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Removes: `onStowCurrentWindow` prop from `ActiveWorkspace`.
- Removes: `.active-workspace-hint` markup and styles.
- Preserves: top-right `Stow current window` button in `App`.

- [ ] **Step 1: Update failing test expectations**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, rename this test:

```ts
  it('renders Chrome group controls below the active workspace header without a duplicate stow hint', async () => {
```

Inside that test, replace:

```ts
    expect(screen().getByText('Stow this window')).not.toBeNull();
```

with:

```ts
    expect(() => screen().getByText('Stow this window')).toThrow();
```

Replace:

```ts
    expect(container.querySelector('.active-workspace .active-workspace-hint')).not.toBeNull();
```

with:

```ts
    expect(container.querySelector('.active-workspace .active-workspace-hint')).toBeNull();
```

Remove or update this expectation in `disables active workspace stow while another app action is busy`:

```ts
    expect(screen().getByText('Stow this window')).toHaveProperty('disabled', true);
```

Replace it with:

```ts
    expect(() => screen().getByText('Stow this window')).toThrow();
```

- [ ] **Step 2: Run focused hint tests to verify they fail**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "duplicate stow hint"
```

Expected: FAIL because the hint still exists.

- [ ] **Step 3: Remove prop from ActiveWorkspace type and signature**

In `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`, remove `Archive` from the import:

```tsx
import { Layers, Trash2, X } from 'lucide-react';
```

Remove this prop from `Props`:

```ts
  onStowCurrentWindow: () => Promise<void>;
```

Remove it from the function parameter list:

```tsx
export function ActiveWorkspace({
  busy,
  locale,
  onStatus,
  onStowTab,
  refreshKey,
}: Props) {
```

- [ ] **Step 4: Remove hint markup**

Delete this block from `ActiveWorkspace.tsx`:

```tsx
      <div className="active-workspace-hint">
        <p>Ready to clear this workspace? Stow the current window here or from the toolbar.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void onStowCurrentWindow()}
          disabled={busy}
        >
          <Archive size={16} aria-hidden="true" />
          {t(locale, 'stowThisWindow')}
        </button>
      </div>
```

Keep all Chrome group controls, duplicate cleanup, group navigation, and tab-row actions unchanged.

- [ ] **Step 5: Stop passing removed prop from App**

In `apps/extension/src/entrypoints/newtab/App.tsx`, remove the whole `onStowCurrentWindow` prop from the `ActiveWorkspace` usage:

```tsx
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
```

Do not change the top-right primary stow button.

- [ ] **Step 6: Remove hint CSS**

Delete these blocks from `apps/extension/src/entrypoints/newtab/styles.css`:

```css
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
```

Also delete this mobile block:

```css
  .active-workspace-hint {
    align-items: flex-start;
    flex-direction: column;
  }
```

- [ ] **Step 7: Run active workspace and stow tests**

Run:

```bash
rtk bun --cwd apps/extension run test src/entrypoints/newtab/App.test.tsx -t "stow|workspace|hint"
```

Expected: PASS.

- [ ] **Step 8: Commit hint removal**

Run:

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/styles.css apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "fix(newtab): remove duplicate workspace stow hint"
```

Expected: commit succeeds.

---

### Task 5: Full Verification And Final Cleanup

**Files:**
- Modify only files already touched by Tasks 1-4 if verification exposes a direct regression.

**Interfaces:**
- Consumes all previous task outputs.
- Produces a fully verified implementation with tests and typecheck passing.

- [ ] **Step 1: Run extension tests**

Run:

```bash
rtk bun --cwd apps/extension run test
```

Expected: PASS.

- [ ] **Step 2: Run root test suite**

Run:

```bash
rtk bun run test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
rtk bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff for accidental scope creep**

Run:

```bash
rtk git diff --stat HEAD
rtk git diff -- apps/extension/src/entrypoints/newtab/App.tsx apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/components/ThemeControls.tsx apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx apps/extension/src/features/theme/theme-preferences.ts apps/extension/src/features/i18n/i18n.ts apps/extension/wxt.config.ts
```

Expected: diff only contains the approved language/theme switch, quick-link favicon/edit-mode, and hint-removal changes.

- [ ] **Step 5: Commit verification cleanup if needed**

If Step 1, Step 2, or Step 3 required direct cleanup changes, run:

```bash
rtk git add apps/extension/src/entrypoints/newtab apps/extension/src/features apps/extension/src/tests apps/extension/wxt.config.ts
rtk git commit -m "test(newtab): verify topbar controls and quick links"
```

Expected: commit succeeds when cleanup changes exist. If no cleanup changes exist, skip this commit.

- [ ] **Step 6: Report final verification**

Include these exact results in the implementation summary:

```text
bun --cwd apps/extension run test: PASS
bun run test: PASS
bun run typecheck: PASS
```

If a command fails because of an environment issue outside the code changes, include the failing command, the first actionable error line, and the reason it is believed to be environmental.

---

## Self-Review Notes

- Spec coverage: Tasks cover top-bar language/theme switches, SVG lucide icons, removal of `system` from theme UI/model, removal of visible `auto`, favicon permission and rendering, quick-link show/edit mode, and active workspace hint removal.
- Deferred-detail scan: The plan contains no deferred implementation notes.
- Type consistency: `ThemeMode` is `light | dark`; legacy `system` is passed only as `never` in tests to verify normalization. Quick-link favicon helpers are internal to `QuickLinks.tsx` and do not create cross-file API coupling.
