import { act, type ComponentProps, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';
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

const savedSession: TabSession = {
  id: 'session-1',
  title: '2 tabs stowed',
  tabs: [
    { id: 'tab-1', title: 'API saved', url: 'https://saved.example.com', createdAt: '2026-07-13T00:00:00.000Z' },
    { id: 'tab-2', title: 'Other', url: 'https://other.example.com', createdAt: '2026-07-13T00:00:00.000Z' },
  ],
  createdAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z',
  deviceId: 'device-1',
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
    expect(container.querySelectorAll('.unified-search-suggestion:not(.unified-search-web)')).toHaveLength(1);
    expect(container.querySelectorAll('.unified-search-web')).toHaveLength(1);

    const local = container.querySelector<HTMLButtonElement>(
      '.unified-search-suggestion:not(.unified-search-web)',
    )!;
    local.focus();
    const tabEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    await act(async () => local.dispatchEvent(tabEvent));
    expect(tabEvent.defaultPrevented).toBe(false);

    input.focus();
    const enterEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' });
    await act(async () => {
      input.dispatchEvent(enterEvent);
      container.querySelector<HTMLFormElement>('form')!.requestSubmit();
    });
    expect(enterEvent.defaultPrevented).toBe(false);
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
      [savedSession],
      onSavedOpened,
    );
    await change(container.querySelector<HTMLInputElement>('input')!, 'api');
    sendExtensionMessage.mockResolvedValue({ ok: true, data: { opened: true, consumed: true } });
    await click(container.querySelector<HTMLButtonElement>('.unified-search-suggestion')!);
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'sessions:open-tab', sessionId: 'session-1', tabId: 'tab-1', consume: true });
    expect(onSavedOpened).toHaveBeenCalledTimes(1);
  });

  it('renders represented local sources as labelled button groups plus an independent Web row', async () => {
    await renderSearch(snapshot, [savedSession]);
    await change(container.querySelector<HTMLInputElement>('input')!, 'api');

    expect(groupLabels()).toEqual(['Active', 'Saved']);
    expect(container.textContent).toContain('Current window');
    expect(container.textContent).toContain('Ungrouped');
    expect(container.textContent).toContain('2 tabs stowed');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="option"]')).toBeNull();
    expect(container.querySelectorAll('.unified-search-suggestion:not(.unified-search-web)')).toHaveLength(2);
    expect(container.querySelectorAll('.unified-search-web')).toHaveLength(1);
  });

  it('disambiguates duplicate titles with named and unnamed group context instead of IDs', async () => {
    const duplicates: ActiveTabsSnapshot = {
      windows: [
        { id: 12, focused: false, incognito: false, type: 'normal' },
        { id: 8, focused: true, incognito: false, type: 'normal' },
      ],
      tabs: [
        { ...snapshot.tabs[0], id: 21, windowId: 8, groupId: 31, title: 'API docs', url: 'https://first.example/' },
        { ...snapshot.tabs[0], id: 22, windowId: 12, groupId: 42, title: 'API docs', url: 'https://second.example/' },
      ],
      chromeGroups: [
        { id: 31, windowId: 8, title: 'Work', color: 'blue', collapsed: false },
        { id: 42, windowId: 12, title: '', color: 'grey', collapsed: false },
      ],
    };

    await renderSearch(duplicates, []);
    await change(container.querySelector<HTMLInputElement>('input')!, 'api');

    expect(container.textContent).toContain('Current window · Work');
    expect(container.textContent).toContain('Window 2 · Unnamed group');
    expect(container.textContent).not.toContain('31');
    expect(container.textContent).not.toContain('42');
  });

  it('keeps the Web action visible with no local matches and runs it only when clicked', async () => {
    await renderSearch({ windows: [], tabs: [], chromeGroups: [] }, []);
    await change(container.querySelector<HTMLInputElement>('input')!, 'outside');

    expect(groupLabels()).toEqual([]);
    expect(container.querySelectorAll('.unified-search-suggestion:not(.unified-search-web)')).toHaveLength(0);
    const web = container.querySelector<HTMLButtonElement>('.unified-search-web')!;
    expect(web).not.toBeNull();

    await click(web);

    expect(sendExtensionMessage).toHaveBeenCalledTimes(1);
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'active-tabs:search', query: 'outside' });
  });

  it('caps locals at five without letting the Web row consume the local quota', async () => {
    const many: ActiveTabsSnapshot = {
      windows: snapshot.windows,
      chromeGroups: [],
      tabs: Array.from({ length: 7 }, (_, index) => ({
        ...snapshot.tabs[0],
        id: index + 20,
        index,
        title: `API ${index}`,
      })),
    };

    await renderSearch(many, []);
    await change(container.querySelector<HTMLInputElement>('input')!, 'api');

    expect(container.querySelectorAll('.unified-search-suggestion:not(.unified-search-web)')).toHaveLength(5);
    expect(container.querySelectorAll('.unified-search-web')).toHaveLength(1);
  });

  it('disables local and Web actions while another mutation is busy', async () => {
    await renderSearch(snapshot, [], vi.fn(), true, 'api');

    const local = container.querySelector<HTMLButtonElement>(
      '.unified-search-suggestion:not(.unified-search-web)',
    )!;
    const web = container.querySelector<HTMLButtonElement>('.unified-search-web')!;
    expect(local.disabled).toBe(true);
    expect(web.disabled).toBe(true);

    await click(local);
    await click(web);

    expect(sendExtensionMessage).not.toHaveBeenCalled();
  });
});

function groupLabels() {
  return Array.from(
    container.querySelectorAll('.unified-search-group:not(.unified-search-group--web) .unified-search-group-label'),
  ).map(
    (element) => element.textContent,
  );
}

async function renderSearch(
  activeSnapshot: ActiveTabsSnapshot,
  sessions: ComponentProps<typeof UnifiedSearch>['sessions'],
  onSavedOpened = vi.fn(),
  disabled = false,
  initialValue = '',
) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return <UnifiedSearch activeSnapshot={activeSnapshot} disabled={disabled} locale="en" onChange={setValue} onSavedOpened={onSavedOpened} onStatus={() => undefined} sessions={sessions} value={value} />;
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
