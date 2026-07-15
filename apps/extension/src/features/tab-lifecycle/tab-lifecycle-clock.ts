export type LifecycleClockOptions = {
  clock?: () => number;
  now?: number;
};

export type LifecycleOperationClock = {
  initialNow: number;
  read: () => number;
};

export function createLifecycleOperationClock(
  options: LifecycleClockOptions = {},
): LifecycleOperationClock {
  const fixedNow = options.now;
  const source = options.clock ?? (fixedNow === undefined ? Date.now : () => fixedNow);
  let current = fixedNow ?? source();

  return {
    initialNow: current,
    read: () => {
      const candidate = source();
      if (Number.isFinite(candidate) && candidate >= current) {
        current = candidate;
      }
      return current;
    },
  };
}
