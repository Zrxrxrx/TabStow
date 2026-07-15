import { storage } from '#imports';

const OBSERVATIONS_STORAGE_KEY = 'local:tabstow-sleep-observations-v1';
const BROWSER_SESSION_STORAGE_KEY = 'session:tabstow-browser-session-id-v1';
const OBSERVATIONS_SCHEMA_VERSION = 1;
const UNMATCHED_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type SleepObservation = {
  observationId: string;
  tabId: number;
  browserSessionId: string;
  urlFingerprint: string;
  lastAccessed?: number;
  observedSleepingSince: number;
  lastObservedAt: number;
  snoozedUntil?: number;
  suppressedUntilWake?: true;
};

type StoredSleepObservations = {
  schemaVersion: typeof OBSERVATIONS_SCHEMA_VERSION;
  records: SleepObservation[];
};

let storageQueue: Promise<void> = Promise.resolve();

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function getBrowserSessionId(): Promise<string> {
  const stored = await storage.getItem<unknown>(BROWSER_SESSION_STORAGE_KEY);
  if (typeof stored === 'string' && stored.length > 0) return stored;

  const browserSessionId = crypto.randomUUID();
  await storage.setItem(BROWSER_SESSION_STORAGE_KEY, browserSessionId);
  return browserSessionId;
}

async function fingerprintUrl(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function validLastAccessed(value: unknown, now: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= now
    ? value
    : undefined;
}

function canContinueObservedSleepPeriod(
  record: SleepObservation,
  lastAccessed: number | undefined,
): boolean {
  return (
    record.lastAccessed === undefined
    || lastAccessed === undefined
    || record.lastAccessed === lastAccessed
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validObservedTimestamp(value: unknown, now: number): value is number {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= now
  );
}

function normalizeObservation(value: unknown, now: number): SleepObservation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.observationId !== 'string'
    || value.observationId.length === 0
    || !Number.isInteger(value.tabId)
    || (value.tabId as number) < 0
    || typeof value.browserSessionId !== 'string'
    || value.browserSessionId.length === 0
    || typeof value.urlFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.urlFingerprint)
    || !validObservedTimestamp(value.observedSleepingSince, now)
    || !validObservedTimestamp(value.lastObservedAt, now)
    || value.lastObservedAt < value.observedSleepingSince
  ) {
    return null;
  }
  if (
    value.lastAccessed !== undefined
    && validLastAccessed(value.lastAccessed, now) === undefined
  ) {
    return null;
  }
  if (
    value.snoozedUntil !== undefined
    && (
      typeof value.snoozedUntil !== 'number'
      || !Number.isFinite(value.snoozedUntil)
      || value.snoozedUntil < 0
    )
  ) {
    return null;
  }

  return {
    observationId: value.observationId,
    tabId: value.tabId as number,
    browserSessionId: value.browserSessionId,
    urlFingerprint: value.urlFingerprint,
    ...(value.lastAccessed === undefined
      ? {}
      : { lastAccessed: value.lastAccessed as number }),
    observedSleepingSince: value.observedSleepingSince,
    lastObservedAt: value.lastObservedAt,
    ...(typeof value.snoozedUntil === 'number' && value.snoozedUntil > now
      ? { snoozedUntil: value.snoozedUntil }
      : {}),
    ...(value.suppressedUntilWake === true ? { suppressedUntilWake: true } : {}),
  };
}

function identifiableHttpTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & {
  id: number;
  url: string;
} {
  if (
    !Number.isInteger(tab.id)
    || (tab.id as number) < 0
    || typeof tab.url !== 'string'
  ) {
    return false;
  }
  let protocol: string;
  try {
    protocol = new URL(tab.url).protocol;
  } catch {
    return false;
  }
  return protocol === 'http:' || protocol === 'https:';
}

