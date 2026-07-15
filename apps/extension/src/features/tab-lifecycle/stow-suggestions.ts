import { normalizeSavedTabUrl } from '@tabstow/core';
import { listSessions } from '@/db/db';
import { browser } from '@/lib/browser';
import {
  err,
  ok,
  toErrorMessage,
  type AppResult,
} from '@/lib/errors';
import { getTabLifecyclePolicy } from './tab-lifecycle-policy';
import {
  clearSleepObservations,
  reconcileSleepObservations,
  snoozeSleepObservations,
  suppressSleepObservations,
  type SleepObservation,
} from './sleep-observations';
import type {
  StowSuggestionCandidate,
  StowSuggestionList,
  StowSuggestionMutationResult,
} from './types';

const DAY_MS = 86_400_000;
const SNOOZE_DAYS = 7;

type SuggestionOptions = {
  now?: number;
};

async function queryNormalTabs(): Promise<AppResult<chrome.tabs.Tab[]>> {
  try {
    return ok(await browser.tabs.query({ windowType: 'normal' }));
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}

async function reconcileCurrentObservations(
  now: number,
): Promise<AppResult<{ tabs: chrome.tabs.Tab[]; observations: SleepObservation[] }>> {
  const tabsResult = await queryNormalTabs();
  if (!tabsResult.ok) return tabsResult;

  try {
    return ok({
      tabs: tabsResult.data,
      observations: await reconcileSleepObservations(tabsResult.data, now),
    });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

function compareCandidates(
  left: StowSuggestionCandidate,
  right: StowSuggestionCandidate,
): number {
  return (
    left.observedSleepingSince - right.observedSleepingSince
    || left.windowId - right.windowId
    || left.index - right.index
    || left.observationId.localeCompare(right.observationId)
  );
}

export async function listStowSuggestions(
  options: SuggestionOptions = {},
): Promise<AppResult<StowSuggestionList>> {
  const now = options.now ?? Date.now();
  const policyResult = await getTabLifecyclePolicy();
  if (!policyResult.ok) return policyResult;
  const policy = policyResult.data;

  if (!policy.stowSuggestionsEnabled) {
    try {
      await clearSleepObservations();
      return ok({ afterDays: policy.stowSuggestionAfterDays, candidates: [] });
    } catch (error) {
      return err('unknown-error', toErrorMessage(error));
    }
  }

  const currentResult = await reconcileCurrentObservations(now);
  if (!currentResult.ok) return currentResult;

  let savedUrls: Set<string>;
  try {
    savedUrls = new Set(
      (await listSessions())
        .flatMap(({ tabs }) => tabs)
        .map(({ url }) => normalizeSavedTabUrl(url))
        .filter((url): url is string => url !== null),
    );
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }

  const observationsByTabId = new Map(
    currentResult.data.observations.map((observation) => [observation.tabId, observation]),
  );
  const cutoff = now - policy.stowSuggestionAfterDays * DAY_MS;
  const candidates = currentResult.data.tabs
    .map((tab): StowSuggestionCandidate | null => {
      if (
        typeof tab.id !== 'number'
        || typeof tab.url !== 'string'
        || typeof tab.windowId !== 'number'
        || typeof tab.index !== 'number'
      ) {
        return null;
      }
      const observation = observationsByTabId.get(tab.id);
      if (
        !observation
        || observation.observedSleepingSince > cutoff
        || (observation.snoozedUntil !== undefined && observation.snoozedUntil > now)
        || observation.suppressedUntilWake === true
      ) {
        return null;
      }
      const normalizedUrl = normalizeSavedTabUrl(tab.url);
      if (normalizedUrl === null || savedUrls.has(normalizedUrl)) return null;

      return {
        observationId: observation.observationId,
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        title: tab.title || tab.url,
        url: tab.url,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        observedSleepingSince: observation.observedSleepingSince,
        observedSleepingDays: Math.floor(
          (now - observation.observedSleepingSince) / DAY_MS,
        ),
      };
    })
    .filter((candidate): candidate is StowSuggestionCandidate => candidate !== null)
    .sort(compareCandidates);

  const representedUrls = new Set<string>();
  const deduplicated = candidates.filter((candidate) => {
    const normalizedUrl = normalizeSavedTabUrl(candidate.url);
    if (normalizedUrl === null || representedUrls.has(normalizedUrl)) return false;
    representedUrls.add(normalizedUrl);
    return true;
  });

  return ok({
    afterDays: policy.stowSuggestionAfterDays,
    candidates: deduplicated,
  });
}

async function mutateCurrentObservations(
  observationIds: readonly string[],
  mutation: (ids: string[]) => Promise<void>,
  now: number,
): Promise<AppResult<StowSuggestionMutationResult>> {
  const policyResult = await getTabLifecyclePolicy();
  if (!policyResult.ok) return policyResult;
  if (!policyResult.data.stowSuggestionsEnabled) {
    try {
      await clearSleepObservations();
      return ok({ updatedObservationCount: 0 });
    } catch (error) {
      return err('unknown-error', toErrorMessage(error));
    }
  }

  const currentResult = await reconcileCurrentObservations(now);
  if (!currentResult.ok) return currentResult;
  const requestedIds = new Set(observationIds);
  const currentIds = currentResult.data.observations
    .map(({ observationId }) => observationId)
    .filter((observationId) => requestedIds.has(observationId));

  try {
    await mutation(currentIds);
    return ok({ updatedObservationCount: currentIds.length });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

export function snoozeStowSuggestions(
  observationIds: readonly string[],
  options: SuggestionOptions = {},
): Promise<AppResult<StowSuggestionMutationResult>> {
  const now = options.now ?? Date.now();
  return mutateCurrentObservations(
    observationIds,
    (currentIds) => snoozeSleepObservations(
      currentIds,
      now + SNOOZE_DAYS * DAY_MS,
      now,
    ),
    now,
  );
}

export function suppressStowSuggestions(
  observationIds: readonly string[],
  options: SuggestionOptions = {},
): Promise<AppResult<StowSuggestionMutationResult>> {
  const now = options.now ?? Date.now();
  return mutateCurrentObservations(
    observationIds,
    (currentIds) => suppressSleepObservations(currentIds, now),
    now,
  );
}
