import type { SavedTab, TabSession } from '@tabstow/core';
import { createSessionsBatch } from '@/db/db';
import { getSettings } from '@/features/settings/settings-storage';
import { isOpenableTabUrl } from '@/features/tabs/tab-filter';
import { browser } from '@/lib/browser';
import {
  err,
  ok,
  toErrorMessage,
  type AppResult,
} from '@/lib/errors';
import {
  matchesSleepObservation,
  reconcileSleepObservations,
  removeSleepObservation,
  suppressSleepObservations,
} from './sleep-observations';
import { listStowSuggestions } from './stow-suggestions';
import {
  currentTabLifecycleGeneration,
  isCurrentTabLifecycleGeneration,
  tabLifecycleSettingsChanged,
} from './tab-lifecycle-generation';
import type {
  StowSuggestionCandidate,
  SuggestedStowResult,
} from './types';

type SuggestedStowOptions = {
  clock?: () => number;
  now?: number;
};

type PreparedTab = {
  candidate: StowSuggestionCandidate;
  tab: chrome.tabs.Tab & { id: number; index: number; url: string; windowId: number };
  savedTab: SavedTab;
};

let stowInFlight: Promise<AppResult<SuggestedStowResult>> | null = null;

function currentTimeAtOrAfter(clock: () => number, floor: number): number {
  const current = clock();
  return Number.isFinite(current) && current >= floor ? current : floor;
}

function validObservationIds(value: unknown): value is string[] {
  return (
    Array.isArray(value)
    && value.length > 0
    && value.every(
      (item) => typeof item === 'string' && item.length > 0 && item.trim() === item,
    )
    && new Set(value).size === value.length
  );
}

function isEligibleSleepingTab(
  tab: chrome.tabs.Tab,
  candidate: StowSuggestionCandidate,
): tab is chrome.tabs.Tab & { id: number; index: number; url: string; windowId: number } {
  return (
    tab.id === candidate.tabId
    && typeof tab.index === 'number'
    && typeof tab.windowId === 'number'
    && tab.url === candidate.url
    && isOpenableTabUrl(tab.url)
    && tab.discarded === true
    && tab.active !== true
    && tab.pinned !== true
    && tab.audible !== true
    && tab.incognito !== true
    && tab.autoDiscardable !== false
  );
}

async function readEligibleTab(
  candidate: StowSuggestionCandidate,
): Promise<PreparedTab['tab'] | null> {
  try {
    const tab = await browser.tabs.get(candidate.tabId);
    if (!isEligibleSleepingTab(tab, candidate)) return null;
    const window = await browser.windows.get(tab.windowId);
    if (window.type !== 'normal' || window.incognito === true) return null;
    return tab;
  } catch {
    return null;
  }
}

function toSavedTab(candidate: StowSuggestionCandidate, createdAt: string): SavedTab {
  return {
    id: crypto.randomUUID(),
    url: candidate.url,
    title: candidate.title || candidate.url,
    createdAt,
    ...(candidate.favIconUrl ? { favIconUrl: candidate.favIconUrl } : {}),
  };
}

function titleFromTabs(tabs: SavedTab[]): string {
  if (tabs.length === 1) return tabs[0]?.title || '1 tab';
  return `${tabs.length} tabs stowed`;
}

function createGroupedSessions(
  prepared: PreparedTab[],
  deviceId: string,
  createdAt: string,
): TabSession[] {
  const grouped = new Map<number, PreparedTab[]>();
  for (const item of prepared) {
    const group = grouped.get(item.tab.windowId) ?? [];
    group.push(item);
    grouped.set(item.tab.windowId, group);
  }

  return Array.from(grouped.entries())
    .map(([windowId, items]) => {
      const tabs = items
        .sort(
          (left, right) =>
            left.tab.index - right.tab.index
            || left.candidate.observationId.localeCompare(right.candidate.observationId),
        )
        .map(({ savedTab }) => savedTab);
      return {
        id: crypto.randomUUID(),
        title: titleFromTabs(tabs),
        tabs,
        sourceWindowId: windowId,
        createdAt,
        updatedAt: createdAt,
        deviceId,
      };
    });
}

async function suppressBestEffort(observationId: string, now: number): Promise<void> {
  try {
    await suppressSleepObservations([observationId], now);
  } catch {
    // The durable Saved copy is authoritative even if lifecycle cleanup is unavailable.
  }
}

async function removeObservationBestEffort(tabId: number, now: number): Promise<void> {
  try {
    await removeSleepObservation(tabId, now);
  } catch {
    // Tab removal events and later reconciliation provide another cleanup signal.
  }
}

