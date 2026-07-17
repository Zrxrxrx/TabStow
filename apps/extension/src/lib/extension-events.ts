import { browser } from './browser';
import type { ExtensionEvent } from './messages';

export async function broadcastExtensionEvent(event: ExtensionEvent): Promise<void> {
  try {
    await browser.runtime.sendMessage(event);
  } catch {
    // No extension page may currently be open.
  }
}

export function isSavedDataInvalidationEvent(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('type' in message)) return false;

  const type = (message as { type?: unknown }).type;
  return type === 'saved-data:changed' || type === 'sync:data-changed';
}
