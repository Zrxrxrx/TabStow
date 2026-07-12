import { describe, expect, it } from 'vitest';
import {
  canonicalSyncFingerprint,
  compareRevision,
  mergeSyncDocuments,
  migrateSyncDocumentV1,
  parseSyncDocumentV2Content,
  positionBetween,
  positionsForCount,
  type SyncDocumentV2,
  type SyncRevision,
} from './sync-v2';

const exportedAt = '2026-07-12T00:00:00.000Z';

function revision(counter: number, replicaId: string): SyncRevision {
  return { counter, replicaId };
}

function emptyDocument(replicaId = 'replica-a'): SyncDocumentV2 {
  return {
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt,
    sessions: [],
    tabs: [],
    quickLinks: [],
    preferences: {
      includePinnedTabs: { value: false, revision: revision(1, replicaId) },
      closePinnedTabs: { value: false, revision: revision(1, replicaId) },
    },
    deletions: [],
  };
}

describe('sync document v2', () => {
  it('parses a strict version-two document and rejects credentials', () => {
    expect(parseSyncDocumentV2Content(JSON.stringify(emptyDocument()))).toEqual(
      emptyDocument(),
    );

    expect(() =>
      parseSyncDocumentV2Content(
        JSON.stringify({ ...emptyDocument(), githubToken: 'secret' }),
      ),
    ).toThrow();
  });

  it('rejects executable or non-web synchronized page URLs', () => {
    const [position] = positionsForCount(1);
    const unsafe = {
      ...emptyDocument(),
      quickLinks: [
        {
          id: 'quick-1',
          url: 'javascript:alert(1)',
          label: 'Unsafe',
          icon: null,
          createdAt: exportedAt,
          position: position!,
          revision: revision(2, 'replica-a'),
        },
      ],
    };

    expect(() => parseSyncDocumentV2Content(JSON.stringify(unsafe))).toThrow(
      'HTTP or HTTPS',
    );
  });

  it('rejects duplicate entities and oversized entity sets', () => {
    const session = {
      id: 'session-1',
      title: 'Reading',
      createdAt: exportedAt,
      position: positionsForCount(1)[0]!,
      revision: revision(2, 'replica-a'),
    };

    expect(() =>
      parseSyncDocumentV2Content(
        JSON.stringify({ ...emptyDocument(), sessions: [session, session] }),
      ),
    ).toThrow();
  });

  it('compares counters before replica ids', () => {
    expect(compareRevision(revision(2, 'a'), revision(1, 'z'))).toBeGreaterThan(0);
    expect(compareRevision(revision(2, 'b'), revision(2, 'a'))).toBeGreaterThan(0);
    expect(compareRevision(revision(2, 'a'), revision(2, 'a'))).toBe(0);
  });

  it('merges deterministically and idempotently', () => {
    const position = positionsForCount(1)[0]!;
    const local = {
      ...emptyDocument('replica-a'),
      sessions: [
        {
          id: 'session-1',
          title: 'Local',
          createdAt: exportedAt,
          position,
          revision: revision(2, 'replica-a'),
        },
      ],
    };
    const remote = {
      ...emptyDocument('replica-b'),
      sessions: [
        {
          id: 'session-1',
          title: 'Remote',
          createdAt: exportedAt,
          position,
          revision: revision(2, 'replica-b'),
        },
      ],
    };

    const left = mergeSyncDocuments(local, remote);
    const right = mergeSyncDocuments(remote, local);

    expect(left.sessions[0]?.title).toBe('Remote');
    expect(canonicalSyncFingerprint(left)).toBe(canonicalSyncFingerprint(right));
    expect(canonicalSyncFingerprint(mergeSyncDocuments(left, left))).toBe(
      canonicalSyncFingerprint(left),
    );
  });

  it('lets a newer deletion beat an active entity and a newer active entity revive it', () => {
    const position = positionsForCount(1)[0]!;
    const active = {
      ...emptyDocument(),
      sessions: [
        {
          id: 'session-1',
          title: 'Reading',
          createdAt: exportedAt,
          position,
          revision: revision(2, 'replica-a'),
        },
      ],
    };
    const deleted = {
      ...emptyDocument(),
      deletions: [
        {
          entityType: 'session' as const,
          entityId: 'session-1',
          deletedAt: exportedAt,
          revision: revision(3, 'replica-b'),
        },
      ],
    };

    expect(mergeSyncDocuments(active, deleted).sessions).toEqual([]);

    const revived = {
      ...active,
      sessions: [{ ...active.sessions[0]!, revision: revision(4, 'replica-a') }],
    };
    const merged = mergeSyncDocuments(revived, deleted);
    expect(merged.sessions).toHaveLength(1);
    expect(merged.deletions).toEqual([]);
  });

  it('keeps tabs when two devices concurrently move the last tab across sessions', () => {
    const [sessionAPosition, sessionBPosition] = positionsForCount(2);
    const [tabPosition] = positionsForCount(1);
    const sessionA = {
      id: 'session-a',
      title: 'A',
      createdAt: exportedAt,
      position: sessionAPosition!,
      revision: revision(1, 'replica-base'),
    };
    const sessionB = {
      id: 'session-b',
      title: 'B',
      createdAt: exportedAt,
      position: sessionBPosition!,
      revision: revision(1, 'replica-base'),
    };
    const tabA = {
      id: 'tab-a',
      sessionId: 'session-a',
      url: 'https://a.example/',
      title: 'A',
      createdAt: exportedAt,
      position: tabPosition!,
      revision: revision(1, 'replica-base'),
    };
    const tabB = {
      id: 'tab-b',
      sessionId: 'session-b',
      url: 'https://b.example/',
      title: 'B',
      createdAt: exportedAt,
      position: tabPosition!,
      revision: revision(1, 'replica-base'),
    };
    const movedA = {
      ...emptyDocument('replica-a'),
      sessions: [sessionB],
      tabs: [
        { ...tabA, sessionId: 'session-b', revision: revision(3, 'replica-a') },
        tabB,
      ],
      deletions: [
        {
          entityType: 'session' as const,
          entityId: 'session-a',
          deletedAt: exportedAt,
          revision: revision(4, 'replica-a'),
        },
      ],
    };
    const movedB = {
      ...emptyDocument('replica-b'),
      sessions: [sessionA],
      tabs: [
        tabA,
        { ...tabB, sessionId: 'session-a', revision: revision(3, 'replica-b') },
      ],
      deletions: [
        {
          entityType: 'session' as const,
          entityId: 'session-b',
          deletedAt: exportedAt,
          revision: revision(4, 'replica-b'),
        },
      ],
    };

    const merged = mergeSyncDocuments(movedA, movedB);

    expect(merged.sessions.map(({ id }) => id)).toEqual(['session-a', 'session-b']);
    expect(merged.tabs).toEqual([
      expect.objectContaining({ id: 'tab-b', sessionId: 'session-a' }),
      expect.objectContaining({ id: 'tab-a', sessionId: 'session-b' }),
    ]);
    expect(merged.deletions).toEqual([]);
    expect(canonicalSyncFingerprint(merged)).toBe(
      canonicalSyncFingerprint(mergeSyncDocuments(movedB, movedA)),
    );
  });

  it('still deletes unchanged children when their tab markers accompany the session marker', () => {
    const [position] = positionsForCount(1);
    const active = {
      ...emptyDocument(),
      sessions: [
        {
          id: 'session-1',
          title: 'Reading',
          createdAt: exportedAt,
          position: position!,
          revision: revision(1, 'replica-a'),
        },
      ],
      tabs: [
        {
          id: 'tab-1',
          sessionId: 'session-1',
          url: 'https://example.com/',
          title: 'Example',
          createdAt: exportedAt,
          position: position!,
          revision: revision(1, 'replica-a'),
        },
      ],
    };
    const deleted = {
      ...emptyDocument('replica-b'),
      deletions: [
        {
          entityType: 'tab' as const,
          entityId: 'tab-1',
          deletedAt: exportedAt,
          revision: revision(2, 'replica-b'),
        },
        {
          entityType: 'session' as const,
          entityId: 'session-1',
          deletedAt: exportedAt,
          revision: revision(3, 'replica-b'),
        },
      ],
    };

    const merged = mergeSyncDocuments(active, deleted);

    expect(merged.sessions).toEqual([]);
    expect(merged.tabs).toEqual([]);
    expect(merged.deletions).toHaveLength(2);
  });

  it('deduplicates normalized tab URLs with deterministic deletion markers', () => {
    const [sessionPosition, tabPosition] = positionsForCount(2);
    const document = {
      ...emptyDocument(),
      sessions: [
        {
          id: 'session-1',
          title: 'Reading',
          createdAt: exportedAt,
          position: sessionPosition!,
          revision: revision(1, 'replica-a'),
        },
      ],
      tabs: [
        {
          id: 'older',
          sessionId: 'session-1',
          url: 'https://example.com/read#old',
          title: 'Old',
          createdAt: '2026-07-10T00:00:00.000Z',
          position: sessionPosition!,
          revision: revision(2, 'replica-a'),
        },
        {
          id: 'newer',
          sessionId: 'session-1',
          url: 'https://example.com/read#new',
          title: 'New',
          createdAt: '2026-07-11T00:00:00.000Z',
          position: tabPosition!,
          revision: revision(3, 'replica-b'),
        },
      ],
    };

    const merged = mergeSyncDocuments(emptyDocument(), document);

    expect(merged.tabs.map(({ id }) => id)).toEqual(['newer']);
    expect(merged.deletions).toEqual([
      expect.objectContaining({ entityType: 'tab', entityId: 'older' }),
    ]);
  });

  it('marks a session deleted when URL convergence removes its final tab', () => {
    const [first, second] = positionsForCount(2);
    const input = {
      ...emptyDocument(),
      sessions: [
        {
          id: 'older-session',
          title: 'Older',
          createdAt: exportedAt,
          position: first!,
          revision: revision(2, 'replica-a'),
        },
        {
          id: 'newer-session',
          title: 'Newer',
          createdAt: exportedAt,
          position: second!,
          revision: revision(3, 'replica-b'),
        },
      ],
      tabs: [
        {
          id: 'older-tab',
          sessionId: 'older-session',
          url: 'https://example.com/read#old',
          title: 'Old',
          createdAt: exportedAt,
          position: first!,
          revision: revision(2, 'replica-a'),
        },
        {
          id: 'newer-tab',
          sessionId: 'newer-session',
          url: 'https://example.com/read#new',
          title: 'New',
          createdAt: exportedAt,
          position: first!,
          revision: revision(3, 'replica-b'),
        },
      ],
    };

    const merged = mergeSyncDocuments(emptyDocument(), input);

    expect(merged.sessions.map(({ id }) => id)).toEqual(['newer-session']);
    expect(merged.deletions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'tab', entityId: 'older-tab' }),
        expect.objectContaining({ entityType: 'session', entityId: 'older-session' }),
      ]),
    );
  });

  it('suppresses orphan tabs and emits deterministic deletion markers', () => {
    const [position] = positionsForCount(1);
    const orphaned = {
      ...emptyDocument(),
      tabs: [
        {
          id: 'tab-1',
          sessionId: 'missing-session',
          url: 'https://example.com/',
          title: 'Example',
          createdAt: exportedAt,
          position: position!,
          revision: revision(7, 'replica-b'),
        },
      ],
    };

    const merged = mergeSyncDocuments(emptyDocument(), orphaned);

    expect(merged.tabs).toEqual([]);
    expect(merged.deletions).toEqual([
      expect.objectContaining({ entityType: 'tab', entityId: 'tab-1' }),
    ]);
  });

  it('merges each behavior preference independently', () => {
    const left = {
      ...emptyDocument('replica-a'),
      preferences: {
        includePinnedTabs: { value: false, revision: revision(1, 'replica-a') },
        closePinnedTabs: { value: false, revision: revision(5, 'replica-a') },
      },
    };
    const right = {
      ...emptyDocument('replica-b'),
      preferences: {
        includePinnedTabs: { value: true, revision: revision(5, 'replica-b') },
        closePinnedTabs: { value: true, revision: revision(1, 'replica-a') },
      },
    };

    const merged = mergeSyncDocuments(left, right);

    expect(merged.preferences.includePinnedTabs.value).toBe(true);
    expect(merged.preferences.closePinnedTabs.value).toBe(false);
  });

  it('propagates Quick Link deletion and allows a newer revision to recreate it', () => {
    const [position] = positionsForCount(1);
    const active = {
      ...emptyDocument(),
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'site' as const, value: null },
          createdAt: exportedAt,
          position: position!,
          revision: revision(3, 'replica-a'),
        },
      ],
    };
    const deleted = {
      ...emptyDocument(),
      deletions: [
        {
          entityType: 'quickLink' as const,
          entityId: 'quick-1',
          deletedAt: exportedAt,
          revision: revision(4, 'replica-b'),
        },
      ],
    };

    expect(mergeSyncDocuments(active, deleted).quickLinks).toEqual([]);
    const recreated = {
      ...active,
      quickLinks: [
        { ...active.quickLinks[0]!, revision: revision(5, 'replica-a') },
      ],
    };
    expect(mergeSyncDocuments(recreated, deleted).quickLinks).toHaveLength(1);
  });

  it('migrates version one without device, gist, theme, or token settings', () => {
    const migrated = migrateSyncDocumentV1(
      {
        schemaVersion: 1,
        deviceId: 'legacy-device',
        exportedAt,
        sessions: [
          {
            id: 'session-1',
            title: 'Reading',
            tabs: [
              {
                id: 'tab-1',
                url: 'https://example.com/',
                title: 'Example',
                createdAt: exportedAt,
              },
            ],
            createdAt: exportedAt,
            updatedAt: exportedAt,
            deviceId: 'legacy-device',
          },
        ],
        quickLinks: [],
        settings: {
          deviceId: 'legacy-device',
          gistId: 'legacy-gist',
          gistFileName: 'legacy.json',
          includePinnedTabs: true,
          closePinnedTabs: false,
        },
      },
      'replica-local',
    );

    expect(migrated.sessions[0]?.revision.replicaId).toBe('replica-local');
    expect(migrated.tabs[0]).toMatchObject({ id: 'tab-1', sessionId: 'session-1' });
    expect(migrated.preferences.includePinnedTabs.value).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('legacy-gist');
    expect(JSON.stringify(migrated)).not.toContain('legacy-device');
  });

  it('creates sortable positions between neighbors', () => {
    const [first, second, third] = positionsForCount(3);
    const inserted = positionBetween(first, second);

    expect(first! < inserted).toBe(true);
    expect(inserted < second!).toBe(true);
    expect(second! < third!).toBe(true);
  });

  it('ignores exportedAt when comparing canonical replica state', () => {
    expect(
      canonicalSyncFingerprint({
        ...emptyDocument(),
        exportedAt: '2030-01-01T00:00:00.000Z',
      }),
    ).toBe(canonicalSyncFingerprint(emptyDocument()));
  });
});
