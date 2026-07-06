import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
