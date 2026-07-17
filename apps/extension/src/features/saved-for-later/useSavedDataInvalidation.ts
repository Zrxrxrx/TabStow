import { useCallback, useEffect, useRef } from 'react';
import {
  isSavedDataChangeEvent,
  isSavedDataInvalidationEvent,
} from '@/lib/extension-events';

type Options = {
  includeSynchronizedChanges?: boolean;
};

export function useSavedDataInvalidation(
  onInvalidated: () => void | Promise<void>,
  { includeSynchronizedChanges = false }: Options = {},
): void {
  const onInvalidatedRef = useRef(onInvalidated);
  onInvalidatedRef.current = onInvalidated;

  useEffect(() => {
    const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
    function handleRuntimeMessage(message: unknown) {
      const shouldRefresh = includeSynchronizedChanges
        ? isSavedDataInvalidationEvent(message)
        : isSavedDataChangeEvent(message);
      if (shouldRefresh) void onInvalidatedRef.current();
    }

    runtimeMessages?.addListener(handleRuntimeMessage);
    return () => runtimeMessages?.removeListener(handleRuntimeMessage);
  }, [includeSynchronizedChanges]);
}

export function useSavedDataRefreshGate(
  reload: () => void | Promise<void>,
  options: Options = {},
): {
  beginMutation: () => void;
  finishMutation: (reloadRequested: boolean) => Promise<void>;
} {
  const reloadRef = useRef(reload);
  const mountedRef = useRef(false);
  const mutationInFlightRef = useRef(false);
  const invalidationPendingRef = useRef(false);
  reloadRef.current = reload;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationInFlightRef.current = false;
      invalidationPendingRef.current = false;
    };
  }, []);

  const refreshFromEvent = useCallback(() => {
    if (!mountedRef.current) return;
    if (mutationInFlightRef.current) {
      invalidationPendingRef.current = true;
      return;
    }
    return reloadRef.current();
  }, []);
  useSavedDataInvalidation(refreshFromEvent, options);

  const beginMutation = useCallback(() => {
    if (mountedRef.current) mutationInFlightRef.current = true;
  }, []);

  const finishMutation = useCallback(async (reloadRequested: boolean) => {
    if (!mountedRef.current) return;

    try {
      let shouldReload = reloadRequested || invalidationPendingRef.current;
      while (shouldReload && mountedRef.current) {
        invalidationPendingRef.current = false;
        await reloadRef.current();
        shouldReload = invalidationPendingRef.current;
      }
    } finally {
      mutationInFlightRef.current = false;
    }
  }, []);

  return { beginMutation, finishMutation };
}
