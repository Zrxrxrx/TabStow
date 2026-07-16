import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StowSuggestionCandidate } from '@/features/tab-lifecycle/types';
import type { ExtensionMessage } from '@/lib/messages';
import { TabLifecycleReviewDialog } from './TabLifecycleReviewDialog';

const sendExtensionMessage = vi.hoisted(() => vi.fn());

vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CANDIDATES: StowSuggestionCandidate[] = [
  {
    observationId: 'observation-reading-later',
    tabId: 82,
    windowId: 8,
    index: 3,
    title: 'Later article',
    url: 'https://www.reading.example/later',
    observedSleepingSince: 1,
    observedSleepingDays: 19,
  },
  {
    observationId: 'observation-notes',
    tabId: 41,
    windowId: 4,
    index: 1,
    title: 'Project notes',
    url: 'https://notes.example/project',
    observedSleepingSince: 2,
    observedSleepingDays: 16,
  },
  {
    observationId: 'observation-reading-first',
    tabId: 80,
    windowId: 8,
    index: 0,
    title: 'First article',
    url: 'https://reading.example/first',
    favIconUrl: 'https://reading.example/favicon.ico',
    observedSleepingSince: 3,
    observedSleepingDays: 14,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'root';
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

describe('TabLifecycleReviewDialog', () => {
  it('groups a stable snapshot by source window and starts with every row selected', async () => {
    await renderDialog();

    const groups = document.body.querySelectorAll<HTMLElement>('.lifecycle-review-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelector('h3')?.textContent).toBe('Window 1');
    expect(groups[0]?.textContent?.indexOf('First article')).toBeLessThan(
      groups[0]?.textContent?.indexOf('Later article') ?? -1,
    );
    expect(groups[1]?.querySelector('h3')?.textContent).toBe('Window 2');
    expect(getCheckboxes().every((checkbox) => checkbox.checked)).toBe(true);
    expect(document.body.textContent).toContain('3 tabs selected · 2 sessions will be created.');
    expect(getButton('Save 3 for later and close original tabs').disabled).toBe(false);

    await click(getButton('Clear all'));
    expect(getCheckboxes().every((checkbox) => !checkbox.checked)).toBe(true);
    expect(getButton('Save 0 for later and close original tabs').disabled).toBe(true);

    await click(getButton('Select all'));
    expect(getCheckboxes().every((checkbox) => checkbox.checked)).toBe(true);
  });

  it('focuses or suppresses one row through stable observation identities', async () => {
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type === 'active-tabs:focus') return { ok: true, data: { focused: true } };
      if (message.type === 'tab-lifecycle:suppress-suggestions') {
        return { ok: true, data: { updatedObservationCount: 1 } };
      }
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const onCandidatesRemoved = vi.fn();
    await renderDialog({ onCandidatesRemoved });

    await click(getButton('Open First article'));
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'active-tabs:focus',
      tabId: 80,
      windowId: 8,
    });
    expect(document.body.textContent).not.toContain('First article');
    expect(onCandidatesRemoved).toHaveBeenCalledWith(['observation-reading-first']);

    getButton('Keep Project notes sleeping').focus();
    await click(getButton('Keep Project notes sleeping'));
    expect(sendExtensionMessage).toHaveBeenCalledWith({
      type: 'tab-lifecycle:suppress-suggestions',
      observationIds: ['observation-notes'],
    });
    expect(document.body.textContent).not.toContain('Project notes');
    expect(onCandidatesRemoved).toHaveBeenCalledWith(['observation-notes']);
    expect(document.activeElement).toBe(document.body.querySelector('.lifecycle-review-toolbar'));
  });

  it('keeps a failed confirmation open, then reports an exact partial result and refreshes', async () => {
    const firstStow = deferred<{
      ok: false;
      error: { code: 'unknown-error'; message: string };
    }>();
    let stowAttempts = 0;
    sendExtensionMessage.mockImplementation(async (message: ExtensionMessage) => {
      if (message.type !== 'tab-lifecycle:stow-suggestions') {
        throw new Error(`Unexpected message: ${message.type}`);
      }
      stowAttempts += 1;
      if (stowAttempts === 1) return firstStow.promise;
      return {
        ok: true,
        data: {
          savedTabCount: 2,
          createdSessionCount: 2,
          closedTabCount: 0,
          skipped: [{ observationId: 'observation-notes', reason: 'state-changed' }],
          closeFailures: [
            {
              observationId: 'observation-reading-later',
              tabId: 82,
              message: 'Chrome refused to close the tab.',
            },
            {
              observationId: 'observation-reading-first',
              tabId: 80,
              message: 'Chrome refused to close the tab.',
            },
          ],
        },
      };
    });
    const onClose = vi.fn();
    const onStowed = vi.fn(() => Promise.resolve());
    await renderDialog({ onClose, onStowed });

    await act(async () => getButton('Save 3 for later and close original tabs').click());
    expect(sendExtensionMessage).toHaveBeenLastCalledWith({
      type: 'tab-lifecycle:stow-suggestions',
      observationIds: [
        'observation-reading-later',
        'observation-notes',
        'observation-reading-first',
      ],
    });
    expect(getButtons('Cancel').every((button) => button.disabled)).toBe(true);
    await keyDown('Escape');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => firstStow.resolve({
      ok: false,
      error: { code: 'unknown-error', message: 'Sessions could not be saved.' },
    }));
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Tabs could not be saved. Nothing was closed.');
    expect(getCheckboxes()).toHaveLength(3);

    await click(getButton('Save 3 for later and close original tabs'));
    expect(document.body.textContent).toContain(
      'Saved 2 tabs in 2 sessions; closed 0 original tabs, skipped 1 tab, and 2 original tabs could not be closed.',
    );
    expect(onStowed).toHaveBeenCalledTimes(1);
    expect(getCheckboxes()).toHaveLength(0);
  });

  it('reports full success and unlocks even when the parent refresh is temporarily unavailable', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: true,
      data: {
        savedTabCount: 1,
        createdSessionCount: 1,
        closedTabCount: 1,
        skipped: [],
        closeFailures: [],
      },
    });
    const onStowed = vi.fn(() => Promise.reject(new Error('Refresh failed.')));
    await renderDialog({ initialCandidates: [CANDIDATES[0]!], onStowed });

    expect(document.body.textContent).toContain('1 tab selected · 1 session will be created.');
    await click(getButton('Save 1 for later and close original tabs'));

    expect(document.body.textContent).toContain(
      'Saved 1 tab in 1 session and closed 1 original tab.',
    );
    expect(onStowed).toHaveBeenCalledTimes(1);
    expect(getButtons('Cancel').every((button) => !button.disabled)).toBe(true);
  });

  it('provides the review controls in Chinese', async () => {
    sendExtensionMessage.mockResolvedValue({
      ok: false,
      error: { code: 'unknown-error', message: 'Database rejected the transaction.' },
    });
    await renderDialog({ initialCandidates: [CANDIDATES[0]!], locale: 'zh-CN' });

    expect(document.body.textContent).toContain('查看长期休眠的标签页');
    expect(getButton('全选')).toBeTruthy();
    await click(getButton('保存 1 个到“稍后查看”并关闭原标签页'));
    expect(document.body.textContent).toContain('无法保存标签页，且没有关闭任何原标签页。');
    expect(document.body.textContent).toContain('Database rejected the transaction.');
  });
});

async function renderDialog(
  overrides: Partial<ComponentProps<typeof TabLifecycleReviewDialog>> = {},
) {
  await act(async () => {
    root.render(
      <TabLifecycleReviewDialog
        initialCandidates={CANDIDATES}
        locale="en"
        onCandidatesRemoved={() => undefined}
        onClose={() => undefined}
        onStowed={() => Promise.resolve()}
        {...overrides}
      />,
    );
  });
}

function getCheckboxes() {
  return Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
}

function getButton(name: string) {
  const button = getButtons(name)[0];
  if (!button) throw new Error(`Missing button: ${name}`);
  return button;
}

function getButtons(name: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => button.textContent === name || button.getAttribute('aria-label') === name,
  );
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
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
