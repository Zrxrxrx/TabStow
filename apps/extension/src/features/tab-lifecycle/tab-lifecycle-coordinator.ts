import { browser } from '@/lib/browser';
import {
  runAutomaticSleepScan,
  type AutomaticSleepScanResult,
} from './automatic-sleep';
import { getTabLifecycleState } from './tab-lifecycle-policy';

export const TAB_LIFECYCLE_ALARM_NAME = 'tabstow-tab-lifecycle-v1';
const FIRST_SCAN_DELAY_MINUTES = 1;
const SCAN_PERIOD_MINUTES = 30;

let policyGeneration = 0;
let scanInFlight: Promise<AutomaticSleepScanResult | null> | null = null;
let bootstrapInFlight: Promise<void> | null = null;

export function invalidateAutomaticSleepScans(): void {
  policyGeneration += 1;
}

export async function reconcileTabLifecycleAlarm(): Promise<void> {
  const state = await getTabLifecycleState();
  if (!state.ok) return;

  if (!state.data.policy.automaticSleepEnabled) {
    await browser.alarms.clear(TAB_LIFECYCLE_ALARM_NAME);
    return;
  }

  const existing = await browser.alarms.get(TAB_LIFECYCLE_ALARM_NAME);
  if (existing?.periodInMinutes === SCAN_PERIOD_MINUTES) return;

  await browser.alarms.create(TAB_LIFECYCLE_ALARM_NAME, {
    delayInMinutes: FIRST_SCAN_DELAY_MINUTES,
    periodInMinutes: SCAN_PERIOD_MINUTES,
  });
}

export function bootstrapTabLifecycleCoordinator(): Promise<void> {
  if (bootstrapInFlight) return bootstrapInFlight;
  bootstrapInFlight = reconcileTabLifecycleAlarm().finally(() => {
    bootstrapInFlight = null;
  });
  return bootstrapInFlight;
}

export function handleTabLifecycleAlarm(): Promise<AutomaticSleepScanResult | null> {
  if (scanInFlight) return scanInFlight;
  const generation = policyGeneration;
  scanInFlight = (async () => {
    const state = await getTabLifecycleState();
    if (
      !state.ok
      || !state.data.policy.automaticSleepEnabled
      || state.data.automaticSleepCapability.status !== 'supported'
    ) {
      return null;
    }

    return runAutomaticSleepScan(state.data.policy, {
      shouldContinue: () => generation === policyGeneration,
    });
  })().finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}
