import { browser } from '@/lib/browser';
import { err, ok, toErrorMessage, type AppResult } from '@/lib/errors';

export async function collapseChromeTabGroups(
  windowId: number,
): Promise<AppResult<{ collapsed: true; groupCount: number }>> {
  try {
    const groups = await browser.tabGroups.query({});
    const matchingGroups = groups.filter((group) => group.windowId === windowId);
    await Promise.all(
      matchingGroups.map((group) => browser.tabGroups.update(group.id, { collapsed: true })),
    );
    return ok({ collapsed: true, groupCount: matchingGroups.length });
  } catch (error) {
    return err('chrome-tabs-error', toErrorMessage(error));
  }
}