async function stowSuggestedTabsUnlocked(
  observationIds: string[],
  now: number,
  clock: () => number,
  generation: number,
): Promise<AppResult<SuggestedStowResult>> {
  const listResult = await listStowSuggestions({ now });
  if (!isCurrentTabLifecycleGeneration(generation)) {
    return tabLifecycleSettingsChanged();
  }
  if (!listResult.ok) return listResult;

  const requested = new Set(observationIds);
  const candidates = listResult.data.candidates.filter(({ observationId }) =>
    requested.has(observationId),
  );
  const candidateIds = new Set(candidates.map(({ observationId }) => observationId));
  const skipped: SuggestedStowResult['skipped'] = observationIds
    .filter((observationId) => !candidateIds.has(observationId))
    .map((observationId) => ({ observationId, reason: 'not-suggested' }));

  const createdAt = new Date(now).toISOString();
  const prepared: PreparedTab[] = [];
  for (const candidate of candidates) {
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
    const tab = await readEligibleTab(candidate);
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
    if (!tab) {
      skipped.push({ observationId: candidate.observationId, reason: 'state-changed' });
      continue;
    }
    prepared.push({
      candidate,
      tab,
      savedTab: toSavedTab(candidate, createdAt),
    });
  }

  if (prepared.length === 0) {
    return ok({
      savedTabCount: 0,
      createdSessionCount: 0,
      closedTabCount: 0,
      skipped,
      closeFailures: [],
    });
  }

  let deviceId: string;
  try {
    deviceId = (await getSettings()).deviceId;
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }

  let revalidated: PreparedTab[];
  let revalidationNow = now;
  try {
    const currentTabs = await browser.tabs.query({ windowType: 'normal' });
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
    revalidationNow = currentTimeAtOrAfter(clock, now);
    const currentObservations = await reconcileSleepObservations(
      currentTabs,
      revalidationNow,
    );
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
    const tabsById = new Map(
      currentTabs.flatMap((tab) => typeof tab.id === 'number' ? [[tab.id, tab] as const] : []),
    );
    const observationsById = new Map(
      currentObservations.map((observation) => [observation.observationId, observation]),
    );
    revalidated = prepared.flatMap((item): PreparedTab[] => {
      const observation = observationsById.get(item.candidate.observationId);
      const tab = tabsById.get(item.candidate.tabId);
      if (
        observation?.tabId !== item.candidate.tabId
        || !tab
        || !isEligibleSleepingTab(tab, item.candidate)
      ) {
        skipped.push({
          observationId: item.candidate.observationId,
          reason: 'state-changed',
        });
        return [];
      }
      return [{ ...item, tab }];
    });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }

  if (revalidated.length === 0) {
    return ok({
      savedTabCount: 0,
      createdSessionCount: 0,
      closedTabCount: 0,
      skipped,
      closeFailures: [],
    });
  }

  let createdSessions: TabSession[];
  try {
    if (!isCurrentTabLifecycleGeneration(generation)) {
      return tabLifecycleSettingsChanged();
    }
    createdSessions = await createSessionsBatch(
      createGroupedSessions(revalidated, deviceId, createdAt),
    );
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }

  const representedSavedTabIds = new Set(
    createdSessions.flatMap(({ tabs }) => tabs.map(({ id }) => id)),
  );
  const represented = revalidated.filter(({ savedTab, candidate }) => {
    if (representedSavedTabIds.has(savedTab.id)) return true;
    skipped.push({
      observationId: candidate.observationId,
      reason: 'saved-url-unavailable',
    });
    return false;
  });
  const result: SuggestedStowResult = {
    savedTabCount: represented.length,
    createdSessionCount: createdSessions.length,
    closedTabCount: 0,
    skipped,
    closeFailures: [],
  };

  let postSaveObservationIds = new Set<string>();
  if (isCurrentTabLifecycleGeneration(generation)) {
    try {
      const tabs = await browser.tabs.query({ windowType: 'normal' });
      if (isCurrentTabLifecycleGeneration(generation)) {
        const observations = await reconcileSleepObservations(
          tabs,
          currentTimeAtOrAfter(clock, revalidationNow),
        );
        if (isCurrentTabLifecycleGeneration(generation)) {
          postSaveObservationIds = new Set(
            observations.map(({ observationId }) => observationId),
          );
        }
      }
    } catch {
      // Without a fresh identity snapshot, keeping every original tab open is safest.
    }
  }

  for (const item of represented) {
    let tab: PreparedTab['tab'] | null = null;
    if (
      postSaveObservationIds.has(item.candidate.observationId)
      && isCurrentTabLifecycleGeneration(generation)
    ) {
      const observedTab = await readEligibleTab(item.candidate);
      const observationMatches = observedTab
        && isCurrentTabLifecycleGeneration(generation)
        && await matchesSleepObservation(
          item.candidate.observationId,
          observedTab,
          currentTimeAtOrAfter(clock, revalidationNow),
        );
      if (observationMatches && isCurrentTabLifecycleGeneration(generation)) {
        const currentTab = await readEligibleTab(item.candidate);
        if (
          currentTab
          && isCurrentTabLifecycleGeneration(generation)
          && currentTab.windowId === item.tab.windowId
          && currentTab.lastAccessed === observedTab.lastAccessed
        ) {
          tab = currentTab;
        }
      }
    }

    if (!tab) {
      result.skipped.push({
        observationId: item.candidate.observationId,
        reason: 'state-changed',
      });
      await suppressBestEffort(item.candidate.observationId, now);
      continue;
    }

    try {
      await browser.tabs.remove(tab.id);
      result.closedTabCount += 1;
      await removeObservationBestEffort(tab.id, now);
    } catch (error) {
      result.closeFailures.push({
        observationId: item.candidate.observationId,
        tabId: tab.id,
        message: toErrorMessage(error),
      });
      await suppressBestEffort(item.candidate.observationId, now);
    }
  }

  return ok(result);
}

export function stowSuggestedTabs(
  observationIds: unknown,
  options: SuggestedStowOptions = {},
): Promise<AppResult<SuggestedStowResult>> {
  if (!validObservationIds(observationIds)) {
    return Promise.resolve(
      err('invalid-stow-suggestions', 'Suggested tab identities are invalid.'),
    );
  }
  if (stowInFlight) {
    return Promise.resolve(
      err('operation-in-progress', 'Another suggested stow is in progress.'),
    );
  }

  const fixedNow = options.now;
  const clock = options.clock ?? (fixedNow === undefined ? Date.now : () => fixedNow);
  const now = fixedNow ?? clock();
  const generation = currentTabLifecycleGeneration();
  stowInFlight = stowSuggestedTabsUnlocked(
    observationIds,
    now,
    clock,
    generation,
  ).finally(() => {
    stowInFlight = null;
  });
  return stowInFlight;
}
