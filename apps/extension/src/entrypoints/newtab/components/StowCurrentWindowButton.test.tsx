import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StowCurrentWindowButton } from './StowCurrentWindowButton';

const sendExtensionMessage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sendExtensionMessage.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('StowCurrentWindowButton', () => {
  it('describes its neutral loading state', async () => {
    sendExtensionMessage.mockReturnValue(new Promise(() => undefined));

    await renderButton();

    expect(getButton().disabled).toBe(true);
    expect(getButton().classList.contains('secondary-button')).toBe(true);
    expect(getDescription().textContent).toBe('Checking current window…');
  });

  it('uses the canonical Stow window label', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 1 } });

    await renderButton();

    expect(getButton().textContent).toContain('Stow window');
    expect(getDescription().textContent).toBe('1 tab ready');
  });

  it('shows the authoritative count and disables itself when no tabs are eligible', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 3 } });
    await renderButton();

    expect(getButton().textContent).toContain('3 tabs ready');
    expect(getButton().disabled).toBe(false);
    expect(getButton().classList.contains('primary-button')).toBe(true);
    expect(getDescription().textContent).toBe('3 tabs ready');

    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 0 } });
    await renderButton({ refreshKey: 1 });

    expect(getButton().textContent).toContain('No tabs ready');
    expect(getButton().disabled).toBe(true);
    expect(getButton().classList.contains('primary-button')).toBe(false);
    expect(getButton().classList.contains('secondary-button')).toBe(true);
    expect(getDescription().textContent).toBe('No tabs ready');
  });

  it('blocks duplicate submissions and uses indeterminate busy copy', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 2 } });
    let finish: (() => void) | undefined;
    const onStow = vi.fn(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    await renderButton({ onStow });

    await act(async () => {
      getButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      getButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onStow).toHaveBeenCalledTimes(1);
    expect(getButton().disabled).toBe(true);
    expect(getButton().textContent).toContain('Stowing window…');
    expect(getButton().textContent).not.toMatch(/\d+\s*\/\s*\d+/);

    await act(async () => finish?.());
  });

  it('reports preview errors and keeps the mutation unavailable', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Chrome is unavailable.' },
    });
    const onStatus = vi.fn();

    await renderButton({ onStatus });

    expect(onStatus).toHaveBeenCalledWith('error', 'Chrome is unavailable.');
    expect(getButton().textContent).toContain('Chrome is unavailable.');
    expect(getButton().disabled).toBe(true);
    expect(getButton().classList.contains('primary-button')).toBe(false);
    expect(getDescription().textContent).toBe('Chrome is unavailable.');
  });

  it('exposes the localized zero reason in Simplified Chinese', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 0 } });

    await renderButton({ locale: 'zh-CN' });

    expect(getDescription().textContent).toBe('没有可收起的标签页');
  });

  it('explains when another app action temporarily disables Stow', async () => {
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { eligibleTabCount: 3 } });

    await renderButton({ disabled: true });

    expect(getButton().disabled).toBe(true);
    expect(getButton().classList.contains('secondary-button')).toBe(true);
    expect(getDescription().textContent).toBe('Wait for the current action to finish.');
  });
});

async function renderButton(
  overrides: Partial<ComponentProps<typeof StowCurrentWindowButton>> = {},
) {
  await act(async () => {
    root.render(
      <StowCurrentWindowButton
        busy={false}
        disabled={false}
        locale="en"
        onStatus={() => undefined}
        onStow={() => Promise.resolve()}
        refreshKey={0}
        {...overrides}
      />,
    );
  });
}

function getButton() {
  const button = container.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error('Missing stow button');
  return button;
}

function getDescription() {
  const descriptionId = getButton().getAttribute('aria-describedby');
  if (!descriptionId) throw new Error('Missing stow button description');
  const description = document.getElementById(descriptionId);
  if (!description) throw new Error('Missing stow button description element');
  return description;
}
