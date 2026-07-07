# Top Bar Language, Theme, And Quick Links Design

Date: 2026-07-07
Status: Approved for planning

## Context

Tabstow's new tab page is a React/WXT Chrome extension surface. The current language and theme controls live in the `Extra` drawer's Appearance panel. Theme mode currently supports `system`, `light`, and `dark`; language currently supports `auto`, `en`, and `zh-CN`. Quick links render custom uploaded icons or text initials, even though the edit copy says blank icons use the site icon. Quick-link edit controls are always visible under every tile, and the active workspace includes a duplicate stow-current-window hint even though the top-right primary action already stows the current window.

## Goals

- Add top-bar language and theme switches.
- Keep the visible language choices to English and Simplified Chinese.
- Keep the visible theme choices to light and dark only.
- Use SVG icon buttons for the two top-bar switches.
- Improve quick links by using default site favicons when no custom icon is set.
- Save quick-link space by hiding edit controls until edit mode is enabled.
- Remove the active workspace hint and its duplicate stow button.

## Non-Goals

- No new content scripts.
- No broad host permissions.
- No remote executable code, CDN scripts, or favicon scraping from arbitrary pages.
- No unrelated options-page redesign.
- No speculative quick-link folders, tags, or drag-and-drop work.

## Selected Approach

The top bar will get two compact controls beside the existing header actions:

- A language switch with a language/globe SVG icon and text for `English` or `简体中文`.
- A theme switch with sun/moon SVG icons and text for `Light` or `Dark`.

Both controls will use existing React state from `App`. The language switch will persist through `saveLanguagePreference`. The theme switch will persist through `saveThemePreferences` and continue to apply theme variables through `useThemePreferencesController`.

The `Extra > Appearance` panel will mirror the same two choices. It will not reintroduce `Auto` language or `System` theme. Existing stored `auto` language values should resolve to the browser language on load, then switchable UI choices should save either `en` or `zh-CN`. Existing stored `system` theme values should normalize to `light`.

Quick links will render site favicons for `site` and `null` icon values through Chrome's extension favicon URL pattern:

```text
chrome-extension://<extension-id>/_favicon/?pageUrl=<encoded-url>&size=32
```

The extension manifest will add the `favicon` permission. This is preferred over fetching arbitrary site icons because it avoids broad host permissions and keeps the extension permission surface narrow. Rendering will fall back to the existing hostname initial when the favicon image fails.

Quick links will default to show mode. In show mode, only the link tiles are visible. A header toggle with an SVG edit icon will enter edit mode; in edit mode, move, upload, edit, and delete controls appear under tiles. The mode can be component-local state because it is a space-saving UI preference, not durable user data.

The `active-workspace-hint` markup and CSS will be removed. `ActiveWorkspace` no longer needs the `onStowCurrentWindow` prop because the top-right primary stow action already covers that workflow.

## Component Boundaries

- `App.tsx`
  - Owns `language`, `locale`, and `themeControls`.
  - Renders top-bar language and theme switches.
  - Stops passing `onStowCurrentWindow` to `ActiveWorkspace`.

- `ThemeControls.tsx`
  - Keeps theme load/save/apply behavior.
  - Removes `system` from user-facing theme options.
  - Removes `auto` from user-facing language options.
  - Exposes enough controller state/actions for top-bar switches without duplicating persistence logic.

- `QuickLinks.tsx`
  - Adds show/edit mode state.
  - Adds favicon rendering for site/default icons with fallback initials.
  - Keeps custom emoji and uploaded image icon behavior.
  - Keeps upload, edit, reorder, and remove behavior unchanged in edit mode.

- `ActiveWorkspace.tsx`
  - Removes the duplicate hint block and prop.

- `i18n.ts`
  - Adds labels for top-bar language/theme switch controls and quick-link edit/show mode.
  - Removes or stops exposing UI copy for `auto` and `system` where no longer used.

- `theme-preferences.ts`
  - Narrows `ThemeMode` to `light | dark`.
  - Normalizes legacy `system` and invalid values to `light`.

- `wxt.config.ts`
  - Adds the `favicon` permission only.

## Data Flow

Language load:

1. `App` calls `getLanguagePreference`.
2. `auto` or invalid stored values resolve through `resolveLocale`.
3. The UI switch shows the resolved language.
4. Switching language saves `en` or `zh-CN`.

Theme load:

1. `useThemePreferencesController` calls `getThemePreferences`.
2. `system` or invalid stored values normalize to `light`.
3. `applyTheme` writes `data-theme-mode` and CSS variables.
4. Switching theme saves `light` or `dark`.

Quick-link icon rendering:

1. `image` icons resolve through the existing cache token flow.
2. `emoji` icons render the emoji text.
3. `site` or `null` icons render Chrome's favicon URL.
4. Failed favicon loads fall back to the hostname initial.

## Error Handling

- Failed favicon image loads should be silent and fall back to initials.
- Failed quick-link cache image resolution should keep the existing silent fallback behavior.
- Theme and language save failures can follow the current Appearance panel behavior; this design does not add a separate global error path.
- Legacy stored values are normalized rather than treated as fatal.

## Testing

Update and add tests for:

- Top-bar renders language and theme SVG-icon switches.
- Language switch saves `en` and `zh-CN`, with no visible `Auto` option.
- Theme switch saves `light` and `dark`, with no visible `System` option.
- Legacy `system` theme normalizes to `light`.
- Quick links render a favicon image for default/site icons and fall back to initials on image error.
- Quick links hide edit controls in show mode and reveal them in edit mode.
- Active workspace no longer renders `.active-workspace-hint`.
- Manifest includes `favicon` permission while keeping host permissions unchanged.

Run verification with Bun:

```bash
bun run test
bun run typecheck
```

## Risks

- Chrome favicon URLs require the `favicon` permission, so the manifest test must be updated deliberately.
- Existing tests assume quick-link controls and the active workspace hint are always visible; those assertions must change.
- The options page has a separate settings theme path. This design only changes the new-tab theme preferences, because the requested controls are for the new-tab top bar and Appearance panel.
