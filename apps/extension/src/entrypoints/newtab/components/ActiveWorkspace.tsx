import { Archive, ExternalLink, Layers, Trash2, X } from 'lucide-react';
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
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { GroupNav } from './GroupNav';

type Props = {
  busy: boolean;
  onStatus: (tone: 'success' | 'error', message: string) => void;
  onStowCurrentWindow: () => Promise<void>;
  refreshKey: number;
};

export function ActiveWorkspace({ busy, onStatus, onStowCurrentWindow, refreshKey }: Props) {
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
      setWorkspace(await updateActiveWorkspaceState({ manualGroups }));
    } catch (error) {
      onStatus('error', error instanceof Error ? error.message : 'Unable to create group.');
    }
  }

  async function removeTabFromManualGroup(tab: ActiveBrowserTab) {
    if (!workspace || typeof tab.id !== 'number') return;
    setWorkspace(
      await updateActiveWorkspaceState({
        manualGroups: clearTabManualGroup(workspace.manualGroups, tab.id),
      }),
    );
  }

  return (
    <section className="active-workspace" aria-labelledby="active-tabs-title">
      <div className="section-header">
        <h2 id="active-tabs-title">Active tabs</h2>
        <span>{tabs.length} open</span>
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
          Stow this window
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
            className="active-group"
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
                <div className="active-tab-row" key={tab.id ?? tab.url}>
                  <button type="button" onClick={() => void focusTab(tab)}>
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>{getTabLabel(tab)}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Move to manual group"
                    onClick={() => void createManualGroupForTab(tab)}
                  >
                    <Archive size={14} aria-hidden="true" />
                  </button>
                  {group.kind === 'manual' && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Move to domain group"
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
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
