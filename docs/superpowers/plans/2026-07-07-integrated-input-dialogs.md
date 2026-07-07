# Integrated Input Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all blocking `window.prompt` input flows in the new-tab UI with integrated, accessible React dialogs while leaving native file pickers unchanged.

**Architecture:** Add a small reusable dialog shell local to the new-tab entrypoint, then wire Quick Links and Todos to use feature-owned controlled forms inside that shell. Keep persistence, validation, storage, and extension message routes unchanged.

**Tech Stack:** React, TypeScript, WXT, Vitest/jsdom, lucide-react, Bun scripts.

## Global Constraints

- Use Bun for package management and scripts in this repository. Do not use pnpm, npm, npx, or yarn commands for project dependency work.
- Chrome extension runtime code must not use Bun-only APIs.
- Avoid Node-only APIs in bundled extension code.
- Keep Manifest V3 permissions minimal.
- Do not add content scripts for the MVP.
- Do not use eval, new Function, remote executable code, or CDN-loaded scripts.
- Store durable tab sessions in IndexedDB.
- Store lightweight settings through extension storage.
- Do not commit real tokens, credentials, or user-specific values.
- Replace every `window.prompt` in the new-tab UI with integrated web UI.
- Native file pickers remain native by explicit scope decision.
- Commit messages must use `type(scope): msg`, for example `feat(auth): add login page`.

---

## File Structure

- Create `apps/extension/src/entrypoints/newtab/components/FormDialog.tsx`
  - Owns the shared new-tab dialog shell: labelled dialog semantics, backdrop/Escape cancel, submit/cancel buttons, focus setup, and focus restoration.
- Create `apps/extension/src/entrypoints/newtab/components/FormDialog.test.tsx`
  - Verifies submit, Escape cancel, initial focus, and focus restoration for the dialog shell.
- Modify `apps/extension/src/features/i18n/i18n.ts`
  - Adds labels and button copy used by integrated quick-link and todo forms.
- Modify `apps/extension/src/features/i18n/i18n.test.ts`
  - Verifies Simplified Chinese labels for the new form surfaces.
- Modify `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
  - Replaces all quick-link prompts with local dialog state, URL/label form, edit form, and open-tab chooser.
- Modify `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`
  - Replaces todo prompts with a local dialog form.
- Modify `apps/extension/src/entrypoints/newtab/styles.css`
  - Adds dialog, field, textarea, and open-tab chooser styles.
- Modify `apps/extension/src/entrypoints/newtab/App.test.tsx`
  - Rewrites prompt-based behavior tests to drive integrated dialogs and assert `window.prompt` is unused.

`ActiveWorkspace.tsx` currently has no `window.prompt` in production source. Do not add manual-group UI back in this plan. The final audit task verifies that no production new-tab prompt remains.

---

### Task 1: Localized Form Copy

**Files:**
- Modify: `apps/extension/src/features/i18n/i18n.ts`
- Modify: `apps/extension/src/features/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: existing `t(locale, key, vars?)` API.
- Produces: new `MessageKey` values `add`, `cancel`, `save`, `quickLinkUrl`, `quickLinkLabel`, `quickLinkIcon`, `quickLinkIconHelp`, `chooseOpenTab`, `noOpenTabsForQuickLink`, `todoTitle`, and `todoDetails`.

- [ ] **Step 1: Write the failing i18n test**

In `apps/extension/src/features/i18n/i18n.test.ts`, extend `includes Simplified Chinese labels for migrated dashboard surfaces` with these assertions:

```ts
    expect(t('zh-CN', 'quickLinkUrl')).toBe('快捷链接网址');
    expect(t('zh-CN', 'quickLinkLabel')).toBe('快捷链接名称');
    expect(t('zh-CN', 'quickLinkIcon')).toBe('快捷链接图标');
    expect(t('zh-CN', 'quickLinkIconHelp')).toBe('留空以使用网站图标。');
    expect(t('zh-CN', 'chooseOpenTab')).toBe('选择打开的标签页');
    expect(t('zh-CN', 'todoTitle')).toBe('待办标题');
    expect(t('zh-CN', 'todoDetails')).toBe('待办详情');
    expect(t('zh-CN', 'cancel')).toBe('取消');
    expect(t('zh-CN', 'save')).toBe('保存');
    expect(t('zh-CN', 'add')).toBe('添加');
```

