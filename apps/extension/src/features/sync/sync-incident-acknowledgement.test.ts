import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('#imports', () => ({ storage }));

beforeEach(() => vi.clearAllMocks());

describe('sync incident acknowledgement', () => {
  it('derives stable keys only for connected paused incidents', async () => {
    const { derivePausedIncidentKey } = await import('./sync-incident-acknowledgement');
    const paused = { phase: 'connected' as const, sync: { state: 'paused' as const, action: 'reconnect' as const, message: ' Token expired ' } };
    expect(derivePausedIncidentKey(paused)).toBe(derivePausedIncidentKey({ ...paused, sync: { ...paused.sync, message: 'Token expired' } }));
    expect(derivePausedIncidentKey({ phase: 'needs-target', sync: { state: 'needs-target' } })).toBeNull();
  });

  it('stores and clears acknowledgement through its dedicated key', async () => {
    const { acknowledgeIncident, clearAcknowledgement } = await import('./sync-incident-acknowledgement');
    await acknowledgeIncident('incident');
    expect(storage.setItem).toHaveBeenCalledWith('local:tabstow-sync-incident-acknowledgement', 'incident');
    await clearAcknowledgement();
    expect(storage.removeItem).toHaveBeenCalledWith('local:tabstow-sync-incident-acknowledgement');
  });
});
