import { storage } from '#imports';
import { normalizeTodos, type TodoItem } from './todos';

const TODOS_KEY = 'local:tabstow-todos';

export async function getTodos(): Promise<TodoItem[]> {
  return normalizeTodos(await storage.getItem<TodoItem[]>(TODOS_KEY));
}

export async function saveTodos(todos: TodoItem[]): Promise<TodoItem[]> {
  const normalized = normalizeTodos(todos);
  await storage.setItem(TODOS_KEY, normalized);
  return normalized;
}
