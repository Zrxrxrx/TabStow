import { saveCurrentWindowAsSession } from '@/features/tabs/session-service';
import { noteSynchronizedMutation } from '@/features/sync/sync-coordinator';
import { browser } from '@/lib/browser';

const STOW_CURRENT_WINDOW_MENU_ID = 'tabstow-stow-current-window';

export async function registerContextMenu(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: STOW_CURRENT_WINDOW_MENU_ID,
    title: 'Stow current window tabs',
    contexts: ['page'],
  });
}

export function registerContextMenuClickHandler(): void {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== STOW_CURRENT_WINDOW_MENU_ID) return;
    const result = await saveCurrentWindowAsSession(tab?.windowId);
    if (result.ok) await noteSynchronizedMutation().catch(() => undefined);
  });
}
