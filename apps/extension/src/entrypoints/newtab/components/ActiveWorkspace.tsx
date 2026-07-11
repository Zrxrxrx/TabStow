import { Layers } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { findDuplicateTabGroups } from '@/features/active-tabs/active-tab-groups';
import { buildActiveTabWindows } from '@/features/active-tabs/active-tab-windows';
import { subscribeToActiveTabsChanges } from '@/features/active-tabs/active-tabs-events';
import type {
  ActiveBrowserTab,
  ActiveTabsDragSource,
  ActiveTabsMoveResult,
  ActiveTabsSnapshot,
} from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import {
  readActiveTabsDragSource,
  writeActiveTabsDragSource,
  resolveActiveTabsDropRequest,
  type ActiveTabsDropTarget,
} from './active-tabs-dnd';
import { ActiveWindowSection } from './ActiveWindowSection';
import { GroupNav } from './GroupNav';

type Props = {
  busy: boolean;
  locale: Locale;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  onStowTab: (tab: ActiveBrowserTab) => Promise<void>;
  refreshKey: number;
};

const EMPTY_SNAPSHOT: ActiveTabsSnapshot = { windows: [], tabs: [], chromeGroups: [] };

export function ActiveWorkspace({
  busy,
  locale,
  onStatus,
  onStowTab,
  refreshKey,
}: Props) {
  const [snapshot, setSnapshot] = useState<ActiveTabsSnapshot>(EMPTY_SNAPSHOT);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [dragSource, setDragSource] = useState<ActiveTabsDragSource | null>(null);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const targetRefs = useRef(new Map<string, HTMLElement>());
  const closePendingRef = useRef(false);
  const dragSourceRef = useRef<ActiveTabsDragSource | null>(null);
  const movePendingRef = useRef(false);
  const refreshTokenRef = useRef(0);
  const authoritativeRefreshWaitersRef = useRef(new Set<() => void>());
  const activeRef = useRef(true);

  function settleAuthoritativeRefreshWaiters() {
    const waiters = [...authoritativeRefreshWaitersRef.current];
    authoritativeRefreshWaitersRef.current.clear();
    for (const resolve of waiters) resolve();
  }

  async function refresh() {
    if (!activeRef.current) return;
    const refreshToken = ++refreshTokenRef.current;
    const response = await sendExtensionMessage<AppResult<ActiveTabsSnapshot>>({
      type: 'active-tabs:snapshot',
    });
    if (!activeRef.current || refreshToken !== refreshTokenRef.current) return;
    setSnapshotReady(true);
    if (!response.ok) {
      onStatus('error', response.error.message);
    } else {
      setSnapshot(response.data);
    }

    settleAuthoritativeRefreshWaiters();
  }

  function refreshThroughLatest(): Promise<void> {
    if (!activeRef.current) return Promise.resolve();
    return new Promise((resolve) => {
      authoritativeRefreshWaitersRef.current.add(resolve);
      void refresh();
    });
  }

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      refreshTokenRef.current += 1;
      settleAuthoritativeRefreshWaiters();
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refreshKey]);

  useEffect(() => {
    let timeoutId: number | null = null;
    const unsubscribe = subscribeToActiveTabsChanges(() => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void refresh();
      }, 150);
    });

    return () => {
      refreshTokenRef.current += 1;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);

  const windows = useMemo(() => buildActiveTabWindows(snapshot), [snapshot]);
  const duplicateGroups = useMemo(
    () => findDuplicateTabGroups(snapshot.tabs),
    [snapshot.tabs],
  );
  const controlsDisabled = busy || closePending || movePending || !snapshotReady;

  async function closeTabs(tabIds: number[]) {
    if (busy || closePendingRef.current || movePendingRef.current || tabIds.length === 0) return;

    closePendingRef.current = true;
    setClosePending(true);

    try {
      const response = await sendExtensionMessage<AppResult<{ closed: true; tabCount: number }>>({
        type: 'active-tabs:close',
        tabIds,
      });
      if (response.ok) {
        onStatus('success', `Closed ${response.data.tabCount} tabs.`);
        await refresh();
        return;
      }
      onStatus('error', response.error.message);
    } finally {
      closePendingRef.current = false;
      setClosePending(false);
    }
  }

  async function focusTab(tab: ActiveBrowserTab) {
    if (
      busy ||
      closePendingRef.current ||
      movePendingRef.current ||
      typeof tab.id !== 'number' ||
      typeof tab.windowId !== 'number'
    ) {
      return;
    }
    const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
      type: 'active-tabs:focus',
      tabId: tab.id,
      windowId: tab.windowId,
    });
    if (!response.ok) onStatus('error', response.error.message);
  }

  function startDrag(event: DragEvent, source: ActiveTabsDragSource) {
    event.stopPropagation();
    if (controlsDisabled || movePendingRef.current) {
      event.preventDefault();
      return;
    }

    dragSourceRef.current = source;
    setDragSource(source);
    writeActiveTabsDragSource(event.dataTransfer, source);
  }

  function endDrag(event?: DragEvent) {
    event?.stopPropagation();
    dragSourceRef.current = null;
    if (!activeRef.current) return;
    setDragSource(null);
    setActiveDropTargetKey(null);
  }

  async function dropOnTarget(event: DragEvent, target: ActiveTabsDropTarget) {
    event.stopPropagation();
    const source = readActiveTabsDragSource(event.dataTransfer) ?? dragSourceRef.current;
    const dropRequest = source ? resolveActiveTabsDropRequest(source, target) : null;
    if (!dropRequest || movePendingRef.current) return;

    event.preventDefault();
    movePendingRef.current = true;
    setMovePending(true);
    setActiveDropTargetKey(null);

    try {
      const response =
        dropRequest.kind === 'tab'
          ? await sendExtensionMessage<AppResult<ActiveTabsMoveResult>>({
              type: 'active-tabs:move-tab',
              request: dropRequest.request,
            })
          : await sendExtensionMessage<AppResult<ActiveTabsMoveResult>>({
              type: 'active-tabs:move-group',
              request: dropRequest.request,
            });
      if (!response.ok && activeRef.current) onStatus('error', response.error.message);
    } finally {
      await refreshThroughLatest();
      movePendingRef.current = false;
      if (activeRef.current) setMovePending(false);
      endDrag();
    }
  }

  function registerTarget(key: string, node: HTMLElement | null) {
    if (node) {
      targetRefs.current.set(key, node);
      return;
    }
    targetRefs.current.delete(key);
  }

  return (
    <section
      className="panel column active-workspace"
      aria-labelledby="active-tabs-title"
      data-od-id="active-tabs-column"
    >
      <div className="section-header">
        <div>
          <h2 id="active-tabs-title" data-od-id="active-tabs-title">
            {t(locale, 'activeTabs')}
          </h2>
          <p className="subtle">{t(locale, 'activeTabsSubtitle')}</p>
        </div>
        <span className="meta-pill" id="active-count" data-od-id="active-tabs-count">
          {snapshot.tabs.length} open
        </span>
      </div>

      <GroupNav
        locale={locale}
        windows={windows}
        onJump={(key) =>
          targetRefs.current.get(key)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }
      />

      {duplicateGroups.length > 0 && (
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void closeTabs(duplicateGroups.flatMap((group) => group.duplicateTabIds))
          }
          disabled={controlsDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          Close {duplicateGroups.reduce((count, group) => count + group.duplicateTabIds.length, 0)}{' '}
          duplicates
        </button>
      )}

      <div className="active-window-list">
        {windows.map((window, displayIndex) => (
          <ActiveWindowSection
            activeDropTargetKey={activeDropTargetKey}
            disabled={controlsDisabled}
            displayIndex={displayIndex}
            dragSource={dragSource}
            key={window.key}
            locale={locale}
            window={window}
            onActivateDropTarget={setActiveDropTargetKey}
            onCloseTabs={(tabIds) => void closeTabs(tabIds)}
            onDragEnd={endDrag}
            onDragStart={startDrag}
            onDrop={(event, target) => void dropOnTarget(event, target)}
            onFocusTab={(tab) => void focusTab(tab)}
            onRegisterTarget={registerTarget}
            onStowTab={(tab) => void onStowTab(tab)}
          />
        ))}
      </div>
    </section>
  );
}
