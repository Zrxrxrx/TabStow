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
const clipboardWriteText = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

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

const NEEDS_TARGET: ConnectionView = {
  phase: 'needs-target',
  account: { id: 1, login: 'octocat' },
  sync: { state: 'needs-target' },
  candidates: [],
};

const NEEDS_CONFIRMATION: ConnectionView = {
  phase: 'needs-confirmation',
  account: { id: 1, login: 'octocat' },
  sync: { state: 'needs-confirmation' },
  pendingBinding: {
    gistId: 'gist-456',
    fileName: 'tabstow.sync.json',
    public: false,
    htmlUrl: 'https://gist.github.com/octocat/gist-456',
    ownerId: 1,
    targetKey: 'octocat:gist-456:tabstow.sync.json',
    fileState: 'valid-v2',
    localCounts: { sessionCount: 1, tabCount: 3, quickLinkCount: 2 },
  },
};

let container: HTMLDivElement;
let runtimeMessageListener: ((message: unknown) => void) | undefined;

function respondWith(
  connection: ConnectionView,
  settings: ExtensionSettings | (() => ExtensionSettings) = SETTINGS,
) {
  sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'settings:get') {
      return { ok: true, data: typeof settings === 'function' ? settings() : settings };
    }
    if (message.type === 'connection:get') return { ok: true, data: connection };
    return { ok: false, error: { code: 'unexpected', message: message.type } };
  });
}

async function emitRuntimeMessage(message: unknown) {
  await act(async () => {
    runtimeMessageListener?.(message);
    await Promise.resolve();
  });
}

function messagesOfType(type: string) {
  return sendExtensionMessage.mock.calls.filter(([message]) => message.type === type);
}

