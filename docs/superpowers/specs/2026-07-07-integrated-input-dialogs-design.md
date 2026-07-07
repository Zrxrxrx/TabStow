# Integrated Input Dialogs Design

## Context

Tabstow's new tab dashboard now has a solid v1 layout, but several actions still use Chrome's blocking `window.prompt` UI. Those prompts feel disconnected from the page and interrupt the dashboard flow. The current prompt usage is concentrated in the new-tab React entrypoint:

- `QuickLinks`: add by URL, add from open tabs, and edit label/icon.
- `ActiveWorkspace`: create a manual group for a tab.
- `TodosPanel`: add a todo title and details.

No source `window.alert`, `window.confirm`, `beforeunload`, or browser file picker replacement requirement was found. Native file inputs for image/background upload stay in scope as acceptable browser UI.

## Goals

- Replace every `window.prompt` in the new-tab UI with integrated web UI.
- Keep the existing layout, storage, extension message contracts, and validation helpers.
- Make cancel a no-op, matching prompt cancellation behavior.
- Show validation and action errors inline inside the page.
- Preserve Manifest V3 constraints and avoid new permissions, content scripts, or background-driven UI.

## Non-Goals

- Replace native file pickers.
- Add a toolbar popup or new Chrome extension popup surface.
- Move feature state into the background service worker.
- Redesign the whole dashboard, options page, sync behavior, or storage model.

## Chosen Approach

Create a small reusable new-tab dialog/form pattern and use it from the feature components that currently call `window.prompt`.

The dialog pattern should provide:

- A page-integrated backdrop and compact dialog surface.
- A title, optional description, labelled fields, and clear primary/secondary actions.
- Escape and Cancel closing.
- Initial focus when opened and focus restoration when closed.
- Inline `role="alert"` errors.
- Local draft state only; durable persistence remains in existing feature helpers.

This is preferred over inline expandable forms because the dashboard is already dense and one of the flows needs an open-tab chooser. It is also preferred over routing all inputs through the `Extra` drawer because quick-link edits and manual tab grouping should appear near the action that triggered them.

## Component Design

### Shared Dialog Shell

Add a small reusable component under the new-tab entrypoint, for example `FormDialog` or `InputDialog`. It should stay local to the new-tab UI rather than becoming a cross-app abstraction.

The shell owns only presentation and interaction mechanics: labelled dialog semantics, backdrop click cancellation, Escape handling, focus management, and button layout. Feature components own their draft values and submit logic.

### Quick Links

`QuickLinks` replaces prompt calls with three integrated flows:

- Add by URL: opens a form with URL and optional label fields. Submit calls `createQuickLink` and `persistLinks`.
- Add from open tab: fetches `active-tabs:list`, then opens a chooser listing tab title and URL. Selecting a tab submits `createQuickLink` with the tab URL and label.
- Edit: opens a form with label and emoji/icon text. Submit calls `updateQuickLink` and `persistLinks`.

Existing image icon upload behavior remains unchanged.

### Active Workspace

`ActiveWorkspace` replaces the manual group name prompt with a dialog that opens from the tab row action. The dialog should show the selected tab title for context, collect the group name, then run the current `addManualGroup`, `assignTabToManualGroup`, `updateActiveWorkspaceState`, and optional Chrome tab-group sync flow.

Validation errors from duplicate or empty group names should render inline and keep the dialog open.

### Todos

`TodosPanel` replaces the title/details prompts with a compact form opened by the add button. The form collects title and optional details, then calls `createTodo` and `saveTodos`. Empty title errors should render inline.

## Data Flow

No data model or background route changes are required.

- Quick links continue through `createQuickLink`, `updateQuickLink`, `saveQuickLinks`, and the quick-link icon cache.
- Open-tab selection continues to read tabs through `sendExtensionMessage({ type: 'active-tabs:list' })`.
- Manual groups continue through active workspace storage and existing Chrome tab-group sync messages.
- Todos continue through `createTodo` and `saveTodos`.

All dialog drafts are transient React state. Closing a dialog discards drafts and does not write storage.

## Accessibility

The integrated input UI should be more comfortable while preserving predictable keyboard navigation.

- Dialogs use `role="dialog"`, `aria-modal="true"`, and an accessible title.
- Inputs use visible labels.
- Error text uses `role="alert"` and is associated with the relevant form where practical.
- Escape cancels. Enter submits simple forms, while multiline details fields should still allow normal typing.
- Opening a dialog focuses the first useful input or chooser item.
- Closing restores focus to the button that opened it.

## Error Handling

Feature-level validation remains in the existing domain helpers. The UI catches thrown errors and shows the message inline. Failed background messages, storage errors, or sync errors should preserve existing status handling:

- Quick-link errors stay inside the quick-link panel/dialog.
- Manual-group errors use the active workspace status path or dialog-local error when the error is tied to submitted input.
- Todo errors stay inside the todo form.

Duplicate submits should be guarded with local submitting state for async flows.

## Testing And Verification

Update `apps/extension/src/entrypoints/newtab/App.test.tsx` to cover the new UI flows:

- Add quick link through URL and label fields.
- Reject invalid and `javascript:` quick-link URLs without calling `window.prompt`.
- Add quick link from an open-tab chooser.
- Edit quick-link label/icon through fields.
- Create a manual group through the integrated group-name form.
- Add a todo through title/details fields.
- Assert `window.prompt` is not called by these actions.

Run:

- `bun run test`
- `bun run typecheck`

Manual QA should confirm that the new dialogs fit the v1 layout on desktop and mobile widths, cancel cleanly, restore focus, and do not introduce horizontal overflow.

## Open Decisions

There are no open product decisions for this pass. Native file pickers remain native by explicit scope decision.
