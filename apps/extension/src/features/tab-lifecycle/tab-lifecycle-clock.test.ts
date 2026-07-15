import { describe, expect, it, vi } from 'vitest';
import { createLifecycleOperationClock } from './tab-lifecycle-clock';

const NOW = Date.UTC(2026, 6, 15, 12);

describe('lifecycle operation clock', () => {
  it('uses an explicit start as the floor for later readings', () => {
    const source = vi.fn()
      .mockReturnValueOnce(NOW + 2)
      .mockReturnValueOnce(NOW + 1)
      .mockReturnValueOnce(Number.NaN)
      .mockReturnValueOnce(NOW + 3);

    const operationClock = createLifecycleOperationClock({
      now: NOW,
      clock: source,
    });

    expect(operationClock.initialNow).toBe(NOW);
    expect(source).not.toHaveBeenCalled();
    expect(operationClock.read()).toBe(NOW + 2);
    expect(operationClock.read()).toBe(NOW + 2);
    expect(operationClock.read()).toBe(NOW + 2);
    expect(operationClock.read()).toBe(NOW + 3);
  });

  it('samples an injected source once when no explicit start is supplied', () => {
    const source = vi.fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW - 1)
      .mockReturnValueOnce(NOW + 1);

    const operationClock = createLifecycleOperationClock({ clock: source });

    expect(operationClock.initialNow).toBe(NOW);
    expect(source).toHaveBeenCalledTimes(1);
    expect(operationClock.read()).toBe(NOW);
    expect(operationClock.read()).toBe(NOW + 1);
  });

  it('keeps an explicit start fixed when no source is supplied', () => {
    const operationClock = createLifecycleOperationClock({ now: NOW });

    expect(operationClock.initialNow).toBe(NOW);
    expect(operationClock.read()).toBe(NOW);
    expect(operationClock.read()).toBe(NOW);
  });
});
