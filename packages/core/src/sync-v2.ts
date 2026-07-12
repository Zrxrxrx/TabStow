import * as z from 'zod';
import {
  syncDocumentSchema,
  type SyncDocument,
} from './schemas';
import {
  deduplicateSessionsByUrl,
  normalizeSavedTabUrl,
  sortSessionsForDisplay,
} from './tab-session';

export const MAX_SYNC_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_SYNC_ENTITIES = 50_000;

const POSITION_RADIX = 36n;
const POSITION_LENGTH = 16;
const MAX_POSITION = POSITION_RADIX ** BigInt(POSITION_LENGTH) - 1n;
const POSITION_PATTERN = /^[0-9a-z]{16}$/u;
const synchronizedPageUrlSchema = z.string().url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  },
  { message: 'Synchronized page URLs must use HTTP or HTTPS.' },
);

export const syncRevisionSchema = z
  .object({
    counter: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    replicaId: z.string().min(1).max(256),
  })
  .strict();

export const syncPositionSchema = z.string().regex(POSITION_PATTERN);

export const syncSessionEntitySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    createdAt: z.string().datetime(),
    position: syncPositionSchema,
    revision: syncRevisionSchema,
  })
  .strict();

export const syncTabEntitySchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    url: synchronizedPageUrlSchema,
    title: z.string(),
    favIconUrl: z.string().url().optional(),
    pinned: z.boolean().optional(),
    createdAt: z.string().datetime(),
    position: syncPositionSchema,
    revision: syncRevisionSchema,
  })
  .strict();

export const syncedQuickLinkIconV2Schema = z
  .union([
    z.object({ kind: z.literal('site'), value: z.null() }).strict(),
    z.object({ kind: z.literal('emoji'), value: z.string() }).strict(),
  ])
  .nullable();

export const syncQuickLinkEntitySchema = z
  .object({
    id: z.string().min(1),
    url: synchronizedPageUrlSchema,
    label: z.string().min(1),
    icon: syncedQuickLinkIconV2Schema,
    createdAt: z.string().datetime(),
    position: syncPositionSchema,
    revision: syncRevisionSchema,
  })
  .strict();

export const syncPreferenceSchema = z
  .object({
    value: z.boolean(),
    revision: syncRevisionSchema,
  })
  .strict();

export const syncDeletionSchema = z
  .object({
    entityType: z.enum(['session', 'tab', 'quickLink']),
    entityId: z.string().min(1),
    deletedAt: z.string().datetime(),
    revision: syncRevisionSchema,
  })
  .strict();

function addDuplicateIssues<T extends { id: string }>(
  values: T[],
  path: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: 'custom',
        path: [path, index, 'id'],
        message: `${path} IDs must be unique.`,
      });
    }
    seen.add(value.id);
  });
}

export const syncDocumentV2Schema = z
  .object({
    format: z.literal('tabstow'),
    schemaVersion: z.literal(2),
    exportedAt: z.string().datetime(),
    sessions: z.array(syncSessionEntitySchema),
    tabs: z.array(syncTabEntitySchema),
    quickLinks: z.array(syncQuickLinkEntitySchema),
    preferences: z
      .object({
        includePinnedTabs: syncPreferenceSchema,
        closePinnedTabs: syncPreferenceSchema,
      })
      .strict(),
    deletions: z.array(syncDeletionSchema),
  })
  .strict()
  .superRefine((document, context) => {
    addDuplicateIssues(document.sessions, 'sessions', context);
    addDuplicateIssues(document.tabs, 'tabs', context);
    addDuplicateIssues(document.quickLinks, 'quickLinks', context);

    const deletionKeys = new Set<string>();
    document.deletions.forEach((deletion, index) => {
      const key = `${deletion.entityType}:${deletion.entityId}`;
      if (deletionKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['deletions', index],
          message: 'Deletion markers must be unique per entity.',
        });
      }
      deletionKeys.add(key);
    });

    const entityCount =
      document.sessions.length +
      document.tabs.length +
      document.quickLinks.length +
      document.deletions.length;
    if (entityCount > MAX_SYNC_ENTITIES) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: `Sync document exceeds ${MAX_SYNC_ENTITIES} entities.`,
      });
    }
  });

