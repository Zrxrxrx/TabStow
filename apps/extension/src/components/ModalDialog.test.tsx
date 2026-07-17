import { act, StrictMode, type ReactNode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalDialog } from '@/components/ModalDialog';

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
  await act(async () => root.unmount());
  container.remove();
});

describe('ModalDialog', () => {
  it('portals outside and isolates the application root until it closes', async () => {
    await render(
      <ModalDialog closeLabel="Close" onClose={() => undefined} title="Details">
        <button type="button">Inside</button>
      </ModalDialog>,
    );

    const backdrop = document.body.querySelector<HTMLElement>('.dialog-backdrop');
    expect(backdrop?.parentElement).toBe(document.body);
    expect(container.hasAttribute('inert')).toBe(true);

    await render(null);

    expect(container.hasAttribute('inert')).toBe(false);
  });

  it('preserves a pre-existing inert application root after the final close', async () => {
    container.setAttribute('inert', '');
    await render(
      <ModalDialog closeLabel="Close" onClose={() => undefined} title="Details">
        <button type="button">Inside</button>
      </ModalDialog>,
    );

    await render(null);

    expect(container.hasAttribute('inert')).toBe(true);
  });

  it('keeps one live stack entry through StrictMode effect replay', async () => {
    await render(
      <StrictMode>
        <ModalDialog closeLabel="Close" onClose={() => undefined} title="Details">
          <button type="button">Inside</button>
        </ModalDialog>
      </StrictMode>,
    );

    expect(document.body.querySelectorAll('.dialog-backdrop')).toHaveLength(1);
    expect(container.hasAttribute('inert')).toBe(true);

    await render(null);

    expect(document.body.querySelector('.dialog-backdrop')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
  });

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

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('First');

    getButton('Last').focus();
    await keyDown('Tab');
    expect(document.activeElement).toBe(getButton('Close details'));

    getButton('Close details').focus();
    await keyDown('Tab', true);
    expect(document.activeElement?.textContent).toBe('Last');

    container.tabIndex = 0;
    container.focus();
    await keyDown('Tab');
    expect(document.activeElement).toBe(getButton('Close details'));

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
    await click(document.body.querySelector<HTMLElement>('.dialog-backdrop')!);

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(getButton('Open'));
  });

  it('isolates lower modals and lets only the top modal close from Escape', async () => {
    function Harness() {
      const [outerOpen, setOuterOpen] = useState(true);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <>
          {outerOpen ? (
            <ModalDialog closeLabel="Close outer" onClose={() => setOuterOpen(false)} title="Outer">
              <button type="button" onClick={() => setInnerOpen(true)}>Open nested</button>
            </ModalDialog>
          ) : null}
          {innerOpen ? (
            <ModalDialog closeLabel="Close inner" onClose={() => setInnerOpen(false)} title="Inner">
              <button type="button">Inside nested</button>
            </ModalDialog>
          ) : null}
        </>
      );
    }

    await render(<Harness />);
    await click(getButton('Open nested'));

    const backdrops = document.body.querySelectorAll<HTMLElement>('.dialog-backdrop');
    expect(backdrops).toHaveLength(2);
    expect(backdrops.item(0).hasAttribute('inert')).toBe(true);
    expect(backdrops.item(1).hasAttribute('inert')).toBe(false);
    expect(container.hasAttribute('inert')).toBe(true);

    await keyDown('Escape');

    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('Outer');
    expect(document.activeElement).toBe(getButton('Open nested'));
    expect(container.hasAttribute('inert')).toBe(true);

    await keyDown('Escape');

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
  });

  it('uses a safe application fallback when the opening control was removed', async () => {
    function Harness() {
      const [showOpener, setShowOpener] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button">Safe fallback</button>
          {showOpener ? (
            <button
              type="button"
              onClick={() => {
                setShowOpener(false);
                setOpen(true);
              }}
            >
              Open and remove
            </button>
          ) : null}
          {open ? (
            <ModalDialog closeLabel="Close" onClose={() => setOpen(false)} title="Detached opener">
              <button type="button">Inside</button>
            </ModalDialog>
          ) : null}
        </>
      );
    }

    await render(<Harness />);
    const opener = getButton('Open and remove');
    opener.focus();
    await click(opener);
    expect(opener.isConnected).toBe(false);

    await keyDown('Escape');

    expect(document.activeElement).toBe(getButton('Safe fallback'));
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
    await click(document.body.querySelector<HTMLElement>('.dialog-backdrop')!);
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
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}