- [ ] **Step 2: Run the i18n test to verify it fails**

Run: `rtk bun --cwd apps/extension run test -- src/features/i18n/i18n.test.ts -t "includes Simplified Chinese labels"`

Expected: FAIL with TypeScript/runtime errors or assertion failures for missing message keys.

- [ ] **Step 3: Add the new English messages**

In `apps/extension/src/features/i18n/i18n.ts`, add these keys inside `messages.en`:

```ts
    add: 'Add',
    cancel: 'Cancel',
    chooseOpenTab: 'Choose open tab',
    noOpenTabsForQuickLink: 'No open tabs with URLs are available.',
    quickLinkIcon: 'Quick link icon',
    quickLinkIconHelp: 'Leave blank to use the site icon.',
    quickLinkLabel: 'Quick link label',
    quickLinkUrl: 'Quick link URL',
    save: 'Save',
    todoDetails: 'Todo details',
    todoTitle: 'Todo title',
```

- [ ] **Step 4: Add the new Simplified Chinese messages**

In `apps/extension/src/features/i18n/i18n.ts`, add these keys inside `messages['zh-CN']`:

```ts
    add: '添加',
    cancel: '取消',
    chooseOpenTab: '选择打开的标签页',
    noOpenTabsForQuickLink: '没有可添加的网址标签页。',
    quickLinkIcon: '快捷链接图标',
    quickLinkIconHelp: '留空以使用网站图标。',
    quickLinkLabel: '快捷链接名称',
    quickLinkUrl: '快捷链接网址',
    save: '保存',
    todoDetails: '待办详情',
    todoTitle: '待办标题',
```

- [ ] **Step 5: Run the i18n test to verify it passes**

Run: `rtk bun --cwd apps/extension run test -- src/features/i18n/i18n.test.ts -t "includes Simplified Chinese labels"`

Expected: PASS.

- [ ] **Step 6: Commit localized copy**

```bash
rtk git add apps/extension/src/features/i18n/i18n.ts apps/extension/src/features/i18n/i18n.test.ts
rtk git commit -m "fix(newtab): add integrated input labels"
```

---

### Task 2: Shared Form Dialog Shell

**Files:**
- Create: `apps/extension/src/entrypoints/newtab/components/FormDialog.tsx`
- Create: `apps/extension/src/entrypoints/newtab/components/FormDialog.test.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/styles.css`

**Interfaces:**
- Consumes: React children and form callbacks from feature components.
- Produces:

```ts
export type FormDialogProps = {
  cancelLabel: string;
  children: ReactNode;
  description?: string;
  errorMessage?: string | null;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
  title: string;
};

export function FormDialog(props: FormDialogProps): JSX.Element;
```

- [ ] **Step 1: Write the failing dialog tests**

Create `apps/extension/src/entrypoints/newtab/components/FormDialog.test.tsx`:

```tsx
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDialog } from './FormDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('FormDialog', () => {
  it('submits the form without leaving the page', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    await act(async () => {
      root.render(
        <FormDialog cancelLabel="Cancel" onCancel={onCancel} onSubmit={onSubmit} submitLabel="Save" title="Edit item">
          <label>
            Name
            <input defaultValue="Draft" />
          </label>
        </FormDialog>,
      );
    });

    await click(getByText('Save'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with Escape and restores focus to the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          {open ? (
            <FormDialog
              cancelLabel="Cancel"
              onCancel={() => setOpen(false)}
              onSubmit={() => undefined}
              submitLabel="Save"
              title="Add item"
            >
              <label>
                Name
                <input />
              </label>
            </FormDialog>
          ) : null}
        </>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });

    await click(getByText('Open dialog'));
    expect(document.activeElement).toBe(getByLabelText('Name'));

    await keyDown('Escape');

    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(getByText('Open dialog'));
  });
});

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function keyDown(key: string) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

function getByText(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>('button, label, h2')).find(
    (element) => element.textContent === text,
  );
  if (!match) throw new Error(`Unable to find text: ${text}`);
  return match;
}

function getByLabelText(text: string): HTMLElement {
  const labels = Array.from(container.querySelectorAll<HTMLLabelElement>('label'));
  const label = labels.find((item) => item.textContent?.includes(text));
  const control = label?.querySelector<HTMLElement>('input, textarea, select');
  if (!control) throw new Error(`Unable to find label: ${text}`);
  return control;
}

function queryByRole(role: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[role="${role}"]`);
}
```

- [ ] **Step 2: Run the dialog tests to verify they fail**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/components/FormDialog.test.tsx`

Expected: FAIL because `./FormDialog` does not exist.

- [ ] **Step 3: Create the dialog shell**

Create `apps/extension/src/entrypoints/newtab/components/FormDialog.tsx`:

```tsx
import { X } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';

export type FormDialogProps = {
  cancelLabel: string;
  children: ReactNode;
  description?: string;
  errorMessage?: string | null;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitting?: boolean;
  title: string;
};

export function FormDialog({
  cancelLabel,
  children,
  description,
  errorMessage,
  initialFocusRef,
  onCancel,
  onSubmit,
  submitLabel,
  submitting = false,
  title,
}: FormDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const describedBy = [
    description ? descriptionId : null,
    errorMessage ? errorId : null,
  ].filter(Boolean).join(' ') || undefined;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallbackFocus = dialogRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const target = initialFocusRef?.current ?? fallbackFocus;
    target?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCancel();
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    void onSubmit();
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        aria-describedby={describedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className="form-dialog"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p className="subtle" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="icon-button" aria-label={cancelLabel} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-body">{children}</div>

        {errorMessage ? (
          <p className="status-message status-message--error" id={errorId} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add dialog CSS**

Modify `apps/extension/src/entrypoints/newtab/styles.css`:

```css
button,
input,
select,
textarea {
  font: inherit;
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
a:focus-visible {
  outline: 0;
  box-shadow: var(--focus-ring);
}
```

Add these new classes near the drawer styles:

```css
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in oklab, var(--bg), transparent 18%);
  backdrop-filter: blur(3px);
}

.form-dialog {
  width: min(100%, 430px);
  max-height: min(720px, calc(100vh - 32px));
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 16px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-raised);
}

.dialog-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.dialog-body,
.field-stack {
  display: grid;
  gap: 12px;
}

.field-label {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 510;
  text-transform: uppercase;
}

.dialog-input,
.dialog-textarea {
  width: 100%;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: inherit;
  padding: 0 12px;
}

.dialog-input {
  min-height: 38px;
}