export type SyncRevision = z.infer<typeof syncRevisionSchema>;
export type SyncSessionEntity = z.infer<typeof syncSessionEntitySchema>;
export type SyncTabEntity = z.infer<typeof syncTabEntitySchema>;
export type SyncQuickLinkEntity = z.infer<typeof syncQuickLinkEntitySchema>;
export type SyncPreference = z.infer<typeof syncPreferenceSchema>;
export type SyncDeletion = z.infer<typeof syncDeletionSchema>;
export type SyncDocumentV2 = z.infer<typeof syncDocumentV2Schema>;

export function compareRevision(left: SyncRevision, right: SyncRevision): number {
  return left.counter - right.counter || left.replicaId.localeCompare(right.replicaId);
}

function encodePosition(value: bigint): string {
  if (value <= 0n || value >= MAX_POSITION) {
    throw new Error('Position is outside the supported range.');
  }
  return value.toString(Number(POSITION_RADIX)).padStart(POSITION_LENGTH, '0');
}

function decodePosition(value: string): bigint {
  syncPositionSchema.parse(value);
  let decoded = 0n;
  for (const character of value) {
    decoded = decoded * POSITION_RADIX + BigInt(parseInt(character, Number(POSITION_RADIX)));
  }
  return decoded;
}

export function positionsForCount(count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Position count must be a non-negative safe integer.');
  }
  if (count === 0) return [];

  const step = MAX_POSITION / BigInt(count + 1);
  if (step <= 1n) throw new Error('Position space exhausted.');
  return Array.from({ length: count }, (_, index) =>
    encodePosition(step * BigInt(index + 1)),
  );
}

export function positionBetween(left?: string, right?: string): string {
  const low = left === undefined ? 0n : decodePosition(left);
  const high = right === undefined ? MAX_POSITION : decodePosition(right);
  if (low >= high || high - low <= 1n) throw new Error('Position space exhausted.');
  return encodePosition(low + (high - low) / 2n);
}

function chooseVersion<T extends { revision: SyncRevision }>(left: T, right: T): T {
  const comparison = compareRevision(left.revision, right.revision);
  if (comparison !== 0) return comparison > 0 ? left : right;

  const leftCanonical = JSON.stringify(left);
  const rightCanonical = JSON.stringify(right);
  return leftCanonical.localeCompare(rightCanonical) >= 0 ? left : right;
}

function mergeById<T extends { id: string; revision: SyncRevision }>(
  left: T[],
  right: T[],
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const entity of [...left, ...right]) {
    const current = merged.get(entity.id);
    merged.set(entity.id, current ? chooseVersion(current, entity) : entity);
  }
  return merged;
}

function deletionKey(deletion: Pick<SyncDeletion, 'entityType' | 'entityId'>): string {
  return `${deletion.entityType}:${deletion.entityId}`;
}

function mergeDeletions(left: SyncDeletion[], right: SyncDeletion[]): Map<string, SyncDeletion> {
  const merged = new Map<string, SyncDeletion>();
  for (const deletion of [...left, ...right]) {
    const key = deletionKey(deletion);
    const current = merged.get(key);
    merged.set(key, current ? chooseVersion(current, deletion) : deletion);
  }
  return merged;
}

function resolveActiveAgainstDeletion<T extends { id: string; revision: SyncRevision }>(
  entityType: SyncDeletion['entityType'],
  active: Map<string, T>,
  deletions: Map<string, SyncDeletion>,
): void {
  for (const [id, entity] of active) {
    const key = `${entityType}:${id}`;
    const deletion = deletions.get(key);
    if (!deletion) continue;

    if (compareRevision(entity.revision, deletion.revision) > 0) {
      deletions.delete(key);
    } else {
      active.delete(id);
    }
  }
}

function resolveSessionsAgainstDeletion(
  sessions: Map<string, SyncSessionEntity>,
  tabs: Map<string, SyncTabEntity>,
  deletions: Map<string, SyncDeletion>,
): void {
  const populatedSessionIds = new Set(
    [...tabs.values()].map(({ sessionId }) => sessionId),
  );
  for (const [id, session] of sessions) {
    const key = `session:${id}`;
    const deletion = deletions.get(key);
    if (!deletion) continue;

    if (
      compareRevision(session.revision, deletion.revision) > 0 ||
      populatedSessionIds.has(id)
    ) {
      deletions.delete(key);
    } else {
      sessions.delete(id);
    }
  }
}

