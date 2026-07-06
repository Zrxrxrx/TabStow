export type TodoItem = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  completed: boolean;
  completedAt: string | null;
  dismissed: boolean;
};

function normalizeCreatedAt(value: unknown): string {
  return typeof value === 'string' && value ? value : new Date().toISOString();
}

function normalizeCompletedAt(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function normalizeTodos(input: unknown): TodoItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((todo) => {
      if (!todo || typeof todo !== 'object') return null;

      const candidate = todo as Partial<TodoItem> & {
        id?: unknown;
        title?: unknown;
        description?: unknown;
        createdAt?: unknown;
        completed?: unknown;
        completedAt?: unknown;
        dismissed?: unknown;
      };

      const id = String(candidate.id ?? '').trim();
      const title = String(candidate.title ?? '').trim();
      if (!id || !title) return null;

      return {
        id,
        title,
        description: String(candidate.description ?? ''),
        createdAt: normalizeCreatedAt(candidate.createdAt),
        completed: candidate.completed === true,
        completedAt: normalizeCompletedAt(candidate.completedAt),
        dismissed: candidate.dismissed === true,
      };
    })
    .filter((todo): todo is TodoItem => Boolean(todo));
}

export function createTodo(
  todos: TodoItem[],
  payload: { title: string; description?: string },
  createId: () => string = () => crypto.randomUUID(),
): TodoItem[] {
  const title = payload.title.trim();
  if (!title) throw new Error('Todo title is required.');

  return [
    ...normalizeTodos(todos),
    {
      id: createId(),
      title,
      description: payload.description?.trim() ?? '',
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ];
}

export function completeTodo(todos: TodoItem[], id: string): TodoItem[] {
  const normalized = normalizeTodos(todos);

  return normalized.map((todo) =>
    todo.id === id
      ? {
          ...todo,
          completed: true,
          completedAt: todo.completed && todo.completedAt !== null ? todo.completedAt : new Date().toISOString(),
        }
      : todo,
  );
}

export function dismissTodo(todos: TodoItem[], id: string): TodoItem[] {
  return normalizeTodos(todos).map((todo) =>
    todo.id === id
      ? {
          ...todo,
          dismissed: true,
        }
      : todo,
  );
}

export function clearCompletedTodos(todos: TodoItem[]): TodoItem[] {
  return normalizeTodos(todos).map((todo) =>
    todo.completed
      ? {
          ...todo,
          dismissed: true,
        }
      : todo,
  );
}

export function searchTodos(todos: TodoItem[], query: string): TodoItem[] {
  const needle = query.trim().toLowerCase();
  const normalized = normalizeTodos(todos);
  if (!needle) return normalized;

  return normalized.filter(
    (todo) =>
      todo.title.toLowerCase().includes(needle) || todo.description.toLowerCase().includes(needle),
  );
}

export function reorderTodos(todos: TodoItem[], orderedIds: string[]): TodoItem[] {
  const normalized = normalizeTodos(todos);
  const byId = new Map(normalized.map((todo) => [todo.id, todo]));
  const seen = new Set<string>();
  const ordered: TodoItem[] = [];

  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    const todo = byId.get(id);
    if (!todo) continue;
    seen.add(id);
    ordered.push(todo);
  }

  return [...ordered, ...normalized.filter((todo) => !seen.has(todo.id))];
}
