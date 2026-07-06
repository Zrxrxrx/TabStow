import type { StowResult } from '@/lib/messages';
import type { AppResult } from '@/lib/errors';
import { browser } from '@/lib/browser';

const RESET_DELAY_MS = 1800;

async function resetActionFeedback(): Promise<void> {
  await Promise.allSettled([
    browser.action.setBadgeText({ text: '' }),
    browser.action.setTitle({ title: 'Tabstow' }),
  ]);
}

export async function showActionFeedback(result: AppResult<StowResult>): Promise<void> {
  const text = result.ok ? String(result.data.savedTabCount) : '!';
  const title = result.ok
    ? `Stowed ${result.data.savedTabCount} tabs`
    : result.error.message;
  const color = result.ok ? '#2f855a' : '#b42318';

  await Promise.allSettled([
    browser.action.setBadgeBackgroundColor({ color }),
    browser.action.setBadgeText({ text }),
    browser.action.setTitle({ title }),
  ]);

  setTimeout(() => {
    void resetActionFeedback();
  }, RESET_DELAY_MS);
}