.dialog-textarea {
  min-height: 86px;
  padding-block: 9px;
  resize: vertical;
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.open-tab-chooser {
  display: grid;
  gap: 8px;
}

.open-tab-choice {
  width: 100%;
  min-width: 0;
  min-height: 52px;
  justify-content: flex-start;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  border: 1px solid var(--border);
  background: var(--surface-warm);
  text-align: left;
}
```

- [ ] **Step 5: Run the dialog tests to verify they pass**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/components/FormDialog.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit dialog shell**

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/FormDialog.tsx apps/extension/src/entrypoints/newtab/components/FormDialog.test.tsx apps/extension/src/entrypoints/newtab/styles.css
rtk git commit -m "fix(newtab): add integrated form dialog"
```

---

### Task 3: Quick Links Integrated Inputs

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `FormDialog` from Task 2, i18n keys from Task 1, existing `createQuickLink`, `updateQuickLink`, `saveQuickLinks`, `sendExtensionMessage`.
- Produces: Quick Links add/edit/open-tab flows with no `window.prompt` calls.

- [ ] **Step 1: Rewrite the quick-link add test to use fields**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, replace the body of `adds and removes quick links through the utility panel` with:

```tsx
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'https://example.com');
    await change(screen().getByLabelText('Quick link label'), 'Example');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://example.com/',
        label: 'Example',
      }),
    ]);
    expect(screen().getByText('Example')).not.toBeNull();

    await click(screen().getByLabelText('Remove Example'));

    expect(saveQuickLinks).toHaveBeenLastCalledWith([]);
```

- [ ] **Step 2: Rewrite bare-domain, edit, invalid URL, and javascript URL tests**

In the same test file, update each quick-link prompt test to click the dialog button and fill fields.

For `adds a quick link from a bare domain through the utility panel`, use:

```tsx
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'google.com');
    await change(screen().getByLabelText('Quick link label'), 'Google');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://google.com/',
        label: 'Google',
      }),
    ]);
    expect(screen().getByText('Google')).not.toBeNull();
```

For `edits quick link label and icon metadata through the utility panel`, use:

```tsx
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
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByLabelText('Edit Example'));
    await change(screen().getByLabelText('Quick link label'), 'Example docs');
    await change(screen().getByLabelText('Quick link icon'), '*');
    await click(screen().getByRole('button', { name: 'Save' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'link-1',
        label: 'Example docs',
        icon: { kind: 'emoji', value: '*' },
      }),
    ]);
    expect(screen().getByText('Example docs')).not.toBeNull();
    expect(screen().getByText('*')).not.toBeNull();
```

For invalid URL tests, fill `Quick link URL`, fill `Quick link label`, click `Add`, then assert:

```tsx
    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).not.toHaveBeenCalled();
    expect(screen().getByText('Example')).not.toBeNull();
    expect(screen().getByRole('alert').textContent).toBe('Quick link URL is invalid.');
```

- [ ] **Step 3: Add an open-tab chooser test**

Add this test after the bare-domain quick-link test:

```tsx
  it('adds a quick link from an open-tab chooser', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Add open tab' }));
    expect(screen().getByRole('dialog', { name: 'Choose open tab' })).not.toBeNull();

    await click(screen().getByRole('button', { name: 'Spec draft' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({
        url: 'https://docs.example.com/spec',
        label: 'Spec draft',
      }),
    ]);
    expect(screen().getByText('Spec draft')).not.toBeNull();
  });
```

- [ ] **Step 4: Run the quick-link tests to verify they fail**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx -t "quick link"`

Expected: FAIL because the UI still calls `window.prompt` and has no integrated quick-link fields.

- [ ] **Step 5: Replace quick-link prompt state and helpers**

In `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`, add the import:

```ts
import { FormDialog } from './FormDialog';
```

Rename `iconFromPrompt` to `iconFromValue`:

```ts
function iconFromValue(value: string): QuickLinkIcon {
  return value.trim() ? { kind: 'emoji', value: value.trim() } : { kind: 'site', value: null };
}
```

Add these types above `export function QuickLinks`:

```ts
type OpenTabChoice = {
  key: string;
  tab: ActiveBrowserTab;
};

type QuickLinkDialogState =
  | { kind: 'add-url'; url: string; label: string; error: string | null; submitting: boolean }
  | { kind: 'edit'; linkId: string; label: string; iconValue: string; error: string | null; submitting: boolean }
  | { kind: 'open-tabs'; choices: OpenTabChoice[]; error: string | null; submittingKey: string | null }
  | null;
```

Add state inside `QuickLinks`:

```ts
  const [dialog, setDialog] = useState<QuickLinkDialogState>(null);
```

Replace `addByUrl`, `addFromOpenTabs`, and `edit` with these handlers:

```ts
  function openAddByUrlDialog() {
    setErrorMessage(null);
    setDialog({ kind: 'add-url', url: '', label: '', error: null, submitting: false });
  }

  async function submitAddByUrl() {
    if (!dialog || dialog.kind !== 'add-url') return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      await persistLinks([...links, createQuickLink({ url: dialog.url, label: dialog.label })]);
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
        submitting: false,
      });
    }
  }

  async function openOpenTabsDialog() {
    setErrorMessage(null);
    const response = await sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' });
    if (!response.ok) {
      setErrorMessage(response.error.message);
      return;
    }

    const choices = response.data
      .filter((tab) => typeof tab.url === 'string' && tab.url.length > 0)
      .map((tab) => ({
        key: String(tab.id ?? tab.url ?? getTabLabel(tab)),
        tab,
      }));

    if (choices.length === 0) {
      setErrorMessage(t(locale, 'noOpenTabsForQuickLink'));
      return;
    }

    setDialog({ kind: 'open-tabs', choices, error: null, submittingKey: null });
  }

  async function submitOpenTabChoice(choice: OpenTabChoice) {
    if (!dialog || dialog.kind !== 'open-tabs' || !choice.tab.url) return;
    setDialog({ ...dialog, error: null, submittingKey: choice.key });

    try {
      await persistLinks([...links, createQuickLink({ url: choice.tab.url, label: getTabLabel(choice.tab) })]);
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
        submittingKey: null,
      });
    }
  }

  function openEditDialog(link: QuickLink) {
    setErrorMessage(null);
    setDialog({
      kind: 'edit',
      linkId: link.id,
      label: link.label,
      iconValue: link.icon?.kind === 'emoji' ? link.icon.value : '',
      error: null,
      submitting: false,
    });
  }

  async function submitEdit() {
    if (!dialog || dialog.kind !== 'edit') return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      const next = links.map((item) =>
        item.id === dialog.linkId
          ? updateQuickLink(item, { label: dialog.label, icon: iconFromValue(dialog.iconValue) })
          : item,
      );
      await persistLinks(next);
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Could not update quick link.',
        submitting: false,
      });
    }
  }
