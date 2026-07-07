import { storage } from '#imports';
import { normalizeQuickLinks, type QuickLink } from './quick-links';

const QUICK_LINKS_KEY = 'local:tabstow-quick-links';
let quickLinksWriteQueue: Promise<void> = Promise.resolve();

export async function getQuickLinks(): Promise<QuickLink[]> {
  return normalizeQuickLinks(await storage.getItem<QuickLink[]>(QUICK_LINKS_KEY));
}

async function writeQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const normalized = normalizeQuickLinks(links);
  await storage.setItem(QUICK_LINKS_KEY, normalized);
  return normalized;
}

export async function saveQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  return updateQuickLinks(() => links);
}

export async function updateQuickLinks(
  update: (currentLinks: QuickLink[]) => QuickLink[] | Promise<QuickLink[]>,
): Promise<QuickLink[]> {
  const write = quickLinksWriteQueue.then(async () => {
    const currentLinks = await getQuickLinks();
    return writeQuickLinks(await update(currentLinks));
  });
  quickLinksWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}
