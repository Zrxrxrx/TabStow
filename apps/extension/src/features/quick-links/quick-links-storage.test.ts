import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickLink } from './quick-links';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  importLegacyQuickLinks: vi.fn(),
  listStoredQuickLinks: vi.fn(),
  replaceStoredQuickLinks: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/db/db', () => dbMocks);

describe('quick link storage', () => {
  let storedLinks: QuickLink[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storedLinks = [];
    storageMocks.getItem.mockResolvedValue([]);
    storageMocks.removeItem.mockResolvedValue(undefined);
    dbMocks.importLegacyQuickLinks.mockImplementation(async (links: QuickLink[]) => {
      if (storedLinks.length === 0) storedLinks = links;
      return storedLinks;
    });
    dbMocks.listStoredQuickLinks.mockImplementation(async () => storedLinks);
    dbMocks.replaceStoredQuickLinks.mockImplementation(async (links: QuickLink[]) => {
      storedLinks = links;
      return links;
    });
  });

  it('migrates and removes normalized legacy extension-storage links', async () => {
    storageMocks.getItem.mockResolvedValue([
      { id: 'a', url: 'https://example.com', label: 'Example' },
    ]);

    const { getQuickLinks } = await import('./quick-links-storage');
    expect(await getQuickLinks()).toEqual([
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: expect.any(String),
      },
    ]);
    expect(storageMocks.removeItem).toHaveBeenCalledWith('local:tabstow-quick-links');
  });

  it('normalizes before saving into the IndexedDB repository', async () => {
    const links = [
      null,
      { id: 'a', url: 'https://example.com', label: 'Example' },
      { id: 'b', url: 'not-a-url', label: 'Broken' },
    ] as unknown as QuickLink[];

    const { saveQuickLinks } = await import('./quick-links-storage');
    await expect(saveQuickLinks(links)).resolves.toEqual([
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: expect.any(String),
      },
    ]);
    expect(dbMocks.replaceStoredQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', url: 'https://example.com/' }),
    ]);
  });

  it('preserves valid local image tokens and drops embedded image data', async () => {
    const links: QuickLink[] = [
      {
        id: 'a',
        url: 'https://example.com',
        label: 'Example',
        icon: { kind: 'image', value: 'data:image/png;base64,abc123' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'b',
        url: 'https://example.com/docs',
        label: 'Docs',
        icon: { kind: 'image', value: 'quick-link-icon:token-1' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ];

    const { saveQuickLinks } = await import('./quick-links-storage');
    await expect(saveQuickLinks(links)).resolves.toEqual([
      expect.objectContaining({ id: 'a', icon: null }),
      expect.objectContaining({
        id: 'b',
        icon: { kind: 'image', value: 'quick-link-icon:token-1' },
      }),
    ]);
  });

  it('serializes updates against the latest repository value', async () => {
    const firstLink: QuickLink = {
      id: 'first',
      url: 'https://first.example/',
      label: 'First',
      icon: null,
      createdAt: '2026-07-06T00:00:00.000Z',
    };
    const secondLink: QuickLink = {
      id: 'second',
      url: 'https://second.example/',
      label: 'Second',
      icon: null,
      createdAt: '2026-07-06T00:00:00.000Z',
    };
    let releaseFirstWrite = () => {};
    const firstWriteStarted = new Promise<void>((resolve) => {
      dbMocks.replaceStoredQuickLinks.mockImplementationOnce(
        (links: QuickLink[]) =>
          new Promise<QuickLink[]>((release) => {
            releaseFirstWrite = () => {
              storedLinks = links;
              release(links);
            };
            resolve();
          }),
      );
    });

    const { updateQuickLinks } = await import('./quick-links-storage');
    const firstUpdate = updateQuickLinks((current) => [...current, firstLink]);
    const secondUpdate = updateQuickLinks((current) => [...current, secondLink]);

    await firstWriteStarted;
    expect(storedLinks).toEqual([]);
    releaseFirstWrite();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(storedLinks.map(({ id }) => id)).toEqual(['first', 'second']);
  });
});
