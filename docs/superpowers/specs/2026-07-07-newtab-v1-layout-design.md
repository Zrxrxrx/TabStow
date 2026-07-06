# New Tab V1 Layout Design

## Context

The repository already has a React/WXT new tab implementation with working active tabs, saved sessions, quick links, todos, theme controls, language preferences, and sync actions. The `design/v1/` export is the visual source of truth for this refactor. It defines a compact productivity dashboard: topbar, full-width quick links, and a two-column workspace for active and saved tabs.

This work is a front-end layout refactor. It must not change Chrome extension permissions, add content scripts, introduce remote executable code, or move durable data out of the existing storage paths.

## Goals

- Match the `design/v1/index.html` new tab layout closely enough that the production UI reads as the same design.
- Preserve existing user-facing features and data flows.
- Move secondary utilities into an `Extra` drawer so the main dashboard is focused on tab workflow.
- Keep the implementation surgical and compatible with Manifest V3 extension constraints.

## Non-Goals

- Rebuild quick-link management as the full v1 form drawer.
- Redesign todos, theme controls, options, or sync behavior beyond placing them in the new layout.
- Add new storage models, permissions, content scripts, or background behavior.
- Replace working prompt-based quick-link and todo flows unless required by the layout.

## Chosen Approach

Use the v1 layout with a right-side `Extra` drawer.

The main page will follow this order:

1. Topbar with brand lockup, search, `Extra`, `Settings`, and `Stow current window`.
2. Full-width `Quick links` panel.
3. Two-column workspace with `Active tabs` on the left and `Saved for later` on the right.
4. Right-side drawer opened by `Extra`, containing `TodosPanel` and `ThemeControls`.

This keeps the core visual contract from v1 while retaining existing utilities without letting them dominate the first viewport.

## Component Design

### App Shell

`App.tsx` remains the page coordinator. It will own:

- Current saved sessions.
- Busy action state.
- Global status state.
- Active workspace refresh key.
- Language/locale state.
- `extraOpen` drawer state.

The shell renders the new v1 structure and passes existing props to child components. `openOptions` continues to call `chrome.runtime.openOptionsPage()`.

### Topbar

The topbar uses the v1 three-part layout:

- Brand lockup: square `T` mark, `Tabstow` heading, short subtitle.
- Search: existing `SearchBox`, restyled to the v1 search field.
- Actions: `Extra`, `Settings`, and primary `Stow current window`.

The topbar must stack cleanly on narrower viewports.

### Quick Links

`QuickLinks` becomes a full-width panel directly below the topbar. It should adopt the v1 visual pattern:

- Panel header with title, short helper copy, add action, and existing add-from-open-tab action.
- Grid of quick-link cards with centered icon/image/text and clipped labels.
- Existing add, edit, remove, upload-icon, and reorder behavior stays intact.

The implementation can reuse current prompt-based controls. The v1 full edit drawer is outside this refactor.

### Active Tabs

`ActiveWorkspace` becomes the left workspace column and should be visually aligned with the v1 panel/column pattern:

- Header with `Active tabs`, helper text, and open-tab count pill.
- Group filters styled as pills.
- Chrome group and duplicate actions in a compact toolbar.
- Tab groups as nested cards.
- Tab rows with icon/initial block, title, URL/status copy, and row actions.

Existing behavior stays intact: focusing tabs, closing tabs/groups, manual-group assignment, duplicate closing, Chrome group import/collapse, and stowing the current window.

### Saved For Later

`StowedSessions` becomes the right workspace column and should be renamed in UI to match v1 language where appropriate:

- Header with `Saved for later`, helper text, session count pill, and tab count pill.
- Toolbar with Pull and Push; Settings and Stow may stay in the topbar to avoid duplicated primary actions.
- Status message inside the saved panel.
- Session cards with title, date, tab count, preview, Restore, and Delete.

Existing restore/delete/sync behavior stays intact.

### Extra Drawer

The `Extra` button opens a right-side drawer with backdrop and Escape/backdrop close support if practical within the existing React structure.

The drawer contains:

- `TodosPanel`
- `ThemeControls`

These components should keep their existing data flows and controls. The drawer is explicitly a temporary home for secondary features while future product decisions are deferred.

## Data Flow

No data model changes are required.

- Saved sessions continue through extension messages such as `sessions:list`, `sessions:restore`, `sessions:delete`, `sync:pull`, and `sync:push`.
- Active tabs continue through `ActiveWorkspace` and existing active-tabs messages/storage.
- Quick links continue through quick-link storage and image icon cache.
- Todos continue through todo storage.
- Theme and language preferences continue through their existing storage helpers.

## Styling

The new tab stylesheet should extract v1 tokens into the existing CSS surface:

- Dark-first background and surface colors from v1, while preserving existing theme preference hooks.
- Radius scale around 8px, 12px, and 20px.
- Compact panel rhythm with 1px borders and restrained elevation.
- V1 card/grid geometry for quick links, tab groups, rows, session cards, and drawer.
- Existing custom background and surface-opacity variables should continue to work unless they conflict with the v1 layout.

CSS changes should be scoped to the new tab entrypoint and existing component class names or small new classes.

## Responsive Behavior

The production UI should follow the v1 responsive contract:

- Desktop/laptop: topbar has brand/search/actions, quick links span the page, workspace is two columns.
- Tablet and narrow desktop: topbar and workspace collapse to one column as needed.
- Mobile: quick links use two columns, rows avoid horizontal overflow, and drawer width becomes full viewport width.

The layout must avoid horizontal scroll at 360px, 390px, 430px, 820px, 1024px, 1366px, and 1440px widths.

## Accessibility

- Keep headings hierarchical and controls as real buttons, links, forms, labels, and inputs.
- The `Extra` drawer should expose dialog semantics and visible close controls.
- Focus states must remain visible.
- Icon-only controls must keep existing accessible labels.
- Search and form controls must keep localized labels.

## Error Handling

Existing feature-level error handling remains:

- Global action failures still render through status messages.
- Quick-link validation errors stay in the quick-link panel.
- Theme/background errors stay in `ThemeControls`.
- Active workspace errors continue through `onStatus`.

The drawer itself should not swallow errors from its child components.

## Testing And Verification

Run:

- `bun run test`
- `bun run typecheck`

Update tests that assert old DOM order or old section placement. Preserve behavior tests for quick links, todos, theme controls, active tabs, and saved sessions.

If practical, run the extension dev UI and visually compare production screenshots against `design/v1/index.html` at desktop and mobile widths.

## Open Decisions

The `Extra` drawer is a deliberate temporary placement for secondary utilities. Future product work can decide whether todos, appearance, language, and background controls belong in options, a dedicated utility area, or separate feature surfaces.
