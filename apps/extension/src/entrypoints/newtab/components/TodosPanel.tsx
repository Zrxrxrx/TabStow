import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  clearCompletedTodos,
  completeTodo,
  createTodo,
  dismissTodo,
  reorderTodos,
  searchTodos,
  type TodoItem,
} from '@/features/todos/todos';
import { getTodos, saveTodos } from '@/features/todos/todos-storage';

export function TodosPanel() {
  const [query, setQuery] = useState('');
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    void getTodos().then(setTodos);
  }, []);

  const visibleTodos = useMemo(
    () => searchTodos(todos, query).filter((todo) => !todo.dismissed),
    [todos, query],
  );

  async function addTodo() {
    const title = window.prompt('Todo title');
    if (!title) return;

    const description = window.prompt('Todo details') ?? '';
    setTodos(await saveTodos(createTodo(todos, { title, description })));
  }

  async function moveTodo(id: string, direction: -1 | 1) {
    const visibleIds = visibleTodos.map((todo) => todo.id);
    const index = visibleIds.indexOf(id);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= visibleIds.length) return;

    const nextIds = [...visibleIds];
    [nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]];
    setTodos(await saveTodos(reorderTodos(todos, nextIds)));
  }

  async function toggleComplete(id: string) {
    setTodos(await saveTodos(completeTodo(todos, id)));
  }

  async function remove(id: string) {
    setTodos(await saveTodos(dismissTodo(todos, id)));
  }

  async function clearCompleted() {
    setTodos(await saveTodos(clearCompletedTodos(todos)));
  }

  return (
    <section className="utility-panel" aria-labelledby="todos-title">
      <header>
        <h2 id="todos-title">Todos</h2>
        <button type="button" className="icon-button" aria-label="Add todo" onClick={() => void addTodo()}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>

      <input
        className="utility-input"
        aria-label="Search todos"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search todos"
      />

      {visibleTodos.length === 0 ? (
        <div className="empty-state utility-empty-state">No todos yet.</div>
      ) : (
        <div className="todo-list">
          {visibleTodos.map((todo, index) => (
            <div className={`todo-row${todo.completed ? ' todo-row--completed' : ''}`} key={todo.id}>
              <label className="todo-copy">
                <input
                  checked={todo.completed}
                  onChange={() => void toggleComplete(todo.id)}
                  type="checkbox"
                />
                <span>{todo.title}</span>
              </label>
              <div className="todo-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${todo.title} up`}
                  onClick={() => void moveTodo(todo.id, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${todo.title} down`}
                  onClick={() => void moveTodo(todo.id, 1)}
                  disabled={index === visibleTodos.length - 1}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Delete ${todo.title}`}
                  onClick={() => void remove(todo.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="secondary-button" onClick={() => void clearCompleted()}>
        Clear completed
      </button>
    </section>
  );
}
