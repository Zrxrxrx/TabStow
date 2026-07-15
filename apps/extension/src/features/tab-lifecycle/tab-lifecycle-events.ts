import { browser } from '@/lib/browser';
import {
  clearSleepObservations,
  observeDiscardedTab,
  removeSleepObservation,
} from './sleep-observations';
import {
  currentTabLifecycleGeneration,
  isCurrentTabLifecycleGeneration,
} from './tab-lifecycle-generation';
import { getTabLifecyclePolicy } from './tab-lifecycle-policy';

const RELEVANT_UPDATE_FIELDS = [
  'audible',
  'autoDiscardable',
  'discarded',
  'pinned',
  'url',
] as const;

async function withEnabledSuggestions(operation: () => Promise<void>): Promise<void> {
  const generation = currentTabLifecycleGeneration();
  const result = await getTabLifecyclePolicy();
  if (!result.ok || !isCurrentTabLifecycleGeneration(generation)) return;
  if (!result.data.stowSuggestionsEnabled) {
    await clearSleepObservations();
    return;
  }
  await operation();
}

export async function reconcileTabLifecycleTab(tab: chrome.tabs.Tab): Promise<void> {
  await withEnabledSuggestions(async () => {
    const observation = await observeDiscardedTab(tab);
    if (!observation && typeof tab.id === 'number') {
      await removeSleepObservation(tab.id);
    }
  });
}

async function removeTabLifecycleObservation(tabId: number): Promise<void> {
  await withEnabledSuggestions(() => removeSleepObservation(tabId));
}

function runBestEffort(operation: () => Promise<void>): void {
  void operation().catch(() => undefined);
}

export function registerTabLifecycleEventHandlers(): void {
  browser.tabs.onCreated.addListener((tab) => {
    runBestEffort(() => reconcileTabLifecycleTab(tab));
  });
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!RELEVANT_UPDATE_FIELDS.some((field) => field in changeInfo)) return;
    runBestEffort(() => reconcileTabLifecycleTab(tab));
  });
  browser.tabs.onActivated.addListener(({ tabId }) => {
    runBestEffort(() => removeTabLifecycleObservation(tabId));
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    runBestEffort(() => removeTabLifecycleObservation(tabId));
  });
  browser.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    runBestEffort(async () => {
      await removeTabLifecycleObservation(removedTabId);
      const tab = await browser.tabs.get(addedTabId);
      await reconcileTabLifecycleTab(tab);
    });
  });
}
