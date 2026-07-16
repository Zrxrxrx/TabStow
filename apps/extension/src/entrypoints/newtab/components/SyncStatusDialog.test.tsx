import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SyncStatusDialog } from './SyncStatusDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SyncStatusDialog', () => {
  it('renders missing values safely and routes recovery through Settings', async () => {
    const container = document.createElement('div');
    container.id = 'root';
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenSettings = vi.fn();

    await act(async () => root.render(
      <SyncStatusDialog
        connection={{ phase: 'connected', sync: { state: 'paused', action: 'reconnect' } }}
        locale="en"
        onClose={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    ));

    expect(document.body.querySelectorAll('dd')).toHaveLength(7);
    expect(document.body.textContent).toContain('Unavailable');
    const reconnect = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Reconnect GitHub'),
    )!;
    await act(async () => reconnect.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