function derivedDeletion(
  entityType: SyncDeletion['entityType'],
  entityId: string,
  deletedAt: string,
  revisions: SyncRevision[],
): SyncDeletion {
  const highest = revisions.reduce((winner, candidate) =>
    compareRevision(candidate, winner) > 0 ? candidate : winner,
  );
  const highestCounter = Math.max(...revisions.map(({ counter }) => counter));
  return {
    entityType,
    entityId,
    deletedAt,
    revision: {
      counter:
        highestCounter === Number.MAX_SAFE_INTEGER
          ? Number.MAX_SAFE_INTEGER
          : highestCounter + 1,
      replicaId: highest.replicaId,
    },
  };
}

function chooseDuplicateTabWinner(left: SyncTabEntity, right: SyncTabEntity): SyncTabEntity {
  const revisionComparison = compareRevision(left.revision, right.revision);
  if (revisionComparison !== 0) return revisionComparison > 0 ? left : right;
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
  if (createdAtComparison !== 0) return createdAtComparison > 0 ? left : right;
  return left.id.localeCompare(right.id) <= 0 ? left : right;
}

function reconcileOrphansAndDuplicateUrls(
  sessions: Map<string, SyncSessionEntity>,
  tabs: Map<string, SyncTabEntity>,
  deletions: Map<string, SyncDeletion>,
  exportedAt: string,
): void {
  const sessionsWithRemovedTabs = new Set<string>();
  for (const [id, tab] of tabs) {
    if (sessions.has(tab.sessionId)) continue;
    const parentDeletion = deletions.get(`session:${tab.sessionId}`);
    const marker = derivedDeletion(
      'tab',
      id,
      exportedAt,
      parentDeletion ? [tab.revision, parentDeletion.revision] : [tab.revision],
    );
    deletions.set(deletionKey(marker), marker);
    tabs.delete(id);
  }

  const winnersByUrl = new Map<string, SyncTabEntity>();
  for (const tab of tabs.values()) {
    const normalizedUrl = normalizeSavedTabUrl(tab.url);
    if (normalizedUrl === null) continue;
    const current = winnersByUrl.get(normalizedUrl);
    winnersByUrl.set(
      normalizedUrl,
      current ? chooseDuplicateTabWinner(current, tab) : tab,
    );
  }

  for (const [id, tab] of tabs) {
    const normalizedUrl = normalizeSavedTabUrl(tab.url);
    const winner = normalizedUrl === null ? undefined : winnersByUrl.get(normalizedUrl);
    if (!winner || winner.id === id) continue;

    const marker = derivedDeletion('tab', id, exportedAt, [tab.revision, winner.revision]);
    deletions.set(deletionKey(marker), marker);
    sessionsWithRemovedTabs.add(tab.sessionId);
    tabs.delete(id);
  }

  const populatedSessionIds = new Set([...tabs.values()].map(({ sessionId }) => sessionId));
  for (const [id, session] of sessions) {
    if (!sessionsWithRemovedTabs.has(id) || populatedSessionIds.has(id)) continue;
    const marker = derivedDeletion('session', id, exportedAt, [session.revision]);
    const key = deletionKey(marker);
    const existing = deletions.get(key);
    deletions.set(key, existing ? chooseVersion(existing, marker) : marker);
    sessions.delete(id);
  }
}

function sortDocument(document: SyncDocumentV2): SyncDocumentV2 {
  return {
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt: document.exportedAt,
    sessions: [...document.sessions].sort(
      (left, right) => left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
    ),
    tabs: [...document.tabs].sort(
      (left, right) =>
        left.sessionId.localeCompare(right.sessionId) ||
        left.position.localeCompare(right.position) ||
        left.id.localeCompare(right.id),
    ),
    quickLinks: [...document.quickLinks].sort(
      (left, right) => left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
    ),
    preferences: {
      includePinnedTabs: document.preferences.includePinnedTabs,
      closePinnedTabs: document.preferences.closePinnedTabs,
    },
    deletions: [...document.deletions].sort(
      (left, right) =>
        left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId),
    ),
  };
}

export function canonicalizeSyncDocument(document: SyncDocumentV2): SyncDocumentV2 {
  return sortDocument(syncDocumentV2Schema.parse(document));
}

export function canonicalSyncFingerprint(document: SyncDocumentV2): string {
  const canonical = canonicalizeSyncDocument(document);
  const { exportedAt: _exportedAt, ...replica } = canonical;
  return JSON.stringify(replica);
}

