import { storage } from '#imports';
import { normalizeQuickLinks, type QuickLink } from './quick-links';

const QUICK_LINKS_KEY = 'local:tabstow-quick-links';

export async function getQuickLinks(): Promise<QuickLink[]> {
  return normalizeQuickLinks(await storage.getItem<QuickLink[]>(QUICK_LINKS_KEY));
}

export async function saveQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const normalized = normalizeQuickLinks(links);
  await storage.setItem(QUICK_LINKS_KEY, normalized);
  return normalized;
}
