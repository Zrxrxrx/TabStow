import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { NewTabFeedback } from './NewTabFeedback';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('NewTabFeedback', () => {
  it('uses non-blocking status semantics for success', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<NewTabFeedback message="Saved" tone="success" />));

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it('uses alert semantics for errors and renders nothing without a message', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<NewTabFeedback message="Failed" tone="error" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Failed');

    await act(async () => root.render(<NewTabFeedback message={null} tone="info" />));
    expect(container.childElementCount).toBe(0);

    await act(async () => root.unmount());
  });
});
