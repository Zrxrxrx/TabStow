import { browser } from '@/lib/browser';
import { isOpenableTabUrl } from '@/features/tabs/tab-filter';
import { toErrorMessage } from '@/lib/errors';
import type { TabLifecyclePolicy } from './types';

const DAY_MS = 86_400_000;

export type AutomaticSleepRule = Pick<
  TabLifecyclePolicy,
  'automaticSleepEnabled' | 'automaticSleepAfterDays'
>;

export type AutomaticSleepOptions = {
  now?: number;
};

export type AutomaticSleepScanOptions = AutomaticSleepOptions & {
  shouldContinue?: () => boolean;
};

export type AutomaticSleepScanResult = {
  sleptTabIds: number[];
  skippedTabIds: number[];
  failures: Array<{ tabId: number; message: string }>;
};

type EligibleAutomaticSleepTab = chrome.tabs.Tab & {
  id: number;
  lastAccessed: number;
  url: string;
};

function isEligibleTab(
  tab: chrome.tabs.Tab,
  cutoff: number,
  now: number,
): tab is EligibleAutomaticSleepTab {
  return (
    typeof tab.id === 'number'
    && Number.isFinite(tab.id)
    && typeof tab.url === 'string'
    && isOpenableTabUrl(tab.url)
    && !tab.active
    && !tab.discarded
    && !tab.pinned
    && !tab.audible
    && !tab.incognito
    && tab.autoDiscardable !== false
    && typeof tab.lastAccessed === 'number'
    && Number.isFinite(tab.lastAccessed)
    && tab.lastAccessed >= 0
    && tab.lastAccessed <= now
    && tab.lastAccessed <= cutoff
  );
}

export async function previewAutomaticSleep(
  policy: AutomaticSleepRule,
  options: AutomaticSleepOptions = {},
): Promise<{ eligibleTabCount: number }> {
  if (!policy.automaticSleepEnabled) return { eligibleTabCount: 0 };

  const now = options.now ?? Date.now();
  const cutoff = now - policy.automaticSleepAfterDays * DAY_MS;
  const tabs = await browser.tabs.query({});
  return {
    eligibleTabCount: tabs.filter((tab) => isEligibleTab(tab, cutoff, now)).length,
  };
}

export async function runAutomaticSleepScan(
  policy: AutomaticSleepRule,
  options: AutomaticSleepScanOptions = {},
): Promise<AutomaticSleepScanResult> {
  const result: AutomaticSleepScanResult = {
    sleptTabIds: [],
    skippedTabIds: [],
    failures: [],
  };
  if (!policy.automaticSleepEnabled) return result;

  const now = options.now ?? Date.now();
  const cutoff = now - policy.automaticSleepAfterDays * DAY_MS;
  const candidates = (await browser.tabs.query({}))
    .filter((tab) => isEligibleTab(tab, cutoff, now))
    .sort((left, right) => left.lastAccessed - right.lastAccessed);
  const shouldContinue = options.shouldContinue ?? (() => true);

  for (const [index, candidate] of candidates.entries()) {
    if (!shouldContinue()) {
      result.skippedTabIds.push(...candidates.slice(index).map((tab) => tab.id));
      break;
    }

    try {
      const current = await browser.tabs.get(candidate.id);
      if (
        !isEligibleTab(current, cutoff, now)
        || current.id !== candidate.id
        || current.url !== candidate.url
      ) {
        result.skippedTabIds.push(candidate.id);
        continue;
      }

      if (!shouldContinue()) {
        result.skippedTabIds.push(...candidates.slice(index).map((tab) => tab.id));
        break;
      }

      const discarded = await browser.tabs.discard(candidate.id);
      if (discarded?.discarded) {
        result.sleptTabIds.push(candidate.id);
      } else {
        result.skippedTabIds.push(candidate.id);
      }
    } catch (error) {
      result.failures.push({ tabId: candidate.id, message: toErrorMessage(error) });
    }
  }

  return result;
}
