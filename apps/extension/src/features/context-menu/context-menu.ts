import { resolveLocale, t } from '@/features/i18n/i18n';
import { noteSynchronizedMutation } from '@/features/sync/sync-coordinator';
import { saveCurrentWindowAsSession } from '@/features/tabs/session-service';
import { browser } from '@/lib/browser';
import { broadcastExtensionEvent } from '@/lib/extension-events';

const STOW_CURRENT_WINDOW_MENU_ID = 'tabstow-stow-current-window';

export async function registerContextMenu(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: STOW_CURRENT_WINDOW_MENU_ID,
    title: t(resolveLocale('auto', browser.i18n.getUILanguage()), 'stowCurrentWindow'),
    contexts: ['page'],
  });
}

export function registerContextMenuClickHandler(): void {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== STOW_CURRENT_WINDOW_MENU_ID) return;
    const result = await saveCurrentWindowAsSession(tab?.windowId);
    if (!result.ok) return;

    await noteSynchronizedMutation().catch(() => undefined);
    if (result.data.savedTabCount > 0) {
      await broadcastExtensionEvent({ type: 'saved-data:changed' });
    }
  });
}
