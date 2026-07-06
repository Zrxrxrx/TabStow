import { describe, expect, it } from 'vitest';
import {
  clearCompletedTodos,
  completeTodo,
  createTodo,
  dismissTodo,
  normalizeTodos,
  reorderTodos,
  searchTodos,
} from './todos';

describe('todos', () => {
  it('creates active todos', () => {
    expect(createTodo([], { title: 'Ship migration', description: 'Keep scope tight' }, () => 'todo-1')).toEqual([
      {
        id: 'todo-1',
        title: 'Ship migration',
        description: 'Keep scope tight',
        createdAt: expect.any(String),
        completed: false,
        completedAt: null,
        dismissed: false,
      },
    ]);
  });

  it('normalizes malformed entries into valid todos only', () => {
    expect(
      normalizeTodos([
        null,
        undefined,
        'bad',
        { id: '', title: 'Missing id' },
        { id: 'a', title: '  Review  ', description: 123, createdAt: 123, completed: 'yes', completedAt: 456, dismissed: 'no' },
      ]),
    ).toEqual([
      {
        id: 'a',
        title: 'Review',
        description: '123',
        createdAt: expect.any(String),
        completed: true,
        completedAt: null,
        dismissed: true,
      },
    ]);
  });

  it('completes, dismisses, and clears completed todos', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'Done', completed: false }]);
    const completed = completeTodo(todos, 'a');
    expect(completed[0].completed).toBe(true);
    expect(dismissTodo(completed, 'a')[0].dismissed).toBe(true);
    expect(clearCompletedTodos(completed)[0].dismissed).toBe(true);
  });

  it('searches title and description', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'Review', description: 'Chrome groups' }]);
    expect(searchTodos(todos, 'groups')).toHaveLength(1);
  });

  it('reorders todos by id without duplicating repeated ids', () => {
    const todos = normalizeTodos([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]);
    expect(reorderTodos(todos, ['b', 'b', 'a']).map((todo) => todo.id)).toEqual(['b', 'a', 'c']);
  });
});
