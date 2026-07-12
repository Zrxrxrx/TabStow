import { act, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDialog } from './ModalDialog';

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
  await act(async () => root.unmount());
  container.remove();
});

describe('ModalDialog', () => {
  it('focuses inside, traps focus, labels itself, and closes with Escape', async () => {
    const onClose = vi.fn();
    await render(
      <ModalDialog
        closeLabel="Close details"
        description="Current details"
        onClose={onClose}
        title="Details"
      >
        <button type="button">First</button>
        <button type="button">Last</button>
      </ModalDialog>,
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('First');

    getButton('Last').focus();
    await keyDown('Tab');
    expect(document.activeElement).toBe(getButton('Close details'));

    getButton('Close details').focus();
    await keyDown('Tab', true);
    expect(document.activeElement?.textContent).toBe('Last');

    await keyDown('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from its backdrop and restores focus to the opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          {open ? (
            <ModalDialog closeLabel="Close" onClose={() => setOpen(false)} title="Dialog">
              <button type="button">Inside</button>
            </ModalDialog>
          ) : null}
        </>
      );
    }

    await render(<Harness />);
    getButton('Open').focus();
    await click(getButton('Open'));
    await click(container.querySelector<HTMLElement>('.dialog-backdrop')!);

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(getButton('Open'));
  });

  it('suppresses close controls, backdrop, and Escape while busy', async () => {
    const onClose = vi.fn();
    await render(
      <ModalDialog busy closeLabel="Close" onClose={onClose} title="Busy dialog">
        <button type="button">Inside</button>
      </ModalDialog>,
    );

    expect(getButton('Close').hasAttribute('disabled')).toBe(true);
    await click(getButton('Close'));
    await click(container.querySelector<HTMLElement>('.dialog-backdrop')!);
    await keyDown('Escape');

    expect(onClose).not.toHaveBeenCalled();
  });
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function keyDown(key: string, shiftKey = false) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key, shiftKey }),
    );
  });
}

function getButton(name: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}
