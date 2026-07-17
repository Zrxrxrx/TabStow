import { useEffect, useRef, useState } from 'react';
import type { TabSession } from '@tabstow/core';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

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

  async function loadSessions() {
    const response = await sendExtensionMessage<AppResult<TabSession[]>>({ type: 'sessions:list' });
    if (response.ok) {
      setSessions(response.data);
      return;
    }
    onStatus({ tone: 'error', message: response.error.message });
  }

  useEffect(() => {
    void loadSessions();
  }, []);

  async function runAction<T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
    options: { reloadOnFailure?: boolean } = {},
  ) {
    if (busyActionRef.current !== null) return;
    busyActionRef.current = actionId;
    setBusyAction(actionId);
    onStatus({ tone: 'info', message: null });
    let reloadSessions = options.reloadOnFailure ?? false;
    let actionSucceeded = false;

    try {
      const response = await action();

      if (response.ok) {
        onStatus({ tone: 'success', message: success(response.data) });
        reloadSessions = true;
        actionSucceeded = true;
      } else {
        onStatus({ tone: 'error', message: response.error.message });
      }
    } finally {
      try {
        if (reloadSessions) await loadSessions();
        if (actionSucceeded) onActionSucceeded?.();
      } finally {
        busyActionRef.current = null;
        setBusyAction(null);
      }
    }
  }

  return { busyAction, loadSessions, runAction, sessions };
}
