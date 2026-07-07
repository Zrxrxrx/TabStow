import { Archive, Layers, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildActiveTabGroups,
  findDuplicateTabGroups,
} from '@/features/active-tabs/active-tab-groups';
import {
  getActiveWorkspaceState,
  updateActiveWorkspaceState,
  type ActiveWorkspaceState,
} from '@/features/active-tabs/active-workspace-storage';
import {
  addManualGroup,
  assignTabToManualGroup,
  clearTabManualGroup,
  pruneManualGroups,
} from '@/features/active-tabs/manual-groups';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { GroupNav } from './GroupNav';

type Props = {
  busy: boolean;
  locale: Locale;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  onStowCurrentWindow: () => Promise<void>;
  refreshKey: number;
};

export function ActiveWorkspace({ busy, locale, onStatus, onStowCurrentWindow, refreshKey }: Props) {
  const [tabs, setTabs] = useState<ActiveBrowserTab[]>([]);
  const [workspace, setWorkspace] = useState<ActiveWorkspaceState | null>(null);
  const [closePending, setClosePending] = useState(false);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const closePendingRef = useRef(false);
  const refreshTokenRef = useRef(0);

  async function refresh() {
    const refreshToken = ++refreshTokenRef.current;
    const [tabsResponse, state] = await Promise.all([
      sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' }),
      getActiveWorkspaceState(),
    ]);

    if (refreshToken !== refreshTokenRef.current) return;

    if (!tabsResponse.ok) {
      onStatus('error', tabsResponse.error.message);
      return;
    }

    const openIds = tabsResponse.data
      .map((tab) => tab.id)
      .filter((id): id is number => typeof id === 'number');
    const prunedManualGroups = pruneManualGroups(state.manualGroups, openIds);
    const nextState =
      JSON.stringify(prunedManualGroups) === JSON.stringify(state.manualGroups)
        ? state
        : await updateActiveWorkspaceState({ manualGroups: prunedManualGroups });

    if (refreshToken !== refreshTokenRef.current) return;

    setTabs(tabsResponse.data);
    setWorkspace(nextState);
  }

  useEffect(() => {
    void refresh();
  }, [refreshKey]);

  const groups = useMemo(
    () => (workspace ? buildActiveTabGroups(tabs, workspace.manualGroups, workspace.order) : []),
    [tabs, workspace],
  );
  const duplicateGroups = useMemo(() => findDuplicateTabGroups(tabs), [tabs]);
  const currentWindowId = tabs.find((tab) => tab.active && typeof tab.windowId === 'number')?.windowId
    ?? tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;

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

  const closeDisabled = busy || closePending;
  const chromeGroupControlsDisabled = busy || closePending || !workspace;
  const chromeGroupCollapseDisabled = chromeGroupControlsDisabled || typeof currentWindowId !== 'number';

  async function focusTab(tab: ActiveBrowserTab) {
    if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return;
    const response = await sendExtensionMessage<AppResult<{ focused: true }>>({
      type: 'active-tabs:focus',
      tabId: tab.id,
      windowId: tab.windowId,
    });
    if (!response.ok) onStatus('error', response.error.message);
  }

  async function createManualGroupForTab(tab: ActiveBrowserTab) {
    if (!workspace || typeof tab.id !== 'number') return;
    const name = window.prompt('Group name');
    if (!name) return;

    try {
      const created = addManualGroup(workspace.manualGroups, name);
      const manualGroups = assignTabToManualGroup(created.state, tab.id, created.group.id);
      const nextWorkspace = await updateActiveWorkspaceState({ manualGroups });
      setWorkspace(nextWorkspace);
      await syncChromeGroupsForWorkspace(nextWorkspace);
    } catch (error) {
      onStatus('error', error instanceof Error ? error.message : 'Unable to create group.');
    }
  }

  async function removeTabFromManualGroup(tab: ActiveBrowserTab) {
    if (!workspace || typeof tab.id !== 'number') return;
    const openTabIds = tabs
      .map((openTab) => openTab.id)
      .filter((id): id is number => typeof id === 'number');
    const manualGroups = pruneManualGroups(clearTabManualGroup(workspace.manualGroups, tab.id), openTabIds);
    const nextWorkspace = await updateActiveWorkspaceState({ manualGroups });
    setWorkspace(nextWorkspace);
    await syncChromeGroupsForWorkspace(nextWorkspace);
  }

  async function syncChromeGroupsForWorkspace(nextWorkspace: ActiveWorkspaceState) {
    if (!nextWorkspace.chromeTabGroups.enabled) return;
    const nextGroups = buildActiveTabGroups(tabs, nextWorkspace.manualGroups, nextWorkspace.order);
    const response = await sendExtensionMessage<AppResult<ActiveWorkspaceState['chromeTabGroups']>>({
      type: 'chrome-tab-groups:sync',
      groups: nextGroups,
      state: nextWorkspace.chromeTabGroups,
    });
    if (response.ok) {
      const syncedWorkspace = await updateActiveWorkspaceState({ chromeTabGroups: response.data });
      setWorkspace(syncedWorkspace);
      return;
    }
    onStatus('error', response.error.message);
  }

  async function toggleChromeTabGroups() {
    if (!workspace || busy || closePendingRef.current) return;
    const nextState = {
      ...workspace.chromeTabGroups,
      enabled: !workspace.chromeTabGroups.enabled,
    };
    const response = await sendExtensionMessage<AppResult<ActiveWorkspaceState['chromeTabGroups']>>({
      type: 'chrome-tab-groups:sync',
      groups,
      state: nextState,
    });
    if (response.ok) {
      setWorkspace(await updateActiveWorkspaceState({ chromeTabGroups: response.data }));
      onStatus('success', response.data.enabled ? 'Chrome tab groups enabled.' : 'Chrome tab groups disabled.');
      return;
    }
    onStatus('error', response.error.message);
  }

  async function importExistingChromeGroups() {
    if (!workspace || busy || closePendingRef.current) return;
    const response = await sendExtensionMessage<
      AppResult<{
        manualGroups: ActiveWorkspaceState['manualGroups'];
        chromeTabGroups: ActiveWorkspaceState['chromeTabGroups'];
      }>
    >({
      type: 'chrome-tab-groups:import',
      tabs,
      manualGroups: workspace.manualGroups,
      state: workspace.chromeTabGroups,
    });
    if (response.ok) {
      setWorkspace(
        await updateActiveWorkspaceState({
          manualGroups: response.data.manualGroups,
          chromeTabGroups: response.data.chromeTabGroups,
        }),
      );
      onStatus('success', 'Imported Chrome tab groups.');
      return;
    }
    onStatus('error', response.error.message);
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

  return (
    <section className="panel column active-workspace" aria-labelledby="active-tabs-title" data-od-id="active-tabs-column">
      <div className="section-header">
        <div>
          <h2 id="active-tabs-title" data-od-id="active-tabs-title">
            {t(locale, 'activeTabs')}
          </h2>
          <p className="subtle">Equivalent to open Chrome tabs, grouped by domain or manual workspace.</p>
        </div>
        <span className="meta-pill" id="active-count" data-od-id="active-tabs-count">
          {tabs.length} open
        </span>
      </div>

      <div className="meta-row" data-od-id="active-actions">
        <label className="toggle-row">
          <input
            checked={Boolean(workspace?.chromeTabGroups.enabled)}
            onChange={() => void toggleChromeTabGroups()}
            type="checkbox"
            disabled={chromeGroupControlsDisabled}
          />
          <span>{t(locale, 'syncManualGroups')}</span>
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void collapseCurrentWindowGroups()}
          disabled={chromeGroupCollapseDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          {t(locale, 'collapseChromeGroups')}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void importExistingChromeGroups()}
          disabled={chromeGroupControlsDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          {t(locale, 'importChromeGroups')}
        </button>
      </div>

      <div className="active-workspace-hint">
        <p>Ready to clear this workspace? Stow the current window here or from the toolbar.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void onStowCurrentWindow()}
          disabled={busy}
        >
          <Archive size={16} aria-hidden="true" />
          {t(locale, 'stowThisWindow')}
        </button>
      </div>

      <GroupNav
        groups={groups}
        onJump={(groupKey) =>
          groupRefs.current.get(groupKey)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }
      />

      {duplicateGroups.length > 0 && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => void closeTabs(duplicateGroups.flatMap((group) => group.duplicateTabIds))}
          disabled={closeDisabled}
        >
          <Layers size={16} aria-hidden="true" />
          Close {duplicateGroups.reduce((count, group) => count + group.duplicateTabIds.length, 0)}{' '}
          duplicates
        </button>
      )}

      <div className="active-group-list">
        {groups.map((group) => (
          <article
            className="tab-group"
            key={group.key}
            ref={(node) => {
              if (node) {
                groupRefs.current.set(group.key, node);
                return;
              }

              groupRefs.current.delete(group.key);
            }}
          >
            <header>
              <h3>{group.title}</h3>
              <button
                type="button"
                className="icon-button"
                aria-label={`Close ${group.title} tabs`}
                onClick={() =>
                  void closeTabs(
                    group.tabs
                      .map((tab) => tab.id)
                      .filter((id): id is number => typeof id === 'number'),
                  )
                }
                disabled={closeDisabled}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="active-tab-list">
              {group.tabs.map((tab) => (
                <div className="tab-row" key={tab.id ?? tab.url}>
                  <button className="tab-open-button" type="button" onClick={() => void focusTab(tab)}>
                    <span className="favicon tone-blue" aria-hidden="true">
                      {(getTabLabel(tab).match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase()}
                    </span>
                    <span className="tab-copy">
                      <span className="tab-title">{getTabLabel(tab)}</span>
                      <span className="tab-url">{tab.url ?? ''}</span>
                    </span>
                  </button>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t(locale, 'moveToManualGroup')}
                      onClick={() => void createManualGroupForTab(tab)}
                    >
                      <Archive size={14} aria-hidden="true" />
                    </button>
                    {group.kind === 'manual' && (
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t(locale, 'moveToDomainGroup')}
                        onClick={() => void removeTabFromManualGroup(tab)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Close ${getTabLabel(tab)}`}
                      onClick={() => typeof tab.id === 'number' && void closeTabs([tab.id])}
                      disabled={closeDisabled}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