export function mergeSyncDocuments(
  leftInput: SyncDocumentV2,
  rightInput: SyncDocumentV2,
): SyncDocumentV2 {
  const left = syncDocumentV2Schema.parse(leftInput);
  const right = syncDocumentV2Schema.parse(rightInput);
  const exportedAt =
    left.exportedAt.localeCompare(right.exportedAt) >= 0 ? left.exportedAt : right.exportedAt;

  const sessions = mergeById(left.sessions, right.sessions);
  const tabs = mergeById(left.tabs, right.tabs);
  const quickLinks = mergeById(left.quickLinks, right.quickLinks);
  const deletions = mergeDeletions(left.deletions, right.deletions);

  resolveActiveAgainstDeletion('tab', tabs, deletions);
  resolveActiveAgainstDeletion('quickLink', quickLinks, deletions);
  reconcileOrphansAndDuplicateUrls(sessions, tabs, deletions, exportedAt);
  resolveSessionsAgainstDeletion(sessions, tabs, deletions);

  return canonicalizeSyncDocument({
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt,
    sessions: [...sessions.values()],
    tabs: [...tabs.values()],
    quickLinks: [...quickLinks.values()],
    preferences: {
      includePinnedTabs: chooseVersion(
        left.preferences.includePinnedTabs,
        right.preferences.includePinnedTabs,
      ),
      closePinnedTabs: chooseVersion(
        left.preferences.closePinnedTabs,
        right.preferences.closePinnedTabs,
      ),
    },
    deletions: [...deletions.values()],
  });
}

function contentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function parseSyncDocumentV2Content(content: string): SyncDocumentV2 {
  if (contentByteLength(content) > MAX_SYNC_DOCUMENT_BYTES) {
    throw new Error(`Sync document exceeds ${MAX_SYNC_DOCUMENT_BYTES} bytes.`);
  }
  return canonicalizeSyncDocument(syncDocumentV2Schema.parse(JSON.parse(content)));
}

export function migrateSyncDocumentV1(
  input: SyncDocument | unknown,
  replicaId: string,
): SyncDocumentV2 {
  const legacy = syncDocumentSchema.parse(input);
  const sessions = deduplicateSessionsByUrl(sortSessionsForDisplay(legacy.sessions));
  const sessionPositions = positionsForCount(sessions.length);
  const migratedSessions: SyncSessionEntity[] = [];
  const migratedTabs: SyncTabEntity[] = [];

  sessions.forEach((session, sessionIndex) => {
    migratedSessions.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      position: sessionPositions[sessionIndex]!,
      revision: { counter: 1, replicaId },
    });

    const tabPositions = positionsForCount(session.tabs.length);
    session.tabs.forEach((tab, tabIndex) => {
      migratedTabs.push({
        id: tab.id,
        sessionId: session.id,
        url: tab.url,
        title: tab.title,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        ...(typeof tab.pinned === 'boolean' ? { pinned: tab.pinned } : {}),
        createdAt: tab.createdAt,
        position: tabPositions[tabIndex]!,
        revision: { counter: 1, replicaId },
      });
    });
  });

  const quickLinkPositions = positionsForCount(legacy.quickLinks.length);
  return canonicalizeSyncDocument({
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt: legacy.exportedAt,
    sessions: migratedSessions,
    tabs: migratedTabs,
    quickLinks: legacy.quickLinks.map((quickLink, index) => ({
      id: quickLink.id,
      url: quickLink.url,
      label: quickLink.label,
      icon: quickLink.icon,
      createdAt: quickLink.createdAt,
      position: quickLinkPositions[index]!,
      revision: { counter: 1, replicaId },
    })),
    preferences: {
      includePinnedTabs: {
        value: legacy.settings.includePinnedTabs,
        revision: { counter: 1, replicaId },
      },
      closePinnedTabs: {
        value: legacy.settings.closePinnedTabs,
        revision: { counter: 1, replicaId },
      },
    },
    deletions: [],
  });
}

export function parseSyncDocumentForImport(
  content: string,
  replicaId: string,
): SyncDocumentV2 {
  if (contentByteLength(content) > MAX_SYNC_DOCUMENT_BYTES) {
    throw new Error(`Sync document exceeds ${MAX_SYNC_DOCUMENT_BYTES} bytes.`);
  }
  const parsed: unknown = JSON.parse(content);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'schemaVersion' in parsed &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 1
  ) {
    return migrateSyncDocumentV1(parsed, replicaId);
  }
  return canonicalizeSyncDocument(syncDocumentV2Schema.parse(parsed));
}
