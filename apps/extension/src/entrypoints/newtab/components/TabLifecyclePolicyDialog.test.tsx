import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '@/lib/messages';
import { TabLifecyclePolicyDialog } from './TabLifecyclePolicyDialog';

const sendExtensionMessage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const DEFAULT_STATE = {
  policy: {
    automaticSleepEnabled: false,
    automaticSleepAfterDays: 7 as const,
    stowSuggestionsEnabled: true,
    stowSuggestionAfterDays: 14 as const,
  },
  automaticSleepCapability: { status: 'supported' as const },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  root = createRoot(container);
  sendExtensionMessage.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('TabLifecyclePolicyDialog', () => {
  it('loads the device-local policy into an editable draft', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: DEFAULT_STATE });

    await renderDialog();

    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'tab-lifecycle:get-state' });
    expect(getCheckbox('Automatic sleep').checked).toBe(false);
    expect(getSelect('Sleep after inactivity').value).toBe('7');
    expect(getSelect('Sleep after inactivity').disabled).toBe(true);
    expect(Array.from(getSelect('Sleep after inactivity').options).map((option) => option.text)).toEqual([
      '1 day',
      '3 days',
      '7 days',
      '14 days',
      '30 days',
    ]);
    expect(getCheckbox('Saved for later suggestions').checked).toBe(true);
    expect(getSelect('Suggest after observed sleep').value).toBe('14');
    expect(document.body.textContent).toContain('Automatic sleep is available.');
    expect(document.body.textContent).toContain('These settings stay on this device');
  });

  it('discards an unsaved draft when Cancel is chosen', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: DEFAULT_STATE });
    const onClose = vi.fn();
    await renderDialog({ onClose });

    await click(getCheckbox('Saved for later suggestions'));
    await click(getButtons('Cancel').find((button) => button.textContent === 'Cancel')!);

    expect(messagesOfType('tab-lifecycle:update-policy')).toHaveLength(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('previews an enabled draft and saves the complete policy only after confirmation', async () => {
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'tab-lifecycle:get-state') {
        return { ok: true, data: DEFAULT_STATE };
      }
      if (message.type === 'tab-lifecycle:preview-auto-sleep') {
        return { ok: true, data: { eligibleTabCount: message.afterDays === 3 ? 4 : 2 } };
      }
      if (message.type === 'tab-lifecycle:update-policy') {
        return {
          ok: true,
          data: { policy: message.policy, automaticSleepCapability: { status: 'supported' } },
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const onClose = vi.fn();
    await renderDialog({ onClose });

    await click(getCheckbox('Automatic sleep'));
    expect(sendExtensionMessage).toHaveBeenLastCalledWith({
      type: 'tab-lifecycle:preview-auto-sleep',
      afterDays: 7,
    });
    expect(document.body.textContent).toContain(
      '2 tabs currently match this rule and may sleep soon after saving.',
    );
    expect(messagesOfType('tab-lifecycle:update-policy')).toHaveLength(0);

    await change(getSelect('Sleep after inactivity'), '3');
    expect(sendExtensionMessage).toHaveBeenLastCalledWith({
      type: 'tab-lifecycle:preview-auto-sleep',
      afterDays: 3,
    });
    expect(document.body.textContent).toContain(
      '4 tabs currently match this rule and may sleep soon after saving.',
    );

    await click(getCheckbox('Automatic sleep'));
    expect(getSelect('Sleep after inactivity').disabled).toBe(true);
    expect(getSelect('Sleep after inactivity').value).toBe('3');

    await click(getCheckbox('Saved for later suggestions'));
    expect(getSelect('Suggest after observed sleep').disabled).toBe(true);
    expect(getSelect('Suggest after observed sleep').value).toBe('14');
    expect(messagesOfType('tab-lifecycle:update-policy')).toHaveLength(0);

    await click(getCheckbox('Automatic sleep'));
    await click(getButton('Save settings'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'tab-lifecycle:update-policy',
      policy: {
        automaticSleepEnabled: true,
        automaticSleepAfterDays: 3,
        stowSuggestionsEnabled: false,
        stowSuggestionAfterDays: 14,
      },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gates unsupported automatic sleep with the accepted English and Chinese copy', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: true,
      data: {
        ...DEFAULT_STATE,
        automaticSleepCapability: { status: 'unsupported' },
      },
    });

    await renderDialog();

    expect(getCheckbox('Automatic sleep').disabled).toBe(true);
    expect(getCheckbox('Saved for later suggestions').disabled).toBe(false);
    expect(document.body.textContent).toContain(
      'Automatic sleep requires Chrome 121 or later. Update Chrome to use inactivity-based rules. Manual sleep and Saved for later suggestions still work.',
    );

    await renderDialog({ locale: 'zh-CN' });
    expect(document.body.textContent).toContain(
      '自动休眠需要 Chrome 121 或更高版本。请更新 Chrome 后使用基于未访问时长的规则；手动休眠和‘稍后查看’建议仍可使用。',
    );
  });

  it('lets a persisted unsupported rule be turned off but not back on', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: true,
      data: {
        policy: { ...DEFAULT_STATE.policy, automaticSleepEnabled: true },
        automaticSleepCapability: { status: 'unsupported' },
      },
    });

    await renderDialog();

    expect(getCheckbox('Automatic sleep').disabled).toBe(false);
    expect(getSelect('Sleep after inactivity').disabled).toBe(true);
    await click(getCheckbox('Automatic sleep'));
    expect(getCheckbox('Automatic sleep').checked).toBe(false);
    expect(getCheckbox('Automatic sleep').disabled).toBe(true);
  });

  it('distinguishes a transient capability failure and retries without losing the draft', async () => {
    let requestCount = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type !== 'tab-lifecycle:get-state') {
        throw new Error(`Unexpected message: ${message.type}`);
      }
      requestCount += 1;
      return requestCount === 1
        ? {
            ok: true,
            data: {
              ...DEFAULT_STATE,
              automaticSleepCapability: {
                status: 'unavailable',
                message: 'Chrome tabs could not be queried.',
              },
            },
          }
        : { ok: true, data: DEFAULT_STATE };
    });
    await renderDialog();
    await click(getCheckbox('Saved for later suggestions'));

    expect(document.body.textContent).toContain(
      'Automatic sleep availability could not be checked. Chrome tabs could not be queried.',
    );
    expect(getCheckbox('Automatic sleep').disabled).toBe(true);
    await click(getButton('Retry'));

    expect(sendExtensionMessage).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Automatic sleep is available.');
    expect(getCheckbox('Automatic sleep').disabled).toBe(false);
    expect(getCheckbox('Saved for later suggestions').checked).toBe(false);
  });

  it('keeps a loading failure open and offers Retry', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'chrome-tabs-error', message: 'Could not load lifecycle settings.' },
      })
      .mockResolvedValueOnce({ ok: true, data: DEFAULT_STATE });
    const onClose = vi.fn();
    await renderDialog({ onClose });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Could not load lifecycle settings.');
    expect(getButton('Save settings').disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    await click(getButton('Retry'));
    expect(getCheckbox('Automatic sleep')).toBeTruthy();
    expect(sendExtensionMessage).toHaveBeenCalledTimes(2);
  });

  it('locks dismissal while saving and preserves the draft after a save failure', async () => {
    const update = deferred<{
      ok: false;
      error: { code: 'unknown-error'; message: string };
    }>();
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'tab-lifecycle:get-state') {
        return { ok: true, data: DEFAULT_STATE };
      }
      if (message.type === 'tab-lifecycle:preview-auto-sleep') {
        return { ok: true, data: { eligibleTabCount: 5 } };
      }
      if (message.type === 'tab-lifecycle:update-policy') return update.promise;
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const onClose = vi.fn();
    await renderDialog({ onClose });
    await click(getCheckbox('Automatic sleep'));
    await change(getSelect('Sleep after inactivity'), '30');

    await act(async () => getButton('Save settings').click());

    expect(getCheckbox('Automatic sleep').disabled).toBe(true);
    expect(getSelect('Sleep after inactivity').disabled).toBe(true);
    expect(getButtons('Cancel').every((button) => button.disabled)).toBe(true);
    await keyDown('Escape');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => update.resolve({
      ok: false,
      error: { code: 'unknown-error', message: 'Settings could not be saved.' },
    }));

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Settings could not be saved.');
    expect(getCheckbox('Automatic sleep').checked).toBe(true);
    expect(getSelect('Sleep after inactivity').value).toBe('30');
    expect(getButtons('Cancel').every((button) => !button.disabled)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

async function renderDialog(
  overrides: Partial<ComponentProps<typeof TabLifecyclePolicyDialog>> = {},
) {
  await act(async () => {
    root.render(
      <TabLifecyclePolicyDialog
        locale="en"
        onClose={() => undefined}
        {...overrides}
      />,
    );
  });
}

function getCheckbox(label: string) {
  return getLabeledControl<HTMLInputElement>(label, 'input[type="checkbox"]');
}

function getSelect(label: string) {
  return getLabeledControl<HTMLSelectElement>(label, 'select');
}

function getLabeledControl<T extends HTMLElement>(label: string, selector: string): T {
  const match = Array.from(document.body.querySelectorAll<HTMLLabelElement>('label')).find(
    (item) => item.textContent?.includes(label),
  );
  const control = match?.querySelector<T>(selector);
  if (!control) throw new Error(`Missing control: ${label}`);
  return control;
}

function getButton(name: string) {
  const button = getButtons(name)[0];
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function getButtons(name: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).filter(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function messagesOfType(type: ExtensionMessage['type']) {
  return sendExtensionMessage.mock.calls
    .map(([message]) => message as ExtensionMessage)
    .filter((message) => message.type === type);
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string | boolean) {
  await act(async () => {
    if (element instanceof HTMLInputElement) element.checked = Boolean(value);
    else element.value = String(value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function keyDown(key: string) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
