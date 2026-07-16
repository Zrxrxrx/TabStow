import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UtilityPageShell } from './UtilityPageShell';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

describe('UtilityPageShell', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('identifies the utility page and provides a reliable workspace return route', async () => {
    await act(async () => root.render(
      <UtilityPageShell
        backToWorkspaceLabel="Back to workspace"
        pageLabel="Settings"
      >
        <p>Page content</p>
      </UtilityPageShell>,
    ));

    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('Settings');
    expect(container.textContent).toContain('Tabstow');
    expect(container.textContent).toContain('Page content');

    const backLink = [...container.querySelectorAll('a')]
      .find((link) => link.textContent?.includes('Back to workspace'));
    expect(backLink?.getAttribute('href')).toBe('chrome-extension://tabstow-test/newtab.html');
    expect(chrome.runtime.getURL).toHaveBeenCalledWith('/newtab.html');
  });
});