function eligibleSleepingTab(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & {
  id: number;
  url: string;
} {
  return (
    identifiableHttpTab(tab)
    && tab.discarded === true
    && tab.active !== true
    && tab.pinned !== true
    && tab.audible !== true
    && tab.incognito !== true
    && tab.autoDiscardable !== false
  );
}

async function readStoredObservations(now: number): Promise<SleepObservation[]> {
  const stored = await storage.getItem<unknown>(OBSERVATIONS_STORAGE_KEY);
  if (
    !isRecord(stored)
    || stored.schemaVersion !== OBSERVATIONS_SCHEMA_VERSION
    || !Array.isArray(stored.records)
  ) {
    return [];
  }

  const observationIds = new Set<string>();
  const tabIdentities = new Set<string>();
  const records: SleepObservation[] = [];
  for (const value of stored.records) {
    const record = normalizeObservation(value, now);
    if (!record) continue;
    const tabIdentity = `${record.browserSessionId}:${record.tabId}`;
    if (
      observationIds.has(record.observationId)
      || tabIdentities.has(tabIdentity)
    ) {
      continue;
    }
    observationIds.add(record.observationId);
    tabIdentities.add(tabIdentity);
    records.push(record);
  }
  return records;
}

async function writeStoredObservations(records: SleepObservation[]): Promise<void> {
  await storage.setItem(OBSERVATIONS_STORAGE_KEY, {
    schemaVersion: OBSERVATIONS_SCHEMA_VERSION,
    records,
  } satisfies StoredSleepObservations);
}

function retainCurrentAndFreshUnmatched(
  records: SleepObservation[],
  browserSessionId: string,
  now: number,
): SleepObservation[] {
  return records.filter(
    (record) =>
      record.browserSessionId === browserSessionId
      || now - record.lastObservedAt < UNMATCHED_RETENTION_MS,
  );
}

export async function observeDiscardedTab(
  tab: chrome.tabs.Tab,
  now = Date.now(),
): Promise<SleepObservation | null> {
  return runSerialized(async () => {
    if (!eligibleSleepingTab(tab)) return null;

    const [records, browserSessionId, urlFingerprint] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
      fingerprintUrl(tab.url),
    ]);
    const lastAccessed = validLastAccessed(tab.lastAccessed, now);
    const existing = records.find(
      (record) =>
        record.browserSessionId === browserSessionId
        && record.tabId === tab.id
        && record.urlFingerprint === urlFingerprint
        && canContinueObservedSleepPeriod(record, lastAccessed),
    );
    const observation: SleepObservation = {
      observationId: existing?.observationId ?? crypto.randomUUID(),
      tabId: tab.id,
      browserSessionId,
      urlFingerprint,
      ...(lastAccessed === undefined ? {} : { lastAccessed }),
      observedSleepingSince: existing?.observedSleepingSince ?? now,
      lastObservedAt: now,
      ...(existing?.snoozedUntil === undefined
        ? {}
        : { snoozedUntil: existing.snoozedUntil }),
      ...(existing?.suppressedUntilWake === true
        ? { suppressedUntilWake: true as const }
        : {}),
    };
    await writeStoredObservations([
      ...records.filter(
        (record) =>
          record.browserSessionId !== browserSessionId || record.tabId !== tab.id,
      ),
      observation,
    ]);
    return observation;
  });
}

