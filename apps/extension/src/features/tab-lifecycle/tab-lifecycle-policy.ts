import { storage } from '#imports';
import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import {
  AUTOMATIC_SLEEP_DAY_PRESETS,
  DEFAULT_TAB_LIFECYCLE_POLICY,
  STOW_SUGGESTION_DAY_PRESETS,
  type AutomaticSleepCapability,
  type AutomaticSleepDays,
  type StowSuggestionDays,
  type TabLifecyclePolicy,
  type TabLifecycleState,
} from './types';

const POLICY_STORAGE_KEY = 'local:tabstow-tab-lifecycle-policy-v1';
const POLICY_SCHEMA_VERSION = 1;

type StoredTabLifecyclePolicy = TabLifecyclePolicy & {
  schemaVersion: typeof POLICY_SCHEMA_VERSION;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPreset<T extends number>(presets: readonly T[], value: unknown): value is T {
  return typeof value === 'number' && presets.includes(value as T);
}

function normalizeStoredPolicy(value: unknown): TabLifecyclePolicy {
  const record = isRecord(value) && value.schemaVersion === POLICY_SCHEMA_VERSION ? value : {};
  const automaticRuleIsValid =
    typeof record.automaticSleepEnabled === 'boolean'
    && isPreset(AUTOMATIC_SLEEP_DAY_PRESETS, record.automaticSleepAfterDays);
  return {
    automaticSleepEnabled: automaticRuleIsValid
      ? record.automaticSleepEnabled as boolean
      : DEFAULT_TAB_LIFECYCLE_POLICY.automaticSleepEnabled,
    automaticSleepAfterDays: automaticRuleIsValid
      ? (record.automaticSleepAfterDays as AutomaticSleepDays)
      : DEFAULT_TAB_LIFECYCLE_POLICY.automaticSleepAfterDays,
    stowSuggestionsEnabled:
      typeof record.stowSuggestionsEnabled === 'boolean'
        ? record.stowSuggestionsEnabled
        : DEFAULT_TAB_LIFECYCLE_POLICY.stowSuggestionsEnabled,
    stowSuggestionAfterDays: isPreset(
      STOW_SUGGESTION_DAY_PRESETS,
      record.stowSuggestionAfterDays,
    )
      ? (record.stowSuggestionAfterDays as StowSuggestionDays)
      : DEFAULT_TAB_LIFECYCLE_POLICY.stowSuggestionAfterDays,
  };
}

function toStoredPolicy(policy: TabLifecyclePolicy): StoredTabLifecyclePolicy {
  return { schemaVersion: POLICY_SCHEMA_VERSION, ...policy };
}

function isCurrentStoredPolicy(value: unknown): value is StoredTabLifecyclePolicy {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 5
    && value.schemaVersion === POLICY_SCHEMA_VERSION
    && typeof value.automaticSleepEnabled === 'boolean'
    && isPreset(AUTOMATIC_SLEEP_DAY_PRESETS, value.automaticSleepAfterDays)
    && typeof value.stowSuggestionsEnabled === 'boolean'
    && isPreset(STOW_SUGGESTION_DAY_PRESETS, value.stowSuggestionAfterDays)
  );
}

function isCompletePolicy(value: unknown): value is TabLifecyclePolicy {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 4
    && typeof value.automaticSleepEnabled === 'boolean'
    && isPreset(AUTOMATIC_SLEEP_DAY_PRESETS, value.automaticSleepAfterDays)
    && typeof value.stowSuggestionsEnabled === 'boolean'
    && isPreset(STOW_SUGGESTION_DAY_PRESETS, value.stowSuggestionAfterDays)
  );
}

async function readPolicy(): Promise<TabLifecyclePolicy> {
  const stored = await storage.getItem<unknown>(POLICY_STORAGE_KEY);
  const policy = normalizeStoredPolicy(stored);
  if (!isCurrentStoredPolicy(stored)) {
    await storage.setItem(POLICY_STORAGE_KEY, toStoredPolicy(policy));
  }
  return policy;
}

export async function detectAutomaticSleepCapability(): Promise<AutomaticSleepCapability> {
  try {
    const tabs = await browser.tabs.query({});
    if (tabs.length === 0) {
      return {
        status: 'unavailable',
        message: 'No tabs were available to verify automatic sleep support.',
      };
    }
    if (tabs.some((tab) => typeof tab.lastAccessed === 'number')) {
      return { status: 'supported' };
    }
    return { status: 'unsupported' };
  } catch (error) {
    return { status: 'unavailable', message: toErrorMessage(error) };
  }
}

export async function getTabLifecycleState(): Promise<AppResult<TabLifecycleState>> {
  try {
    const [policy, automaticSleepCapability] = await Promise.all([
      readPolicy(),
      detectAutomaticSleepCapability(),
    ]);
    return ok({ policy, automaticSleepCapability });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

export async function updateTabLifecyclePolicy(
  value: unknown,
): Promise<AppResult<TabLifecycleState>> {
  if (!isCompletePolicy(value)) {
    return err('invalid-tab-lifecycle-policy', 'Tab lifecycle policy is invalid.');
  }

  let current: TabLifecyclePolicy;
  try {
    current = await readPolicy();
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
  const automaticSleepCapability = await detectAutomaticSleepCapability();
  if (
    value.automaticSleepEnabled
    && !current.automaticSleepEnabled
    && automaticSleepCapability.status !== 'supported'
  ) {
    return err(
      'automatic-sleep-unavailable',
      automaticSleepCapability.status === 'unsupported'
        ? 'Automatic sleep requires Chrome 121 or later.'
        : automaticSleepCapability.message,
    );
  }

  try {
    await storage.setItem(POLICY_STORAGE_KEY, toStoredPolicy(value));
    return ok({ policy: value, automaticSleepCapability });
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}