```

- [ ] **Step 6: Wire buttons to open integrated dialogs**

In the Quick Links header, change the add buttons:

```tsx
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
```

For the edit button, change the click handler:

```tsx
                  onClick={() => openEditDialog(link)}
```

- [ ] **Step 7: Render the integrated quick-link dialogs**

Add this block before the closing `</section>` in `QuickLinks`:

```tsx
      {dialog?.kind === 'add-url' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={dialog.error}
          onCancel={() => setDialog(null)}
          onSubmit={submitAddByUrl}
          submitLabel={t(locale, 'add')}
          submitting={dialog.submitting}
          title={t(locale, 'addQuickLink')}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'quickLinkUrl')}
              <input
                aria-label={t(locale, 'quickLinkUrl')}
                className="dialog-input"
                onChange={(event) => setDialog({ ...dialog, url: event.target.value })}
                type="url"
                value={dialog.url}
              />
            </label>
            <label className="field-label">
              {t(locale, 'quickLinkLabel')}
              <input
                aria-label={t(locale, 'quickLinkLabel')}
                className="dialog-input"
                onChange={(event) => setDialog({ ...dialog, label: event.target.value })}
                type="text"
                value={dialog.label}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          description={t(locale, 'quickLinkIconHelp')}
          errorMessage={dialog.error}
          onCancel={() => setDialog(null)}
          onSubmit={submitEdit}
          submitLabel={t(locale, 'save')}
          submitting={dialog.submitting}
          title={t(locale, 'editQuickLink', { label: dialog.label })}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'quickLinkLabel')}
              <input
                aria-label={t(locale, 'quickLinkLabel')}
                className="dialog-input"
                onChange={(event) => setDialog({ ...dialog, label: event.target.value })}
                type="text"
                value={dialog.label}
              />
            </label>
            <label className="field-label">
              {t(locale, 'quickLinkIcon')}
              <input
                aria-label={t(locale, 'quickLinkIcon')}
                className="dialog-input"
                onChange={(event) => setDialog({ ...dialog, iconValue: event.target.value })}
                type="text"
                value={dialog.iconValue}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}

      {dialog?.kind === 'open-tabs' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={dialog.error}
          onCancel={() => setDialog(null)}
          onSubmit={() => undefined}
          submitLabel={t(locale, 'add')}
          submitting={dialog.submittingKey !== null}
          title={t(locale, 'chooseOpenTab')}
        >
          <div className="open-tab-chooser">
            {dialog.choices.map((choice) => {
              const tabLabel = getTabLabel(choice.tab);
              return (
                <button
                  type="button"
                  aria-label={tabLabel}
                  className="open-tab-choice"
                  disabled={dialog.submittingKey !== null}
                  key={choice.key}
                  onClick={() => void submitOpenTabChoice(choice)}
                >
                  <span className="favicon tone-blue" aria-hidden="true">
                    {(tabLabel.match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="tab-copy">
                    <span className="tab-title">{tabLabel}</span>
                    <span className="tab-url">{choice.tab.url ?? ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </FormDialog>
      ) : null}
```

- [ ] **Step 8: Run quick-link tests to verify they pass**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx -t "quick link"`

Expected: PASS.

- [ ] **Step 9: Commit quick-link dialogs**

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "fix(newtab): replace quick link prompts"
```

---

### Task 4: Todo Integrated Input

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`

**Interfaces:**
- Consumes: `FormDialog` from Task 2, i18n keys from Task 1, existing `createTodo` and `saveTodos`.
- Produces: Todo add flow with no `window.prompt` calls.

- [ ] **Step 1: Add a failing todo dialog test**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, add this test near the existing utility-panel tests:

```tsx
  it('adds a todo through an integrated form', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();
    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByLabelText('Add todo'));
    await change(screen().getByLabelText('Todo title'), 'Review launch checklist');
    await change(screen().getByLabelText('Todo details'), 'Remember the migration notes');
    await click(screen().getByRole('button', { name: 'Add' }));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(saveTodos).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Review launch checklist',
        description: 'Remember the migration notes',
        completed: false,
        dismissed: false,
      }),
    ]);
    expect(screen().getByText('Review launch checklist')).not.toBeNull();
  });
```

- [ ] **Step 2: Run the todo test to verify it fails**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx -t "adds a todo through an integrated form"`

Expected: FAIL because the todo add action still calls `window.prompt`.

- [ ] **Step 3: Replace todo prompt state and handlers**

In `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`, add:

```ts
import { FormDialog } from './FormDialog';
```

Inside `TodosPanel`, add state:

```ts
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDescription, setTodoDescription] = useState('');
  const [todoError, setTodoError] = useState<string | null>(null);
  const [todoSubmitting, setTodoSubmitting] = useState(false);
```

Replace `addTodo` with:

```ts
  function openTodoDialog() {
    setTodoTitle('');
    setTodoDescription('');
    setTodoError(null);
    setTodoSubmitting(false);
    setTodoDialogOpen(true);
  }

  async function addTodo() {
    setTodoError(null);
    setTodoSubmitting(true);

    try {
      setTodos(await saveTodos(createTodo(todos, { title: todoTitle, description: todoDescription })));
      setTodoDialogOpen(false);
      setTodoTitle('');
      setTodoDescription('');
    } catch (error) {
      setTodoError(error instanceof Error ? error.message : 'Todo title is required.');
    } finally {
      setTodoSubmitting(false);
    }
  }
```

- [ ] **Step 4: Wire the add todo button and dialog**

Change the Add todo button:

```tsx
        <button type="button" className="icon-button" aria-label={t(locale, 'addTodo')} onClick={openTodoDialog}>
          <Plus size={16} aria-hidden="true" />
        </button>
```

Add this block before the closing `</section>` in `TodosPanel`:

```tsx
      {todoDialogOpen ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={todoError}
          onCancel={() => setTodoDialogOpen(false)}
          onSubmit={addTodo}
          submitLabel={t(locale, 'add')}
          submitting={todoSubmitting}
          title={t(locale, 'addTodo')}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'todoTitle')}
              <input
                aria-label={t(locale, 'todoTitle')}
                className="dialog-input"
                onChange={(event) => setTodoTitle(event.target.value)}
                type="text"
                value={todoTitle}
              />
            </label>
            <label className="field-label">
              {t(locale, 'todoDetails')}
              <textarea
                aria-label={t(locale, 'todoDetails')}
                className="dialog-textarea"
                onChange={(event) => setTodoDescription(event.target.value)}
                value={todoDescription}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}
```

- [ ] **Step 5: Run the todo test to verify it passes**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx -t "adds a todo through an integrated form"`

Expected: PASS.

- [ ] **Step 6: Commit todo dialog**

```bash
rtk git add apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "fix(newtab): replace todo prompts"
```

---

### Task 5: Final Prompt Audit And Verification

**Files:**
- Modify: `apps/extension/src/entrypoints/newtab/App.test.tsx`
- Verify only: `apps/extension/src/entrypoints/newtab/components/ActiveWorkspace.tsx`
- Verify only: `apps/extension/src/entrypoints/newtab/components/QuickLinks.tsx`
- Verify only: `apps/extension/src/entrypoints/newtab/components/TodosPanel.tsx`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: repository state with no production `window.prompt` in new-tab UI and passing tests/typecheck.

- [ ] **Step 1: Add a no-prompt regression test**

In `apps/extension/src/entrypoints/newtab/App.test.tsx`, add this test near the quick-link/todo tests:

```tsx
  it('does not use browser prompt for integrated input actions', async () => {
    mockMessages({ activeTabs: [UNIQUE_TAB] });
    saveQuickLinks.mockImplementation(async (links: unknown) => links);
    saveTodos.mockImplementation(async (todos: unknown) => todos);

    await renderApp();

    await click(screen().getByLabelText('Add quick link'));
    await change(screen().getByLabelText('Quick link URL'), 'example.com');
    await click(screen().getByRole('button', { name: 'Cancel' }));

    await click(screen().getByRole('button', { name: 'Add open tab' }));
    await click(screen().getByRole('button', { name: 'Cancel' }));

    await click(screen().getByRole('button', { name: 'Extra' }));
    await click(screen().getByLabelText('Add todo'));
    await click(screen().getByRole('button', { name: 'Cancel' }));

    expect(promptSpy).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the no-prompt regression test**

Run: `rtk bun --cwd apps/extension run test -- src/entrypoints/newtab/App.test.tsx -t "does not use browser prompt"`

Expected: PASS.

- [ ] **Step 3: Audit production source for prompts**

Run:

```bash
rtk rg -n "\b(window\.)?prompt\s*\(" apps/extension/src/entrypoints/newtab apps/extension/src/features -g '!*.test.*'
```

Expected: no output and exit code 1 from `rg`.

- [ ] **Step 4: Run full tests**

Run: `rtk bun run test`

Expected: PASS for core and extension test suites.

- [ ] **Step 5: Run typecheck**

Run: `rtk bun run typecheck`

Expected: PASS for core and extension typecheck.

- [ ] **Step 6: Commit final verification test**

```bash
rtk git add apps/extension/src/entrypoints/newtab/App.test.tsx
rtk git commit -m "test(newtab): cover integrated input prompts"
```

---

## Self-Review

- Spec coverage: Tasks 2-4 implement integrated web UI, focus/cancel/inline-error behavior, unchanged storage/message boundaries, and native file picker non-goal. Task 5 covers the final no-prompt audit. `ActiveWorkspace.tsx` already has no production prompt in the current source, so Task 5 verifies it remains prompt-free rather than reintroducing manual-group UI.
- Red-flag scan: This plan contains fully specified implementation steps and concrete commands.
- Type consistency: `FormDialogProps`, `QuickLinkDialogState`, and i18n keys are defined before use, and later tasks consume the same names.
