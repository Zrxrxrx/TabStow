import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StowSuggestionCandidate } from '@/features/tab-lifecycle/types';
import type { ExtensionMessage } from '@/lib/messages';
import { TabLifecycleSuggestions } from './TabLifecycleSuggestions';

const sendExtensionMessage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CANDIDATES: StowSuggestionCandidate[] = [
  {
    observationId: 'observation-one',
    tabId: 11,
    windowId: 1,
    index: 0,
    title: 'First sleeping tab',
    url: 'https://first.example/article',
    observedSleepingSince: 1,
    observedSleepingDays: 20,
  },
  {
    observationId: 'observation-two',
    tabId: 22,
    windowId: 2,
    index: 0,
    title: 'Second sleeping tab',
    url: 'https://second.example/article',
    observedSleepingSince: 2,
    observedSleepingDays: 15,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  sendExtensionMessage.mockReset();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('TabLifecycleSuggestions', () => {
  it('loads the global banner and keeps an open Review snapshot stable across refreshes', async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({
        ok: true,
        data: { afterDays: 14, candidates: CANDIDATES },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { afterDays: 14, candidates: [CANDIDATES[1]] },
      });

    await renderSuggestions();
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'tab-lifecycle:list-suggestions',
    });
    expect(container.textContent).toContain(
      '2 tabs have been observed sleeping on this device for at least 14 days.',
    );

    await click(getButton('Review'));
    expect(container.textContent).toContain('First sleeping tab');
    expect(container.textContent).toContain('Second sleeping tab');

    await renderSuggestions({ refreshKey: 1 });
    expect(sendExtensionMessage).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.lifecycle-suggestion-banner')?.textContent).toContain(
      '1 tab has been observed sleeping on this device for at least 14 days.',
    );
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('First sleeping tab');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Second sleeping tab');
  });

  it('snoozes exactly the currently listed observations for seven days', async () => {
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'tab-lifecycle:list-suggestions') {
        return { ok: true, data: { afterDays: 14, candidates: CANDIDATES } };
      }
      if (message.type === 'tab-lifecycle:snooze-suggestions') {
        return { ok: true, data: { updatedObservationCount: 2 } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderSuggestions();

    await click(getButton('Remind me about these in 7 days'));

    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'tab-lifecycle:snooze-suggestions',
      observationIds: ['observation-one', 'observation-two'],
    });
    expect(container.querySelector('.lifecycle-suggestion-banner')).toBeNull();
  });

  it('keeps the banner actionable when snoozing fails', async () => {
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'tab-lifecycle:list-suggestions') {
        return { ok: true, data: { afterDays: 14, candidates: CANDIDATES } };
      }
      if (message.type === 'tab-lifecycle:snooze-suggestions') {
        return {
          ok: false,
          error: { code: 'unknown-error', message: 'Observation storage was unavailable.' },
        };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderSuggestions();

    await click(getButton('Remind me about these in 7 days'));

    expect(container.textContent).toContain('Could not postpone these suggestions. Try again.');
    expect(container.textContent).toContain('Observation storage was unavailable.');
    expect(getButton('Review').disabled).toBe(false);
  });

  it('does not let an older list response reintroduce observations after snoozing', async () => {
    const staleList = deferred<{
      ok: true;
      data: { afterDays: 14; candidates: StowSuggestionCandidate[] };
    }>();
    let listRequests = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'tab-lifecycle:list-suggestions') {
        listRequests += 1;
        return listRequests === 1
          ? { ok: true, data: { afterDays: 14, candidates: CANDIDATES } }
          : staleList.promise;
      }
      if (message.type === 'tab-lifecycle:snooze-suggestions') {
        return { ok: true, data: { updatedObservationCount: 2 } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    await renderSuggestions();
    await renderSuggestions({ refreshKey: 1 });

    await click(getButton('Remind me about these in 7 days'));
    expect(container.querySelector('.lifecycle-suggestion-banner')).toBeNull();

    await act(async () => staleList.resolve({
      ok: true,
      data: { afterDays: 14, candidates: CANDIDATES },
    }));
    expect(container.querySelector('.lifecycle-suggestion-banner')).toBeNull();
  });

  it('renders the global banner in Chinese', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: true,
      data: { afterDays: 14, candidates: [CANDIDATES[0]] },
    });

    await renderSuggestions({ locale: 'zh-CN' });

    expect(container.textContent).toContain('此设备已观察到 1 个标签页休眠至少 14 天');
    expect(getButton('查看')).toBeTruthy();
    expect(getButton('7 天后提醒我')).toBeTruthy();
  });
});

async function renderSuggestions(
  overrides: Partial<ComponentProps<typeof TabLifecycleSuggestions>> = {},
) {
  await act(async () => {
    root.render(
      <TabLifecycleSuggestions
        disabled={false}
        locale="en"
        onStowed={() => Promise.resolve()}
        refreshKey={0}
        {...overrides}
      />,
    );
  });
}

function getButton(name: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === name || item.getAttribute('aria-label') === name,
  );
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
