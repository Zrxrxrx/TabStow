import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { t, type Locale } from '@/features/i18n/i18n';
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
import { FormDialog } from './FormDialog';

type Props = {
  locale: Locale;
};

export function TodosPanel({ locale }: Props) {
  const [query, setQuery] = useState('');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [todoDialogOpen, setTodoDialogOpen] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDescription, setTodoDescription] = useState('');
  const [todoError, setTodoError] = useState<string | null>(null);
  const [todoSubmitting, setTodoSubmitting] = useState(false);

  useEffect(() => {
    void getTodos().then(setTodos);
  }, []);

  const visibleTodos = useMemo(
    () => searchTodos(todos, query).filter((todo) => !todo.dismissed),
    [todos, query],
  );

  function openTodoDialog() {
    setTodoTitle('');
    setTodoDescription('');
    setTodoError(null);
    setTodoSubmitting(false);
    setTodoDialogOpen(true);
  }

  async function addTodo() {
    setTodoError(null);
    setTodoSubmitting(true);

    try {
      setTodos(await saveTodos(createTodo(todos, { title: todoTitle, description: todoDescription })));
      setTodoDialogOpen(false);
      setTodoTitle('');
      setTodoDescription('');
    } catch (error) {
      setTodoError(error instanceof Error ? error.message : 'Todo title is required.');
    } finally {
      setTodoSubmitting(false);
    }
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
        <h2 id="todos-title">{t(locale, 'todos')}</h2>
        <button type="button" className="icon-button" aria-label={t(locale, 'addTodo')} onClick={openTodoDialog}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>

      <input
        className="utility-input"
        aria-label={t(locale, 'searchTodos')}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t(locale, 'searchTodos')}
      />

      {visibleTodos.length === 0 ? (
        <div className="empty-state utility-empty-state">{t(locale, 'noTodos')}</div>
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
                  aria-label={t(locale, 'moveUp', { label: todo.title })}
                  onClick={() => void moveTodo(todo.id, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'moveDown', { label: todo.title })}
                  onClick={() => void moveTodo(todo.id, 1)}
                  disabled={index === visibleTodos.length - 1}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${t(locale, 'delete')} ${todo.title}`}
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
        {t(locale, 'clearCompleted')}
      </button>

      {todoDialogOpen ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={todoError}
          onCancel={() => setTodoDialogOpen(false)}
          onSubmit={addTodo}
          submitLabel={t(locale, 'add')}
          submitting={todoSubmitting}
          title={t(locale, 'addTodo')}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'todoTitle')}
              <input
                aria-label={t(locale, 'todoTitle')}
                className="dialog-input"
                onChange={(event) => setTodoTitle(event.target.value)}
                type="text"
                value={todoTitle}
              />
            </label>
            <label className="field-label">
              {t(locale, 'todoDetails')}
              <textarea
                aria-label={t(locale, 'todoDetails')}
                className="dialog-textarea"
                onChange={(event) => setTodoDescription(event.target.value)}
                value={todoDescription}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}
    </section>
  );
}
