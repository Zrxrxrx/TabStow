import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings } from '@tabstow/core';
import type { ConnectionView } from '@/features/sync/sync-types';
import { OptionsApp } from './OptionsApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
}));

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

const SETTINGS: ExtensionSettings = {
  deviceId: 'replica-123',
  includePinnedTabs: true,
  closePinnedTabs: false,
};

const DISCONNECTED: ConnectionView = {
  phase: 'disconnected',
  sync: { state: 'disconnected' },
};

const CONNECTED: ConnectionView = {
  phase: 'connected',
  account: { id: 1, login: 'octocat' },
  binding: {
    gistId: 'gist-456',
    fileName: 'tabstow.sync.json',
    public: false,
    htmlUrl: 'https://gist.github.com/octocat/gist-456',
    ownerId: 1,
  },
  sync: { state: 'synced', lastSuccessAt: '2026-07-12T00:00:00.000Z' },
};

let container: HTMLDivElement;

function respondWith(connection: ConnectionView) {
  sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'settings:get') return { ok: true, data: SETTINGS };
    if (message.type === 'connection:get') return { ok: true, data: connection };
    return { ok: false, error: { code: 'unexpected', message: message.type } };
  });
}

describe('OptionsApp', () => {
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
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

  it('shares Tabstow identity and a reliable workspace return route', async () => {
    respondWith(DISCONNECTED);

    await act(async () => root.render(<OptionsApp />));

    expect(container.querySelector('h1')?.textContent).toBe('Settings');
    expect(container.textContent).toContain('Tabstow');
    const backLink = [...container.querySelectorAll('a')]
      .find((link) => link.textContent?.includes('Back to workspace'));
    expect(backLink?.getAttribute('href')).toBe('chrome-extension://tabstow-test/newtab.html');
  });

  it('replaces token fields with GitHub Device Flow connect', async () => {
    respondWith(DISCONNECTED);

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByRole('button', { name: 'Connect GitHub' })).not.toBeNull();
    expect(container.textContent).not.toContain('GitHub token');
    expect(screen().getByLabelText('Save pinned tabs when stowing')).toHaveProperty(
      'checked',
      true,
    );
    expect(() => screen().getByLabelText('Theme')).toThrow();
    expect(screen().getByText('replica-123')).not.toBeNull();
  });

  it('shows an initial theme read failure without hiding Settings', async () => {
    respondWith(DISCONNECTED);

    await act(async () =>
      root.render(<OptionsApp initialThemeError="Theme storage unavailable" />),
    );

    expect(screen().getByRole('alert').textContent).toBe('Theme storage unavailable');
    expect(container.querySelector('h1')?.textContent).toBe('Settings');
  });

  it('shows only sanitized Device Flow information', async () => {
    respondWith({
      phase: 'authorizing',
      sync: { state: 'authorizing' },
      deviceFlow: {
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 900_000,
        intervalSeconds: 300,
      },
    });

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByText('ABCD-EFGH')).not.toBeNull();
    expect(container.textContent).not.toContain('device-secret');
    expect(screen().getByRole('button', { name: 'Open GitHub' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Cancel' })).not.toBeNull();
  });

  it('keeps manual Pull and Push only after a Gist is connected', async () => {
    respondWith(CONNECTED);

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByRole('button', { name: 'Pull' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Push' })).not.toBeNull();
    expect(screen().getByText('Connected as octocat')).not.toBeNull();
  });

  it('runs manual Pull without resaving settings first', async () => {
    respondWith(CONNECTED);
    await act(async () => root.render(<OptionsApp />));
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'sync:pull') {
        return { ok: true, data: { sessionCount: 3, quickLinkCount: 2 } };
      }
      if (message.type === 'connection:get') return { ok: true, data: CONNECTED };
      return { ok: false, error: { code: 'unexpected', message: message.type } };
    });

    await act(async () => screen().getByRole('button', { name: 'Pull' }).click());

    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'sync:pull' });
    expect(sendExtensionMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings:update' }),
    );
    expect(screen().getByRole('status').textContent).toBe(
      'Pulled 3 sessions and 2 quick links.',
    );
  });

  it('saves only fields changed in this Settings view', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings:update') {
        return {
          ok: true,
          data: { ...SETTINGS, includePinnedTabs: false },
        };
      }
      return { ok: false, error: { code: 'unexpected', message: message.type } };
    });

    await act(async () => screen().getByLabelText('Save pinned tabs when stowing').click());
    await act(async () => screen().getByRole('button', { name: 'Save settings' }).click());

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'settings:update',
      settings: { includePinnedTabs: false },
    });
  });
});

function screen() {
  return {
    getByLabelText(text: string) {
      const label = Array.from(document.querySelectorAll('label')).find((candidate) =>
        candidate.textContent?.includes(text),
      );
      if (!label) throw new Error(`Missing label: ${text}`);
      const control = label.querySelector('input, select, textarea');
      if (!control) throw new Error(`Missing control for label: ${text}`);
      return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    },
    getByRole(role: string, options?: { name?: string }) {
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((element) => {
        if (role === 'button') return element.tagName === 'BUTTON';
        if (role === 'status') return element.getAttribute('role') === 'status';
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
