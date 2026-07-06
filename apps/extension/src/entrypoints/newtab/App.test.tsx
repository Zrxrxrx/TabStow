import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { App } from './App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
}));
const { getActiveWorkspaceState, updateActiveWorkspaceState } = vi.hoisted(() => ({
  getActiveWorkspaceState: vi.fn(),
  updateActiveWorkspaceState: vi.fn(),
}));

vi.mock('@/lib/messages', () => ({
  sendExtensionMessage,
}));

vi.mock('@/features/active-tabs/active-workspace-storage', () => ({
  getActiveWorkspaceState,
  updateActiveWorkspaceState,
}));

const SESSIONS: TabSession[] = [];
const ACTIVE_TABS: ActiveBrowserTab[] = [
  {
    active: true,
    groupId: -1,
    id: 7,
    index: 0,
    pinned: false,
    title: 'Inbox - Gmail',
    url: 'https://mail.google.com/mail/u/0/#inbox',
    windowId: 3,
  },
];

let container: HTMLDivElement;

describe('App', () => {
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    getActiveWorkspaceState.mockReset();
    updateActiveWorkspaceState.mockReset();
    getActiveWorkspaceState.mockResolvedValue({
      manualGroups: { groups: [], assignments: {} },
      order: { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
      chromeTabGroups: { enabled: false, mappings: [] },
    });
    updateActiveWorkspaceState.mockImplementation(async (state: unknown) => state);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders the active workspace above saved sessions', async () => {
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'active-tabs:list') {
        return { ok: true, data: ACTIVE_TABS };
      }

      if (message.type === 'sessions:list') {
        return { ok: true, data: SESSIONS };
      }

      throw new Error(`Unexpected message: ${message.type}`);
    });

    await act(async () => {
      root.render(<App />);
    });

    expect(screen().getByRole('heading', { name: 'Active tabs' })).not.toBeNull();
    expect(screen().getByText('1 open')).not.toBeNull();
    expect(sendExtensionMessage.mock.calls.map((call) => (call[0] as { type: string }).type)).toEqual(
      expect.arrayContaining(['active-tabs:list', 'sessions:list']),
    );

    const mainText = container.textContent ?? '';
    expect(mainText.indexOf('Active tabs')).toBeLessThan(mainText.indexOf('No saved sessions yet.'));
  });
});

function screen() {
  return {
    getByRole(role: string, options?: { name?: string }) {
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((element) => {
        if (role === 'button') return element.tagName === 'BUTTON';
        if (role === 'heading') return /^H[1-6]$/.test(element.tagName);
        return element.getAttribute('role') === role;
      });
      const match = elements.find((element) => {
        if (!options?.name) return true;
        return element.textContent?.trim() === options.name;
      });
      if (!match) throw new Error(`Missing role: ${role} ${options?.name ?? ''}`.trim());
      return match;
    },
    getByText(text: string) {
      const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
        (element) => element.textContent?.trim() === text,
      );
      if (!match) throw new Error(`Missing text: ${text}`);
      return match;
    },
  };
}
