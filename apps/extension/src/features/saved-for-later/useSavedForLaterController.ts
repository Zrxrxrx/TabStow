import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { useSavedDataRefreshGate } from './useSavedDataInvalidation';

export type SavedForLaterStatus = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

export type RunSavedForLaterAction = <T>(
  actionId: string,
  action: () => Promise<AppResult<T>>,
  success: (data: T) => string,
  options?: { reloadOnFailure?: boolean },
) => Promise<void>;

export type SavedForLaterController = {
  busyAction: string | null;
  loadSessions: () => Promise<void>;
  runAction: RunSavedForLaterAction;
  sessions: TabSession[];
};

type UseSavedForLaterControllerOptions = {
  onActionSucceeded?: () => void;
  onStatus: (status: SavedForLaterStatus) => void;
};

export function useSavedForLaterController({
  onActionSucceeded,
  onStatus,
}: UseSavedForLaterControllerOptions): SavedForLaterController {
  const [sessions, setSessions] = useState<TabSession[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyActionRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const onActionSucceededRef = useRef(onActionSucceeded);
  const onStatusRef = useRef(onStatus);
  onActionSucceededRef.current = onActionSucceeded;
  onStatusRef.current = onStatus;

  const loadSessions = useCallback(async () => {
    if (!mountedRef.current) return;
    const generation = ++loadGenerationRef.current;
    const response = await sendExtensionMessage<AppResult<TabSession[]>>({ type: 'sessions:list' });
    if (!mountedRef.current || generation !== loadGenerationRef.current) return;

    if (response.ok) {
      setSessions(response.data);
      return;
    }
    onStatusRef.current({ tone: 'error', message: response.error.message });
  }, []);

  const { beginMutation, finishMutation } = useSavedDataRefreshGate(
    loadSessions,
    { includeSynchronizedChanges: true },
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadSessions();
    return () => {
      mountedRef.current = false;
      ++loadGenerationRef.current;
    };
  }, [loadSessions]);

  const runAction = useCallback(async function runAction<T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
    options: { reloadOnFailure?: boolean } = {},
  ) {
    if (!mountedRef.current || busyActionRef.current !== null) return;
    busyActionRef.current = actionId;
    beginMutation();
    setBusyAction(actionId);
    onStatusRef.current({ tone: 'info', message: null });
    let reloadSessions = options.reloadOnFailure ?? false;
    let actionSucceeded = false;

    try {
      const response = await action();
      if (!mountedRef.current) return;

      if (response.ok) {
        onStatusRef.current({ tone: 'success', message: success(response.data) });
        reloadSessions = true;
        actionSucceeded = true;
      } else {
        onStatusRef.current({ tone: 'error', message: response.error.message });
      }
    } finally {
      if (!mountedRef.current) {
        busyActionRef.current = null;
        return;
      }
      try {
        await finishMutation(reloadSessions);
        if (mountedRef.current && actionSucceeded) onActionSucceededRef.current?.();
      } finally {
        busyActionRef.current = null;
        if (mountedRef.current) setBusyAction(null);
      }
    }
  }, [beginMutation, finishMutation]);

  return { busyAction, loadSessions, runAction, sessions };
}
