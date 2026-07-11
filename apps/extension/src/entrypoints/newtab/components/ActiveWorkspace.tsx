import { Layers } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findDuplicateTabGroups } from '@/features/active-tabs/active-tab-groups';
import { buildActiveTabWindows } from '@/features/active-tabs/active-tab-windows';
import type { ActiveBrowserTab, ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
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
  const targetRefs = useRef(new Map<string, HTMLElement>());
  const closePendingRef = useRef(false);
  const refreshTokenRef = useRef(0);

  async function refresh() {
    const refreshToken = ++refreshTokenRef.current;
    const response = await sendExtensionMessage<AppResult<ActiveTabsSnapshot>>({
      type: 'active-tabs:snapshot',
    });
    if (refreshToken !== refreshTokenRef.current) return;
    setSnapshotReady(true);
    if (!response.ok) {
      onStatus('error', response.error.message);
      return;
    }
    setSnapshot(response.data);
  }

  useEffect(() => {
    void refresh();
  }, [refreshKey]);

  useEffect(() => {
    if (typeof chrome === 'undefined') return;

    const tabsApi = chrome?.tabs;
    const tabGroupsApi = chrome?.tabGroups;
    let timeoutId: number | null = null;

    function scheduleRefresh() {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void refresh();
      }, 150);
    }

    tabsApi?.onCreated?.addListener(scheduleRefresh);
    tabsApi?.onUpdated?.addListener(scheduleRefresh);
    tabsApi?.onRemoved?.addListener(scheduleRefresh);
    tabsApi?.onMoved?.addListener(scheduleRefresh);
    tabGroupsApi?.onCreated?.addListener(scheduleRefresh);
    tabGroupsApi?.onUpdated?.addListener(scheduleRefresh);
    tabGroupsApi?.onRemoved?.addListener(scheduleRefresh);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      tabsApi?.onCreated?.removeListener(scheduleRefresh);
      tabsApi?.onUpdated?.removeListener(scheduleRefresh);
      tabsApi?.onRemoved?.removeListener(scheduleRefresh);
      tabsApi?.onMoved?.removeListener(scheduleRefresh);
      tabGroupsApi?.onCreated?.removeListener(scheduleRefresh);
      tabGroupsApi?.onUpdated?.removeListener(scheduleRefresh);
      tabGroupsApi?.onRemoved?.removeListener(scheduleRefresh);
    };
  }, []);

  const windows = useMemo(() => buildActiveTabWindows(snapshot), [snapshot]);
  const duplicateGroups = useMemo(
    () => findDuplicateTabGroups(snapshot.tabs),
    [snapshot.tabs],
  );
  const currentWindowId = snapshot.windows.find((window) => window.focused)?.id;
  const controlsDisabled = busy || closePending || !snapshotReady;

  async function closeTabs(tabIds: number[]) {
    if (busy || closePendingRef.current || tabIds.length === 0) return;

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
    if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return;
    const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
      type: 'active-tabs:focus',
      tabId: tab.id,
      windowId: tab.windowId,
    });
    if (!response.ok) onStatus('error', response.error.message);
  }

  async function collapseCurrentWindowGroups() {
    if (busy || closePendingRef.current || typeof currentWindowId !== 'number') return;

    const response = await sendExtensionMessage<AppResult<{ collapsed: true; groupCount: number }>>({
      type: 'chrome-tab-groups:collapse-window',
      windowId: currentWindowId,
    });
    if (response.ok) {
      onStatus('success', `Collapsed ${response.data.groupCount} Chrome groups.`);
      return;
    }
    onStatus('error', response.error.message);
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

      <div className="meta-row" data-od-id="active-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refresh()}
          disabled={controlsDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          {t(locale, 'refreshFromChrome')}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void collapseCurrentWindowGroups()}
          disabled={controlsDisabled || typeof currentWindowId !== 'number'}
        >
          <Layers size={16} aria-hidden="true" />
          {t(locale, 'collapseChromeGroups')}
        </button>
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
            disabled={controlsDisabled}
            displayIndex={displayIndex}
            key={window.key}
            locale={locale}
            window={window}
            onCloseTabs={(tabIds) => void closeTabs(tabIds)}
            onFocusTab={(tab) => void focusTab(tab)}
            onRegisterTarget={registerTarget}
            onStowTab={(tab) => void onStowTab(tab)}
          />
        ))}
      </div>
    </section>
  );
}
