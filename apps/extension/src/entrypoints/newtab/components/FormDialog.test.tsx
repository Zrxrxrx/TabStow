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
  container.id = 'root';
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

    getByText('Open dialog').focus();
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
    const target =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

function getByText(text: string): HTMLElement {
  const match = Array.from(document.body.querySelectorAll<HTMLElement>('button, label, h2')).find(
    (element) => element.textContent === text,
  );
  if (!match) throw new Error(`Unable to find text: ${text}`);
  return match;
}

function getByLabelText(text: string): HTMLElement {
  const labels = Array.from(document.body.querySelectorAll<HTMLLabelElement>('label'));
  const label = labels.find((item) => item.textContent?.includes(text));
  const control = label?.querySelector<HTMLElement>('input, textarea, select');
  if (!control) throw new Error(`Unable to find label: ${text}`);
  return control;
}

function queryByRole(role: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[role="${role}"]`);
}