describe('OptionsApp', () => {
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
    clipboardWriteText.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
    runtimeMessageListener = undefined;
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
          onMessage: {
            addListener: vi.fn((listener: (message: unknown) => void) => {
              runtimeMessageListener = listener;
            }),
            removeListener: vi.fn((listener: (message: unknown) => void) => {
              if (runtimeMessageListener === listener) runtimeMessageListener = undefined;
            }),
          },
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

  it('presents GitHub sync as optional and separates it from saved preferences', async () => {
    respondWith(DISCONNECTED);

    await act(async () => root.render(<OptionsApp />));

    expect(container.textContent).toContain('Tabstow works locally first. GitHub sync is optional.');
    expect(screen().getByText('Optional GitHub sync')).not.toBeNull();
    expect(container.textContent).toContain('Saved windows, Quick Links, and pinned-tab preferences');
    expect(container.textContent).not.toContain('Disconnect removes access from this device only.');
    expect(screen().getByText('Stow preferences')).not.toBeNull();

    const saveButton = screen().getByRole('button', { name: 'Save preferences' });
    expect(saveButton.closest('section')?.getAttribute('aria-labelledby')).toBe('behavior-heading');
    expect(saveButton.getAttribute('aria-describedby')).toBe('settings-save-state');
    expect(screen().getByText('Preferences are up to date.')).not.toBeNull();
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
    expect(container.textContent).not.toContain('Manage or revoke this OAuth App on GitHub');
  });

  it('shows target selection with an authenticated exit path only when target selection is needed', async () => {
    respondWith(NEEDS_TARGET);

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByRole('button', { name: 'Use existing Gist' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Rescan' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Disconnect' })).not.toBeNull();
    expect(container.textContent).toContain('Manage or revoke this OAuth App on GitHub');
    expect(screen().queryByRole('button', { name: 'Pull' })).toBeNull();
  });

  it('shows confirmation choices with an authenticated exit path only while confirmation is needed', async () => {
    respondWith(NEEDS_CONFIRMATION);

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByRole('button', { name: 'Confirm and synchronize' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Choose another Gist' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Disconnect' })).not.toBeNull();
    expect(container.textContent).toContain('Manage or revoke this OAuth App on GitHub');
    expect(screen().queryByRole('button', { name: 'Pull' })).toBeNull();
  });

  it('keeps manual Pull and Push only after a Gist is connected', async () => {
    respondWith(CONNECTED);

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByRole('button', { name: 'Pull' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Push' })).not.toBeNull();
    expect(screen().getByText('Connected as octocat')).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Disconnect' })).not.toBeNull();
    expect(screen().queryByRole('button', { name: 'Retry now' })).toBeNull();
    expect(container.textContent).toContain('Manage or revoke this OAuth App on GitHub');
  });

  it.each([
    [
      'retrying',
      { ...CONNECTED, sync: { state: 'retrying' as const, message: 'Retry scheduled.' } },
      ['Retry now'],
      ['Reconnect GitHub', 'Pull', 'Push', 'Choose another Gist'],
    ],
    [
      'paused authorization',
      { ...CONNECTED, sync: { state: 'paused' as const, action: 'reconnect' as const } },
      ['Reconnect GitHub'],
      ['Retry now', 'Pull', 'Push', 'Choose another Gist'],
    ],
    [
      'paused target binding',
      { ...CONNECTED, sync: { state: 'paused' as const, action: 'rebind' as const } },
      ['Choose another Gist'],
      ['Retry now', 'Reconnect GitHub', 'Pull', 'Push', 'Open Gist'],
    ],
    [
      'paused file inspection',
      { ...CONNECTED, sync: { state: 'paused' as const, action: 'inspect-file' as const } },
      ['Open Gist', 'Choose another Gist', 'Retry now'],
      ['Reconnect GitHub', 'Pull', 'Push'],
    ],
    [
      'active synchronization',
      { ...CONNECTED, sync: { state: 'syncing' as const } },
      ['Open Gist'],
      ['Pull', 'Push', 'Retry now', 'Reconnect GitHub', 'Choose another Gist'],
    ],
  ])('shows only the relevant connected actions for %s', async (_name, connection, visible, hidden) => {
    respondWith(connection);

    await act(async () => root.render(<OptionsApp />));

    for (const name of visible) {
      expect(screen().getByRole('button', { name })).not.toBeNull();
    }
    for (const name of hidden) {
      expect(screen().queryByRole('button', { name })).toBeNull();
    }
  });

  it('runs manual Pull without resaving settings first', async () => {
    respondWith(CONNECTED);
    await act(async () => root.render(<OptionsApp />));
    await act(async () => screen().getByLabelText('Save pinned tabs when stowing').click());
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
    await act(async () => screen().getByRole('button', { name: 'Save preferences' }).click());

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'settings:update',
      settings: { includePinnedTabs: false },
    });
    expect(sendExtensionMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ deviceId: expect.anything() }) }),
    );
    expect(screen().getByRole('status').textContent).toBe('Preferences saved.');
    expect((screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays clean when a saved preference is changed and then reverted', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    const saveButton = screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement;

    expect(saveButton.disabled).toBe(true);

    await act(async () => includePinnedTabs.closest('label')!.click());
    expect(saveButton.disabled).toBe(false);

    await act(async () => includePinnedTabs.click());
    expect(saveButton.disabled).toBe(true);
  });

  it('rebases only true local edits onto incoming synchronized settings', async () => {
    let remoteSettings = SETTINGS;
    respondWith(DISCONNECTED, () => remoteSettings);
    await act(async () => root.render(<OptionsApp />));

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    const closePinnedTabs = screen().getByLabelText('Close pinned tabs after saving') as HTMLInputElement;
    const saveButton = screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement;

    remoteSettings = { ...SETTINGS, closePinnedTabs: true };
    await emitRuntimeMessage({ type: 'sync:data-changed' });
    expect(includePinnedTabs.checked).toBe(true);
    expect(closePinnedTabs.checked).toBe(true);
    expect(saveButton.disabled).toBe(true);

    await act(async () => includePinnedTabs.click());
    expect(saveButton.disabled).toBe(false);

    remoteSettings = { ...remoteSettings, includePinnedTabs: false };
    await emitRuntimeMessage({ type: 'sync:data-changed' });
    expect(includePinnedTabs.checked).toBe(false);
    expect(closePinnedTabs.checked).toBe(true);
    expect(saveButton.disabled).toBe(true);

    await act(async () => includePinnedTabs.click());
    remoteSettings = { ...remoteSettings, closePinnedTabs: false };
    await emitRuntimeMessage({ type: 'sync:data-changed' });
    expect(includePinnedTabs.checked).toBe(true);
    expect(closePinnedTabs.checked).toBe(false);
    expect(saveButton.disabled).toBe(false);
  });

  it('keeps preference controls unavailable when authoritative settings fail to load', async () => {
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings:get') {
        return { ok: false, error: { code: 'storage-error', message: 'Settings unavailable.' } };
      }
      if (message.type === 'connection:get') return { ok: true, data: DISCONNECTED };
      return { ok: false, error: { code: 'unexpected', message: message.type } };
    });

    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByLabelText('Save pinned tabs when stowing').disabled).toBe(true);
    expect(screen().getByLabelText('Close pinned tabs after saving').disabled).toBe(true);
    expect((screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen().getByRole('alert').textContent).toBe('Settings unavailable.');
    expect(screen().getByText('Preferences are unavailable.')).not.toBeNull();
  });

  it('ignores an older settings response after a newer synchronized reload completes', async () => {
    const older = deferred<{ ok: true; data: ExtensionSettings }>();
    const newer = deferred<{ ok: true; data: ExtensionSettings }>();
    let settingsRequestCount = 0;
    sendExtensionMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'settings:get') {
        settingsRequestCount += 1;
        return settingsRequestCount === 1 ? older.promise : newer.promise;
      }
      if (message.type === 'connection:get') return Promise.resolve({ ok: true, data: DISCONNECTED });
      return Promise.resolve({ ok: false, error: { code: 'unexpected', message: message.type } });
    });

    await act(async () => root.render(<OptionsApp />));
    await emitRuntimeMessage({ type: 'sync:data-changed' });
    await act(async () =>
      newer.resolve({ ok: true, data: { ...SETTINGS, includePinnedTabs: false } }),
    );

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    expect(includePinnedTabs.checked).toBe(false);

    await act(async () => older.resolve({ ok: true, data: SETTINGS }));
    expect(includePinnedTabs.checked).toBe(false);
  });

  it('re-reads authoritative settings after a save overlaps an incoming sync update', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));

    const incomingReload = deferred<{ ok: true; data: ExtensionSettings }>();
    const save = deferred<{ ok: true; data: ExtensionSettings }>();
    const afterSaveReload = deferred<{ ok: true; data: ExtensionSettings }>();
    let reloadCount = 0;
    sendExtensionMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'settings:update') return save.promise;
      if (message.type === 'settings:get') {
        reloadCount += 1;
        return reloadCount === 1 ? incomingReload.promise : afterSaveReload.promise;
      }
      return Promise.resolve({ ok: false, error: { code: 'unexpected', message: message.type } });
    });

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    const closePinnedTabs = screen().getByLabelText('Close pinned tabs after saving') as HTMLInputElement;
    const saveButton = screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement;

    await act(async () => includePinnedTabs.click());
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });
    await emitRuntimeMessage({ type: 'sync:data-changed' });
    await act(async () =>
      incomingReload.resolve({ ok: true, data: { ...SETTINGS, closePinnedTabs: true } }),
    );
    expect(includePinnedTabs.checked).toBe(false);
    expect(closePinnedTabs.checked).toBe(true);

    await act(async () => {
      save.resolve({ ok: true, data: { ...SETTINGS, includePinnedTabs: false } });
      await Promise.resolve();
      afterSaveReload.resolve({
        ok: true,
        data: { ...SETTINGS, includePinnedTabs: false, closePinnedTabs: true },
      });
      await Promise.resolve();
    });

    expect(includePinnedTabs.checked).toBe(false);
    expect(closePinnedTabs.checked).toBe(true);
    expect(saveButton.disabled).toBe(true);
  });

  it('keeps the Device ID in diagnostics and reports copy success or failure', async () => {
    respondWith(DISCONNECTED);
    clipboardWriteText.mockResolvedValue(undefined);
    await act(async () => root.render(<OptionsApp />));

    expect(screen().getByText('Advanced / diagnostics')).not.toBeNull();
    expect(screen().getByText('Device ID')).not.toBeNull();
    const copyButton = screen().getByRole('button', { name: 'Copy Device ID' });
    const deviceDescriptionId = copyButton.getAttribute('aria-describedby');
    expect(deviceDescriptionId).toBe('device-id-description');
    expect(document.getElementById(deviceDescriptionId!)?.textContent).toBe('replica-123');

    await act(async () => copyButton.click());
    expect(clipboardWriteText).toHaveBeenCalledWith('replica-123');
    expect(screen().getByRole('status').textContent).toBe('Device ID copied.');

    clipboardWriteText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await act(async () => copyButton.click());
    expect(screen().getByRole('alert').textContent).toBe('Could not copy the Device ID.');
  });

  it('retains the draft and minimal patch after a save failure', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));
    sendExtensionMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'settings:update') {
        return { ok: false, error: { code: 'storage-error', message: 'Could not save preferences.' } };
      }
      return { ok: false, error: { code: 'unexpected', message: message.type } };
    });

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    const saveButton = screen().getByRole('button', { name: 'Save preferences' }) as HTMLButtonElement;
    await act(async () => includePinnedTabs.click());
    await act(async () => saveButton.click());

    expect(includePinnedTabs.checked).toBe(false);
    expect(saveButton.disabled).toBe(false);
    expect(screen().getByRole('alert').textContent).toBe('Could not save preferences.');

    await act(async () => saveButton.click());
    expect(messagesOfType('settings:update')).toHaveLength(2);
    expect(sendExtensionMessage).toHaveBeenLastCalledWith({
      type: 'settings:update',
      settings: { includePinnedTabs: false },
    });
  });

  it('blocks same-frame duplicate preference saves', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));
    const update = deferred<{
      ok: true;
      data: ExtensionSettings;
    }>();
    sendExtensionMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'settings:update') return update.promise;
      return Promise.resolve({ ok: false, error: { code: 'unexpected', message: message.type } });
    });

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    await act(async () => includePinnedTabs.click());
    const saveButton = screen().getByRole('button', { name: 'Save preferences' });
    await act(async () => {
      saveButton.click();
      saveButton.click();
      await Promise.resolve();
    });

    expect(messagesOfType('settings:update')).toHaveLength(1);
    expect(includePinnedTabs.disabled).toBe(true);

    await act(async () =>
      update.resolve({ ok: true, data: { ...SETTINGS, includePinnedTabs: false } }),
    );
  });

  it('disables but does not clear the close-pinned preference dependency', async () => {
    respondWith(DISCONNECTED);
    await act(async () => root.render(<OptionsApp />));

    const includePinnedTabs = screen().getByLabelText('Save pinned tabs when stowing') as HTMLInputElement;
    const closePinnedTabs = screen().getByLabelText('Close pinned tabs after saving') as HTMLInputElement;

    await act(async () => closePinnedTabs.click());
    expect(closePinnedTabs.checked).toBe(true);

    await act(async () => includePinnedTabs.click());
    expect(closePinnedTabs.disabled).toBe(true);
    expect(closePinnedTabs.checked).toBe(true);
    expect(closePinnedTabs.getAttribute('aria-describedby')).toBe(
      'include-pinned-description settings-save-state',
    );
    expect(document.getElementById('include-pinned-description')?.textContent).toBe(
      'Save pinned tabs when stowing',
    );

    await act(async () => includePinnedTabs.click());
    expect(closePinnedTabs.disabled).toBe(false);
    expect(closePinnedTabs.checked).toBe(true);
  });
});

function screen() {
  function queryByRole(role: string, options?: { name?: string }) {
    const elements = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((element) => {
      if (role === 'button') return element.tagName === 'BUTTON';
      if (role === 'status') return element.getAttribute('role') === 'status';
      return element.getAttribute('role') === role;
    });
    return elements.find((element) => {
      if (!options?.name) return true;
      return element.textContent?.trim() === options.name;
    }) ?? null;
  }

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
      const match = queryByRole(role, options);
      if (!match) throw new Error(`Missing role: ${role} ${options?.name ?? ''}`.trim());
      return match;
    },
    queryByRole,
    getByText(text: string) {
      const match = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
        (element) => element.textContent?.trim() === text,
      );
      if (!match) throw new Error(`Missing text: ${text}`);
      return match;
    },
  };
}