export async function reconcileSleepObservations(
  tabs: chrome.tabs.Tab[],
  now = Date.now(),
): Promise<SleepObservation[]> {
  return runSerialized(async () => {
    const [records, browserSessionId] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
    ]);
    const identifiableTabs = tabs.filter(identifiableHttpTab);
    const identifiableFingerprints = await Promise.all(
      identifiableTabs.map((tab) => fingerprintUrl(tab.url)),
    );
    const fingerprintsByTabId = new Map(
      identifiableTabs.map(
        (tab, index) => [tab.id, identifiableFingerprints[index]!] as const,
      ),
    );
    const eligibleTabs = identifiableTabs.filter(eligibleSleepingTab);
    const fingerprints = eligibleTabs.map((tab) => fingerprintsByTabId.get(tab.id)!);
    const identifiableFingerprintCounts = new Map<string, number>();
    for (const fingerprint of identifiableFingerprints) {
      identifiableFingerprintCounts.set(
        fingerprint,
        (identifiableFingerprintCounts.get(fingerprint) ?? 0) + 1,
      );
    }
    const previousSessionByFingerprint = new Map<string, SleepObservation[]>();
    for (const record of records) {
      if (record.browserSessionId === browserSessionId) continue;
      const matches = previousSessionByFingerprint.get(record.urlFingerprint) ?? [];
      matches.push(record);
      previousSessionByFingerprint.set(record.urlFingerprint, matches);
    }
    const consumedObservationIds = new Set<string>();
    const liveRecords = eligibleTabs.map((tab, index): SleepObservation => {
      const urlFingerprint = fingerprints[index]!;
      const lastAccessed = validLastAccessed(tab.lastAccessed, now);
      const sameSession = records.find(
        (record) =>
          record.browserSessionId === browserSessionId
          && record.tabId === tab.id
          && record.urlFingerprint === urlFingerprint
          && canContinueObservedSleepPeriod(record, lastAccessed),
      );
      const previousSessionMatches =
        previousSessionByFingerprint.get(urlFingerprint) ?? [];
      const previousSession =
        !sameSession
        && identifiableFingerprintCounts.get(urlFingerprint) === 1
        && previousSessionMatches.length === 1
        && lastAccessed !== undefined
        && previousSessionMatches[0]?.lastAccessed === lastAccessed
        && now - previousSessionMatches[0].lastObservedAt < UNMATCHED_RETENTION_MS
          ? previousSessionMatches[0]
          : undefined;
      const existing = sameSession ?? previousSession;
      if (existing) consumedObservationIds.add(existing.observationId);
      return {
        observationId: existing?.observationId ?? crypto.randomUUID(),
        tabId: tab.id,
        browserSessionId,
        urlFingerprint,
        ...(lastAccessed === undefined ? {} : { lastAccessed }),
        observedSleepingSince: existing?.observedSleepingSince ?? now,
        lastObservedAt: now,
        ...(existing?.snoozedUntil === undefined
          ? {}
          : { snoozedUntil: existing.snoozedUntil }),
        ...(existing?.suppressedUntilWake === true
          ? { suppressedUntilWake: true as const }
          : {}),
      };
    });
    const liveFingerprints = new Set(identifiableFingerprints);
    await writeStoredObservations([
      ...records.filter(
        (record) =>
          record.browserSessionId !== browserSessionId
          && !consumedObservationIds.has(record.observationId)
          && !liveFingerprints.has(record.urlFingerprint)
          && now - record.lastObservedAt < UNMATCHED_RETENTION_MS,
      ),
      ...liveRecords,
    ]);
    return liveRecords;
  });
}

export async function listSleepObservations(
  now = Date.now(),
): Promise<SleepObservation[]> {
  return runSerialized(async () => {
    const [records, browserSessionId] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
    ]);
    const retained = retainCurrentAndFreshUnmatched(records, browserSessionId, now);
    await writeStoredObservations(retained);
    return retained.filter((record) => record.browserSessionId === browserSessionId);
  });
}

export async function removeSleepObservation(
  tabId: number,
  now = Date.now(),
): Promise<void> {
  return runSerialized(async () => {
    const [records, browserSessionId] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
    ]);
    const retained = retainCurrentAndFreshUnmatched(records, browserSessionId, now)
      .filter(
        (record) =>
          record.browserSessionId !== browserSessionId || record.tabId !== tabId,
      );
    await writeStoredObservations(retained);
  });
}

export async function snoozeSleepObservations(
  observationIds: readonly string[],
  snoozedUntil: number,
  now = Date.now(),
): Promise<void> {
  if (!Number.isFinite(snoozedUntil) || snoozedUntil <= now) {
    throw new RangeError('snoozedUntil must be a future timestamp.');
  }
  return runSerialized(async () => {
    const [records, browserSessionId] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
    ]);
    const ids = new Set(observationIds);
    const retained = retainCurrentAndFreshUnmatched(records, browserSessionId, now)
      .map((record) =>
        record.browserSessionId === browserSessionId && ids.has(record.observationId)
          ? { ...record, snoozedUntil }
          : record,
      );
    await writeStoredObservations(retained);
  });
}

export async function suppressSleepObservations(
  observationIds: readonly string[],
  now = Date.now(),
): Promise<void> {
  return runSerialized(async () => {
    const [records, browserSessionId] = await Promise.all([
      readStoredObservations(now),
      getBrowserSessionId(),
    ]);
    const ids = new Set(observationIds);
    const retained = retainCurrentAndFreshUnmatched(records, browserSessionId, now)
      .map((record): SleepObservation =>
        record.browserSessionId === browserSessionId && ids.has(record.observationId)
          ? { ...record, suppressedUntilWake: true }
          : record,
      );
    await writeStoredObservations(retained);
  });
}

export async function clearSleepObservations(): Promise<void> {
  return runSerialized(() => writeStoredObservations([]));
}
