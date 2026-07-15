import { Layers, MoonStar } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { findDuplicateTabGroups } from '@/features/active-tabs/active-tab-groups';
import { buildActiveTabWindows } from '@/features/active-tabs/active-tab-windows';
import { subscribeToActiveTabsChanges } from '@/features/active-tabs/active-tabs-events';
import type {
  ActiveBrowserTab,
  ActiveTabsDragSource,
  ActiveTabsMoveResult,
  ActiveTabsSleepResult,
  ActiveTabsSnapshot,
} from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import { filterActiveTabsSnapshot } from '@/features/tab-search/tab-search';
import { isBlockedTabUrl } from '@/features/tabs/tab-filter';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import {
  readActiveTabsDragSource,
  writeActiveTabsDragSource,
  resolveActiveTabsDropRequest,
  type ActiveTabsDropTarget,
} from './active-tabs-dnd';
import { ActiveWindowSection } from './ActiveWindowSection';
import { TabLifecyclePolicyDialog } from './TabLifecyclePolicyDialog';
import { TabLifecycleSuggestions } from './TabLifecycleSuggestions';
import { WindowFilter } from './WindowFilter';

type Props = {
  busy: boolean;
  locale: Locale;
  onSnapshot?: (snapshot: ActiveTabsSnapshot) => void;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  onStowTab: (tab: ActiveBrowserTab) => Promise<void>;
  onSuggestedStow: () => void | Promise<void>;
  query: string;
  refreshKey: number;
  suggestionRefreshKey: number;
};

const EMPTY_SNAPSHOT: ActiveTabsSnapshot = { windows: [], tabs: [], chromeGroups: [] };

