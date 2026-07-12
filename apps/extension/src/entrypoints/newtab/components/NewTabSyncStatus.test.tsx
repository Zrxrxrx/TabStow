import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { NewTabSyncStatus } from './NewTabSyncStatus';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('NewTabSyncStatus', () => {
  it('shows paused guidance and opens details', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenDetails = vi.fn();

    await act(async () => root.render(
      <NewTabSyncStatus
        connection={{ phase: 'connected', sync: { state: 'paused', action: 'reconnect' } }}
        locale="en"
        onOpenDetails={onOpenDetails}
      />,
    ));

    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toContain('Sync paused');
    expect(button.textContent).toContain('Reconnect GitHub to resume synchronization.');
    await act(async () => button.click());
    expect(onOpenDetails).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
