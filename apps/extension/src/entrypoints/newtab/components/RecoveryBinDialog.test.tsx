import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { RecoveryBinDialog } from './RecoveryBinDialog';

const sendExtensionMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/messages', () => ({ sendExtensionMessage }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RecoveryBinDialog', () => {
  it('sorts History newest-first, limits the preview to five, and restores complete entries', async () => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } },
    });
    const entries = Array.from({ length: 6 }, (_, index) => ({
      id: `history-${index}`,
      sourceSessionId: `session-${index}`,
      sourceTitle: `Session ${index}`,
      tabs: [{ id: `tab-${index}`, title: `Tab ${index}`, url: `https://example.com/${index}`, createdAt: '2026-07-01T00:00:00.000Z' }],
      originalCreatedAt: '2026-07-01T00:00:00.000Z',
      movedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      reason: 'deleted' as const,
      deviceId: 'device-1',
    }));
    sendExtensionMessage.mockImplementation(async (message: { type: string; historyId?: string }) => {
      if (message.type === 'history:list') return { ok: true, data: entries };
      if (message.type === 'history:restore') return { ok: true, data: { id: message.historyId } };
      throw new Error(`Unexpected message: ${message.type}`);
    });
    const onRestored = vi.fn();
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(<RecoveryBinDialog locale="en" onClose={() => undefined} onRestored={onRestored} />));

    expect(document.body.querySelectorAll('.recovery-entry')).toHaveLength(5);
    expect(document.body.querySelector('.recovery-entry strong')?.textContent).toBe('Session 5');
    expect(document.body.querySelector<HTMLImageElement>('.recovery-entry img.saved-tab-favicon')?.src).toContain(
      '_favicon/?pageUrl=https%3A%2F%2Fexample.com%2F5',
    );
    const restore = document.body.querySelector<HTMLButtonElement>('.recovery-entry button')!;
    await act(async () => restore.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(sendExtensionMessage).toHaveBeenCalledWith({ type: 'history:restore', historyId: 'history-5' });
    expect(onRestored).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
