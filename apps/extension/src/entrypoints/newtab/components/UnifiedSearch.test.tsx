import { act, type ComponentProps, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { UnifiedSearch } from './UnifiedSearch';

const sendExtensionMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const snapshot: ActiveTabsSnapshot = {
  windows: [{ id: 4, focused: true, incognito: false, type: 'normal' }],
  tabs: [{ id: 7, windowId: 4, index: 0, active: true, pinned: false, groupId: -1, title: 'API docs', url: 'https://docs.example.com' }],
  chromeGroups: [],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sendExtensionMessage.mockReset();
  sendExtensionMessage.mockResolvedValue({ ok: true, data: { searched: true } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('UnifiedSearch', () => {
  it('focuses with slash, filters locally, and always submits web search from the input', async () => {
    await renderSearch(snapshot, []);
    const input = container.querySelector<HTMLInputElement>('input')!;

    await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '/' })));
    expect(document.activeElement).toBe(input);

    await change(input, 'api');
    expect(container.querySelectorAll('.unified-search-suggestion')).toHaveLength(1);

    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'active-tabs:search', query: 'api' });

    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(input.value).toBe('');
  });

  it('opens active and saved suggestions with their stable identifiers', async () => {
    await renderSearch(snapshot, []);
    const input = container.querySelector<HTMLInputElement>('input')!;
    await change(input, 'api');
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { focused: true } });
    await click(container.querySelector<HTMLButtonElement>('.unified-search-suggestion')!);
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'active-tabs:focus', tabId: 7, windowId: 4 });

    const onSavedOpened = vi.fn();
    await renderSearch(
      { windows: [], tabs: [], chromeGroups: [] },
      [{ id: 'session-1', title: 'Saved', tabs: [{ id: 'tab-1', title: 'API saved', url: 'https://saved.example.com', createdAt: '2026-07-13T00:00:00.000Z' }], createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z', deviceId: 'device-1' }],
      onSavedOpened,
    );
    await change(container.querySelector<HTMLInputElement>('input')!, 'api');
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { opened: true, consumed: true } });
    await click(container.querySelector<HTMLButtonElement>('.unified-search-suggestion')!);
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'sessions:open-tab', sessionId: 'session-1', tabId: 'tab-1', consume: true });
    expect(onSavedOpened).toHaveBeenCalledTimes(1);
  });
});

async function renderSearch(
  activeSnapshot: ActiveTabsSnapshot,
  sessions: ComponentProps<typeof UnifiedSearch>['sessions'],
  onSavedOpened = vi.fn(),
) {
  function Harness() {
    const [value, setValue] = useState('');
    return <UnifiedSearch activeSnapshot={activeSnapshot} locale="en" onChange={setValue} onSavedOpened={onSavedOpened} onStatus={() => undefined} sessions={sessions} value={value} />;
  }
  await act(async () => root.render(<Harness />));
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
