import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuickLink } from './quick-links';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('quick link storage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('loads normalized links', async () => {
    storageMocks.getItem.mockResolvedValue([{ id: 'a', url: 'https://example.com', label: 'Example' }]);

    const { getQuickLinks } = await import('./quick-links-storage');
    expect(await getQuickLinks()).toEqual([
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
    ]);
  });

  it('normalizes before saving and returns normalized links', async () => {
    const links: Parameters<typeof import('./quick-links-storage').saveQuickLinks>[0] = [
      null,
      { id: 'a', url: 'https://example.com', label: 'Example' },
      { id: 'b', url: 'not-a-url', label: 'Broken' },
    ] as unknown as Parameters<typeof import('./quick-links-storage').saveQuickLinks>[0];

    const { saveQuickLinks } = await import('./quick-links-storage');
    await expect(saveQuickLinks(links)).resolves.toEqual([
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
    ]);
    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-quick-links', [
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
    ]);
  });

  it('preserves edited icon metadata when saving', async () => {
    const links: QuickLink[] = [
      {
        id: 'a',
        url: 'https://example.com',
        label: 'Example',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ];

    const { saveQuickLinks } = await import('./quick-links-storage');
    await expect(saveQuickLinks(links)).resolves.toEqual([
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('drops non-token image icon values before saving', async () => {
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
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: null,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'b',
        url: 'https://example.com/docs',
        label: 'Docs',
        icon: { kind: 'image', value: 'quick-link-icon:token-1' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('serializes updates against the latest stored quick links', async () => {
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
    let storedLinks: QuickLink[] = [];
    let releaseFirstWrite = () => {};
    const firstWriteStarted = new Promise<void>((resolve) => {
      storageMocks.setItem.mockImplementationOnce(
        () =>
          new Promise<void>((release) => {
            releaseFirstWrite = () => {
              storedLinks = [firstLink];
              release();
            };
            resolve();
          }),
      );
    });
    storageMocks.getItem.mockImplementation(async () => storedLinks);
    storageMocks.setItem.mockImplementation(async (_key, links: QuickLink[]) => {
      storedLinks = links;
    });

    const { updateQuickLinks } = await import('./quick-links-storage');
    const firstUpdate = updateQuickLinks((currentLinks) => [...currentLinks, firstLink]);
    const secondUpdate = updateQuickLinks((currentLinks) => [...currentLinks, secondLink]);

    await firstWriteStarted;
    expect(storedLinks).toEqual([]);

    releaseFirstWrite();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(storedLinks.map((link) => link.id)).toEqual(['first', 'second']);
  });
});
