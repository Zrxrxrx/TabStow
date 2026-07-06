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
});
