import { storage } from '#imports';
import type { ConnectionView } from './sync-types';

const ACKNOWLEDGEMENT_KEY = 'local:tabstow-sync-incident-acknowledgement';

export function derivePausedIncidentKey(connection: ConnectionView): string | null {
  if (connection.phase !== 'connected' || connection.sync.state !== 'paused') return null;
  return JSON.stringify({
    action: connection.sync.action ?? '',
    message: connection.sync.message?.trim() ?? '',
    state: 'paused',
  });
}

export async function getAcknowledgedIncidentKey(): Promise<string | null> {
  const value = await storage.getItem<unknown>(ACKNOWLEDGEMENT_KEY);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function acknowledgeIncident(key: string): Promise<void> {
  await storage.setItem(ACKNOWLEDGEMENT_KEY, key);
}

export async function clearAcknowledgement(): Promise<void> {
  await storage.removeItem(ACKNOWLEDGEMENT_KEY);
}
