import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { LanguagePreference } from '@/features/i18n/i18n';
import { SidePanelApp } from './SidePanelApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { sendExtensionMessage, storageGetItem } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
  storageGetItem: vi.fn(),
}));

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));
vi.mock('#imports', () => ({
  storage: {
    getItem: storageGetItem,
    setItem: vi.fn(),
  },
}));

const SESSION: TabSession = {
  id: 'session-1',
  title: 'Reading',
  tabs: [{
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.com/',
    createdAt: '2026-07-18T00:00:00.000Z',
  }],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  deviceId: 'device-1',
};

type RuntimeListener = (message: unknown) => unknown;

function runtimeMessageEvent() {
  const listeners = new Set<RuntimeListener>();
  return {
    addListener: vi.fn((listener: RuntimeListener) => listeners.add(listener)),
    removeListener: vi.fn((listener: RuntimeListener) => listeners.delete(listener)),
  };
}

let container: HTMLDivElement;
let root: Root;

describe('SidePanelApp', () => {
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    root = createRoot(container);
    storageGetItem.mockReset().mockResolvedValue('en');
    sendExtensionMessage.mockReset().mockImplementation(async (message: { type: string }) => {
      if (message.type === 'sessions:list') return { ok: true, data: [SESSION] };
      if (message.type === 'history:list') return { ok: true, data: [] };
      return { ok: true, data: {} };
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
          onMessage: runtimeMessageEvent(),
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders all saved tabs through the shared Saved for Later surface', async () => {
    await renderSidePanel();

    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'sessions:list' });
    expect(container.querySelector('[data-od-id="sidepanel-shell"]')).not.toBeNull();
    expect(getByRole('heading', 'Saved windows')).not.toBeNull();
    expect(getByText('Example')).not.toBeNull();
    expect(getByText('https://example.com/')).not.toBeNull();
    expect(container.querySelector('.saved-for-later')).not.toBeNull();
  });

  it('filters saved tabs with Saved-only search semantics and disables dragging', async () => {
    await renderSidePanel();
    const search = getByRole('searchbox', 'Search saved tabs') as HTMLInputElement;

    await change(search, 'example');
    expect(container.querySelector('.saved-tab-row')?.getAttribute('draggable')).toBe('false');
    expect(container.querySelector('.session-card > header')?.getAttribute('draggable')).toBe('false');

    await change(search, 'outside');
    expect(getByText('No saved windows match this search.')).not.toBeNull();
    expect(container.querySelector('.session-card')).toBeNull();
  });

  it('runs shared saved actions and reports their status', async () => {
    let listCount = 0;
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'sessions:list') {
        listCount += 1;
        return { ok: true, data: listCount === 1 ? [SESSION] : [] };
      }
      if (message.type === 'sessions:open-tab') {
        return { ok: true, data: { opened: true, consumed: true } };
      }
      return { ok: true, data: [] };
    });
    await renderSidePanel();

    await click(getByRole('button', 'Open Example'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'tab-1',
      consume: true,
    });
    expect(getByRole('status').textContent).toBe('Moved tab to History.');
    expect(container.querySelector('.session-card')).toBeNull();
  });

  it('uses the saved locale and surfaces theme bootstrap errors', async () => {
    storageGetItem.mockResolvedValueOnce('zh-CN');
    await renderSidePanel('Theme unavailable');

    expect(document.documentElement.lang).toBe('zh-CN');
    expect(getByRole('searchbox', '搜索已保存的标签页')).not.toBeNull();
    expect(getByRole('alert').textContent).toBe('Theme unavailable');
  });

  it('keeps the browser locale when the language preference cannot be read', async () => {
    storageGetItem.mockRejectedValueOnce(new Error('Storage unavailable'));
    await renderSidePanel();

    expect(document.documentElement.lang).toBe('en');
    expect(getByRole('searchbox', 'Search saved tabs')).not.toBeNull();
  });

  it('ignores a language preference read that finishes after unmount', async () => {
    let resolveLanguage: ((language: LanguagePreference) => void) | undefined;
    storageGetItem.mockImplementationOnce(() => new Promise<LanguagePreference>((resolve) => {
      resolveLanguage = resolve;
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await act(async () => {
      root.render(<SidePanelApp />);
      await Promise.resolve();
      root.render(null);
    });
    await act(async () => {
      resolveLanguage?.('zh-CN');
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('opens full History outside the Side Panel', async () => {
    await renderSidePanel();
    await click(getByRole('button', 'History'));

    const historyLink = document.body.querySelector<HTMLAnchorElement>(
      '.recovery-history-link',
    );
    expect(historyLink?.target).toBe('_blank');
  });
});

async function renderSidePanel(initialThemeError: string | null = null) {
  await act(async () => {
    root.render(<SidePanelApp initialThemeError={initialThemeError} />);
    await Promise.resolve();
  });
}

function getByRole(role: string, name?: string): HTMLElement {
  const selectors: Record<string, string> = {
    alert: '[role="alert"]',
    button: 'button',
    heading: 'h1, h2, h3',
    searchbox: 'input[type="search"]',
    status: '[role="status"]',
  };
  const elements = Array.from(
    document.body.querySelectorAll<HTMLElement>(selectors[role] ?? `[role="${role}"]`),
  );
  const element = elements.find((candidate) => {
    if (!name) return true;
    return candidate.getAttribute('aria-label') === name || candidate.textContent?.trim() === name;
  });
  if (!element) throw new Error(`Missing ${role}${name ? ` ${name}` : ''}.`);
  return element;
}

function getByText(text: string): HTMLElement {
  const element = Array.from(document.body.querySelectorAll<HTMLElement>('*')).find(
    (candidate) => candidate.children.length === 0 && candidate.textContent === text,
  );
  if (!element) throw new Error(`Missing text: ${text}`);
  return element;
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}
