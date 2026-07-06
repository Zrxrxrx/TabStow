import { deleteSession, listSessions } from '@/db/db';
import {
  registerContextMenu,
  registerContextMenuClickHandler,
} from '@/features/context-menu/context-menu';
import { getSettings, updateSettings } from '@/features/settings/settings-storage';
import { restoreSession, saveCurrentWindowAsSession } from '@/features/tabs/session-service';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';
import type { ExtensionMessage } from '@/lib/messages';

async function handleMessage(message: ExtensionMessage): Promise<AppResult<unknown>> {
  try {
    switch (message.type) {
      case 'sessions:list':
        return ok(await listSessions());
      case 'sessions:stow-current-window':
        return saveCurrentWindowAsSession();
      case 'sessions:restore':
        return restoreSession(message.sessionId, message.mode);
      case 'sessions:delete':
        await deleteSession(message.sessionId);
        return ok({ deleted: true });
      case 'settings:get':
        return ok(await getSettings());
      case 'settings:update':
        return ok(await updateSettings(message.settings));
      case 'sync:push':
      case 'sync:pull':
        return err('unknown-error', 'Sync is not available until the sync service is installed.');
    }
  } catch (error) {
    return err('unknown-error', toErrorMessage(error));
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void registerContextMenu();
  });

  browser.runtime.onStartup.addListener(() => {
    void registerContextMenu();
  });

  registerContextMenuClickHandler();

  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    return handleMessage(message);
  });
});
