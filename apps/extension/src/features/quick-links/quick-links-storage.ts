import { storage } from '#imports';
import {
  importLegacyQuickLinks,
  listStoredQuickLinks,
  replaceStoredQuickLinks,
} from '@/db/db';
import { normalizeQuickLinks, type QuickLink } from './quick-links';

const QUICK_LINKS_KEY = 'local:tabstow-quick-links';
let quickLinksWriteQueue: Promise<void> = Promise.resolve();
let migrationPromise: Promise<void> | null = null;

async function ensureLegacyMigration(): Promise<void> {
  migrationPromise ??= (async () => {
    const legacy = normalizeQuickLinks(
      await storage.getItem<QuickLink[]>(QUICK_LINKS_KEY),
    );
    await importLegacyQuickLinks(legacy);
    await storage.removeItem(QUICK_LINKS_KEY);
  })();
  try {
    await migrationPromise;
  } catch (error) {
    migrationPromise = null;
    throw error;
  }
}

export async function getQuickLinks(): Promise<QuickLink[]> {
  await ensureLegacyMigration();
  return listStoredQuickLinks();
}

async function writeQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  const normalized = normalizeQuickLinks(links);
  return replaceStoredQuickLinks(normalized);
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
