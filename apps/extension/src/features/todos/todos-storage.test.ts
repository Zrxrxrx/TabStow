import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('#imports', () => ({
  storage: storageMocks,
}));

describe('todo storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads normalized todos', async () => {
    storageMocks.getItem.mockResolvedValue([{ id: 'a', title: 'Review' }]);

    const { getTodos } = await import('./todos-storage');
    expect(await getTodos()).toEqual([
      {
        id: 'a',
        title: 'Review',
        description: '',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
  });

  it('normalizes before saving and returns normalized todos', async () => {
    const todos = [
      null,
      { id: 'a', title: 'Review', description: '  Notes  ' },
      { id: 'b', title: '', description: 'Drop me' },
    ] as unknown as Parameters<typeof import('./todos-storage').saveTodos>[0];

    const { saveTodos } = await import('./todos-storage');
    await expect(saveTodos(todos)).resolves.toEqual([
      {
        id: 'a',
        title: 'Review',
        description: '  Notes  ',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);

    expect(storageMocks.setItem).toHaveBeenCalledWith('local:tabstow-todos', [
      {
        id: 'a',
        title: 'Review',
        description: '  Notes  ',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
  });
});