export function ActiveWorkspace({
  busy,
  locale,
  onSnapshot,
  onStatus,
  onStowTab,
  onSuggestedStow,
  query,
  refreshKey,
  suggestionRefreshKey,
}: Props) {
  const [snapshot, setSnapshot] = useState<ActiveTabsSnapshot>(EMPTY_SNAPSHOT);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [dragSource, setDragSource] = useState<ActiveTabsDragSource | null>(null);
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(null);
  const [movePending, setMovePending] = useState(false);
  const [selectedWindowId, setSelectedWindowId] = useState<number | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [localSuggestionRefreshKey, setLocalSuggestionRefreshKey] = useState(0);
  const [sleepPending, setSleepPending] = useState(false);
  const targetRefs = useRef(new Map<string, HTMLElement>());
  const closePendingRef = useRef(false);
  const dragSourceRef = useRef<ActiveTabsDragSource | null>(null);
  const movePendingRef = useRef(false);
  const sleepPendingRef = useRef(false);
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
      onSnapshot?.(response.data);
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

  const filteredSnapshot = useMemo(
    () => filterActiveTabsSnapshot(snapshot, query),
    [query, snapshot],
  );
  const windows = useMemo(() => buildActiveTabWindows(filteredSnapshot), [filteredSnapshot]);
  const visibleWindows = selectedWindowId === null
    ? windows
    : windows.filter((window) => window.windowId === selectedWindowId);
  const duplicateGroups = useMemo(
    () => findDuplicateTabGroups(filteredSnapshot.tabs),
    [filteredSnapshot.tabs],
  );
  const sleepEligibleTabIds = useMemo(() => {
    const incognitoWindowIds = new Set(
      snapshot.windows.filter((window) => window.incognito).map((window) => window.id),
    );
    const eligibleTabIds = new Set<number>();

    for (const tab of snapshot.tabs) {
      if (
        typeof tab.id === 'number' &&
        !tab.active &&
        !tab.audible &&
        !tab.discarded &&
        !tab.pinned &&
        !incognitoWindowIds.has(tab.windowId) &&
        !isBlockedTabUrl(tab.url)
      ) {
        eligibleTabIds.add(tab.id);
      }
    }

    return eligibleTabIds;
  }, [snapshot]);
  const controlsDisabled = busy || closePending || movePending || sleepPending || !snapshotReady;
  const dragDisabled = controlsDisabled || query.trim() !== '';
  const bulkSleepTabIds = useMemo(
    () =>
      snapshot.tabs.flatMap((tab) =>
        typeof tab.id === 'number' &&
        sleepEligibleTabIds.has(tab.id) &&
        (selectedWindowId === null || tab.windowId === selectedWindowId)
          ? [tab.id]
          : [],
      ),
    [selectedWindowId, sleepEligibleTabIds, snapshot.tabs],
  );
  const bulkSleepDisabled =
    controlsDisabled || query.trim() !== '' || bulkSleepTabIds.length === 0;

  async function closeTabs(tabIds: number[]) {
    if (
      busy ||
      closePendingRef.current ||
      movePendingRef.current ||
      sleepPendingRef.current ||
      tabIds.length === 0
    ) {
      return;
    }

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
      typeof tab.windowId !== 'number' ||
      sleepPendingRef.current
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
    if (event.target instanceof HTMLElement && event.target.closest('button, input, a')) {
      event.preventDefault();
      return;
    }
    if (dragDisabled || movePendingRef.current || sleepPendingRef.current) {
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
    if (!dropRequest || movePendingRef.current || sleepPendingRef.current) return;

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

  async function sleepTabs(tabIds: number[]) {
    if (
      busy ||
      closePendingRef.current ||
      movePendingRef.current ||
      sleepPendingRef.current ||
      tabIds.length === 0
    ) {
      return;
    }

    sleepPendingRef.current = true;
    setSleepPending(true);

    try {
      const response = await sendExtensionMessage<AppResult<ActiveTabsSleepResult>>({
        type: 'active-tabs:sleep',
        tabIds,
      });
      if (!response.ok) {
        onStatus('error', response.error.message);
      } else if (response.data.failures.length > 0) {
        onStatus(
          'error',
          t(locale, 'sleepTabsPartial', {
            failed: response.data.failures.length,
            skipped: response.data.skippedTabIds.length,
            slept: response.data.sleptTabIds.length,
          }),
        );
      } else if (response.data.sleptTabIds.length > 0) {
        const messageKey = response.data.skippedTabIds.length > 0
          ? 'sleepTabsPartial'
          : response.data.sleptTabIds.length === 1
            ? 'sleptTab'
            : 'sleptTabs';
        onStatus(
          'success',
          t(locale, messageKey, {
            failed: 0,
            skipped: response.data.skippedTabIds.length,
            slept: response.data.sleptTabIds.length,
            count: response.data.sleptTabIds.length,
          }),
        );
      } else {
        onStatus('error', t(locale, 'noEligibleTabsToSleep'));
      }
    } finally {
      await refreshThroughLatest();
      sleepPendingRef.current = false;
      if (activeRef.current) setSleepPending(false);
    }
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
          {t(locale, 'openCount', { count: filteredSnapshot.tabs.length })}
        </span>
      </div>

      <div className="active-tools">
        <button
          className="secondary-button"
          disabled={bulkSleepDisabled}
          onClick={() => void sleepTabs(bulkSleepTabIds)}
          title={
            query.trim() !== ''
              ? t(locale, 'sleepSearchUnavailableReason')
              : bulkSleepTabIds.length === 0
                ? t(locale, 'noEligibleTabsToSleep')
                : undefined
          }
          type="button"
        >
          <MoonStar aria-hidden="true" size={15} />
          {t(locale, 'sleepEligibleTabs')}
        </button>
        <button className="secondary-button" onClick={() => setPolicyOpen(true)} type="button">
          {t(locale, 'tabLifecycle')}
        </button>
      </div>

      {snapshotReady ? (
        <TabLifecycleSuggestions
          disabled={controlsDisabled}
          locale={locale}
          onStowed={onSuggestedStow}
          refreshKey={suggestionRefreshKey + localSuggestionRefreshKey}
        />
      ) : null}

      <WindowFilter locale={locale} onChange={setSelectedWindowId} value={selectedWindowId} windows={windows} />

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
          {t(locale, 'closeDuplicates', {
            count: duplicateGroups.reduce((count, group) => count + group.duplicateTabIds.length, 0),
          })}
        </button>
      )}

      <div className="active-window-list">
        {visibleWindows.map((window, displayIndex) => (
          <ActiveWindowSection
            activeDropTargetKey={activeDropTargetKey}
            disabled={controlsDisabled}
            displayIndex={displayIndex}
            dragDisabled={dragDisabled}
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
            onSleepTabs={(tabIds) => void sleepTabs(tabIds)}
            onStowTab={(tab) => void onStowTab(tab)}
            sleepEligibleTabIds={sleepEligibleTabIds}
          />
        ))}
      </div>
      {policyOpen ? (
        <TabLifecyclePolicyDialog
          locale={locale}
          onClose={() => {
            setPolicyOpen(false);
            setLocalSuggestionRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
