import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings } from '@tabstow/core';
import { OptionsApp } from './OptionsApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn(),
}));

vi.mock('@/lib/messages', () => {
  return {
    sendExtensionMessage,
  };
});

const SETTINGS: ExtensionSettings = {
  deviceId: 'device-123',
  githubToken: 'token-abc',
  gistId: 'gist-456',
  gistFileName: 'saved-tabs.json',
  includePinnedTabs: true,
  closePinnedTabs: false,
  theme: 'dark',
};

let container: HTMLDivElement;

describe('OptionsApp', () => {
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sendExtensionMessage.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('loads saved settings and renders manual sync controls', async () => {
    sendExtensionMessage.mockResolvedValueOnce({ ok: true, data: SETTINGS });

    await act(async () => {
      root.render(<OptionsApp />);
    });

    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'settings:get' });
    expect(screen().getByRole('heading', { name: 'Tabstow Settings' })).not.toBeNull();
    expect(screen().getByLabelText('GitHub token')).toHaveProperty('value', SETTINGS.githubToken);
    expect(screen().getByLabelText('Gist ID')).toHaveProperty('value', SETTINGS.gistId);
    expect(screen().getByLabelText('Gist filename')).toHaveProperty('value', SETTINGS.gistFileName);
    expect(screen().getByLabelText('Save pinned tabs when stowing')).toHaveProperty(
      'checked',
      SETTINGS.includePinnedTabs,
    );
    expect(screen().getByLabelText('Close pinned tabs after saving')).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen().getByLabelText('Theme')).toHaveProperty('value', SETTINGS.theme);
    expect(screen().getByText(SETTINGS.deviceId)).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Save' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Pull' })).not.toBeNull();
    expect(screen().getByRole('button', { name: 'Push' })).not.toBeNull();
  });

  it('saves settings before running a manual pull sync', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, data: SETTINGS })
      .mockResolvedValueOnce({ ok: true, data: SETTINGS })
      .mockResolvedValueOnce({ ok: true, data: { sessionCount: 3 } });

    await act(async () => {
      root.render(<OptionsApp />);
    });

    await act(async () => {
      screen().getByRole('button', { name: 'Pull' }).click();
    });

    expect(sendExtensionMessage.mock.calls).toEqual([
      [{ type: 'settings:get' }],
      [
        {
          type: 'settings:update',
          settings: SETTINGS,
        },
      ],
      [{ type: 'sync:pull' }],
    ]);
    expect(screen().getByRole('status').textContent).toBe('Pulled 3 sessions.');
  });
});

function screen() {
  return {
    getByLabelText(text: string) {
      const labels = Array.from(containerLabels());
      const label = labels.find((candidate) => candidate.textContent?.includes(text));
      if (!label) throw new Error(`Missing label: ${text}`);
      const control = label.querySelector('input, select, textarea');
      if (!control) throw new Error(`Missing control for label: ${text}`);
      return control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    },
    getByRole(role: string, options?: { name?: string }) {
      const elements = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((element) => {
        if (role === 'button') return element.tagName === 'BUTTON';
        if (role === 'status') return element.getAttribute('role') === 'status';
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

function* containerLabels() {
  yield* Array.from(document.querySelectorAll('label'));
}
