import { describe, expect, it } from 'vitest';
import type { TabSession } from './schemas';
import { mergeSessionsById } from './tab-session';

const baseSession: TabSession = {
  id: 'session-1',
  title: 'Local',
  tabs: [],
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'local-device',
};

describe('mergeSessionsById', () => {
  it('keeps local-only sessions, adds remote-only sessions, and lets remote win on matching IDs', () => {
    const localOnly: TabSession = { ...baseSession, id: 'local-only', title: 'Local only' };
    const sharedLocal: TabSession = { ...baseSession, id: 'shared', title: 'Local shared' };
    const sharedRemote: TabSession = {
      ...baseSession,
      id: 'shared',
      title: 'Remote shared',
      deviceId: 'remote-device',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
    const remoteOnly: TabSession = {
      ...baseSession,
      id: 'remote-only',
      title: 'Remote only',
      deviceId: 'remote-device',
    };

    const merged = mergeSessionsById([localOnly, sharedLocal], [sharedRemote, remoteOnly]);

    expect(merged.map((session) => session.id).sort()).toEqual([
      'local-only',
      'remote-only',
      'shared',
    ]);
    expect(merged.find((session) => session.id === 'shared')?.title).toBe('Remote shared');
  });
});
