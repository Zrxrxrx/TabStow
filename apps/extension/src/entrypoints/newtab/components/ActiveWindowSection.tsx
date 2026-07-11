import { Archive, Trash2, X } from 'lucide-react';
import { Fragment, type DragEvent } from 'react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type {
  ActiveBrowserTab,
  ActiveTabLane,
  ActiveTabsDragSource,
  ActiveTabWindow,
  ActiveWindowItem,
} from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import {
  resolveActiveTabsDropRequest,
  type ActiveTabsDropTarget,
} from './active-tabs-dnd';

type Props = {
  activeDropTargetKey: string | null;
  disabled: boolean;
  displayIndex: number;
  dragSource: ActiveTabsDragSource | null;
  locale: Locale;
  window: ActiveTabWindow;
  onActivateDropTarget: (key: string | null) => void;
  onCloseTabs: (tabIds: number[]) => void;
  onDragEnd: (event: DragEvent) => void;
  onDragStart: (event: DragEvent, source: ActiveTabsDragSource) => void;
  onDrop: (event: DragEvent, target: ActiveTabsDropTarget) => void;
  onFocusTab: (tab: ActiveBrowserTab) => void;
  onRegisterTarget: (key: string, node: HTMLElement | null) => void;
  onStowTab: (tab: ActiveBrowserTab) => void;
};

type DropZoneProps = {
  activeKey: string | null;
  disabled: boolean;
  dragSource: ActiveTabsDragSource | null;
  label: string;
  target: ActiveTabsDropTarget;
  onActivate: (key: string | null) => void;
  onDrop: (event: DragEvent, target: ActiveTabsDropTarget) => void;
};

function DropZone(props: DropZoneProps) {
  const accepts = Boolean(
    !props.disabled &&
      props.dragSource &&
      resolveActiveTabsDropRequest(props.dragSource, props.target),
  );

  return (
    <div
      className={`drop-insertion${
        props.activeKey === props.target.key ? ' is-active-drop-target' : ''
      }`}
      aria-label={props.label}
      onDragEnter={(event) => {
        if (!accepts) return;
        event.preventDefault();
        event.stopPropagation();
        props.onActivate(props.target.key);
      }}
      onDragOver={(event) => {
        if (!accepts) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDragLeave={(event) => {
        if (!accepts) return;
        event.stopPropagation();
        if (props.activeKey === props.target.key) props.onActivate(null);
      }}
      onDrop={(event) => {
        if (!accepts) return;
        event.stopPropagation();
        props.onDrop(event, props.target);
      }}
    />
  );
}

function topLevelTarget(
  browserWindow: ActiveTabWindow,
  item: ActiveWindowItem,
  kind: 'before' | 'after',
): ActiveTabsDropTarget {
  const anchor =
    item.kind === 'tab'
      ? { kind: 'tab' as const, tabId: item.tab.id as number }
      : { kind: 'group' as const, groupId: item.groupId };
  const position = { kind, anchor } as const;
  return {
    key: `${browserWindow.key}:${kind}:${item.key}`,
    incognito: browserWindow.incognito,
    tabDestination: {
      windowId: browserWindow.windowId,
      lane: { kind: 'ungrouped' },
      position,
    },
    groupDestination: { windowId: browserWindow.windowId, position },
  };
}

function groupEndTarget(browserWindow: ActiveTabWindow, groupId: number): ActiveTabsDropTarget {
  return {
    key: `${browserWindow.key}:group:${groupId}:end`,
    incognito: browserWindow.incognito,
    tabDestination: {
      windowId: browserWindow.windowId,
      lane: { kind: 'group', groupId },
      position: { kind: 'end' },
    },
  };
}

function windowEndTarget(browserWindow: ActiveTabWindow): ActiveTabsDropTarget {
  return {
    key: `${browserWindow.key}:end`,
    incognito: browserWindow.incognito,
    tabDestination: {
      windowId: browserWindow.windowId,
      lane: { kind: 'ungrouped' },
      position: { kind: 'end' },
    },
    groupDestination: {
      windowId: browserWindow.windowId,
      position: { kind: 'end' },
    },
  };
}

function tabLaneTarget(
  browserWindow: ActiveTabWindow,
  lane: ActiveTabLane,
  tabId: number,
  kind: 'before' | 'after',
): ActiveTabsDropTarget {
  return {
    key: `${browserWindow.key}:${lane.kind}:${kind}:tab:${tabId}`,
    incognito: browserWindow.incognito,
    tabDestination: {
      windowId: browserWindow.windowId,
      lane,
      position: { kind, anchor: { kind: 'tab', tabId } },
    },
  };
}

function pinnedEndTarget(browserWindow: ActiveTabWindow): ActiveTabsDropTarget {
  return {
    key: `${browserWindow.key}:pinned:end`,
    incognito: browserWindow.incognito,
    tabDestination: {
      windowId: browserWindow.windowId,
      lane: { kind: 'pinned' },
      position: { kind: 'end' },
    },
  };
}

function itemLabel(item: ActiveWindowItem, locale: Locale): string {
  return item.kind === 'tab'
    ? getTabLabel(item.tab)
    : item.title ?? t(locale, 'chromeGroupFallback', { id: item.groupId });
}

export function ActiveWindowSection(props: Props) {
  const windowLabel = props.window.focused
    ? t(props.locale, 'currentWindow')
    : t(props.locale, 'windowNumber', { number: props.displayIndex + 1 });
  const showPinnedLane =
    props.window.pinnedTabs.length > 0 ||
    (props.dragSource?.kind === 'tab' && props.dragSource.pinned);

  function dropZone(label: string, target: ActiveTabsDropTarget) {
    return (
      <DropZone
        activeKey={props.activeDropTargetKey}
        disabled={props.disabled}
        dragSource={props.dragSource}
        label={label}
        target={target}
        onActivate={props.onActivateDropTarget}
        onDrop={props.onDrop}
      />
    );
  }

  function tabRow(tab: ActiveBrowserTab) {
    const label = getTabLabel(tab);
    return (
      <div className="tab-row">
        <button
          type="button"
          className="drag-handle"
          draggable={!props.disabled}
          disabled={props.disabled}
          aria-label={t(props.locale, 'dragTab', { label })}
          onDragStart={(event) =>
            props.onDragStart(event, {
              kind: 'tab',
              tabId: tab.id as number,
              windowId: props.window.windowId,
              pinned: Boolean(tab.pinned),
              incognito: props.window.incognito,
            })
          }
          onDragEnd={props.onDragEnd}
        >
          ⋮⋮
        </button>
        <button
          className="tab-open-button"
          type="button"
          onClick={() => props.onFocusTab(tab)}
          disabled={props.disabled}
        >
          <span className="favicon tone-blue" aria-hidden="true">
            {(label.match(/[A-Za-z0-9]/)?.[0] ?? 'T').toUpperCase()}
          </span>
          <span className="tab-copy">
            <span className="tab-title">{label}</span>
            <span className="tab-url">{tab.url ?? ''}</span>
          </span>
        </button>
        <div className="row-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t(props.locale, 'saveTabForLater', { label })}
            onClick={() => props.onStowTab(tab)}
            disabled={props.disabled}
          >
            <Archive size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${label}`}
            onClick={() => typeof tab.id === 'number' && props.onCloseTabs([tab.id])}
            disabled={props.disabled}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  function tabLaneRows(tabs: ActiveBrowserTab[], lane: ActiveTabLane, laneLabel: string) {
    const firstTab = tabs[0];
    return (
      <>
        {firstTab &&
          dropZone(
            `Drop before ${getTabLabel(firstTab)} in ${laneLabel}`,
            tabLaneTarget(props.window, lane, firstTab.id as number, 'before'),
          )}
        {tabs.map((tab) => (
          <Fragment key={tab.id ?? tab.url}>
            {tabRow(tab)}
            {dropZone(
              `Drop after ${getTabLabel(tab)} in ${laneLabel}`,
              tabLaneTarget(props.window, lane, tab.id as number, 'after'),
            )}
          </Fragment>
        ))}
      </>
    );
  }

  function chromeGroup(item: Extract<ActiveWindowItem, { kind: 'group' }>) {
    const label = itemLabel(item, props.locale);
    const target = groupEndTarget(props.window, item.groupId);
    const accepts = Boolean(
      !props.disabled &&
        props.dragSource &&
        resolveActiveTabsDropRequest(props.dragSource, target),
    );

    return (
      <article
        className="tab-group"
        ref={(node) => props.onRegisterTarget(item.key, node)}
      >
        <header
          className={`drop-target${
            props.activeDropTargetKey === target.key ? ' is-active-drop-target' : ''
          }`}
          aria-label={`Drop into ${label}`}
          onDragEnter={(event) => {
            if (!accepts) return;
            event.preventDefault();
            event.stopPropagation();
            props.onActivateDropTarget(target.key);
          }}
          onDragOver={(event) => {
            if (!accepts) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDragLeave={(event) => {
            if (!accepts) return;
            event.stopPropagation();
            if (props.activeDropTargetKey === target.key) props.onActivateDropTarget(null);
          }}
          onDrop={(event) => {
            if (!accepts) return;
            event.stopPropagation();
            props.onDrop(event, target);
          }}
        >
          <div className="chrome-group-meta">
            <button
              type="button"
              className="drag-handle"
              draggable={!props.disabled}
              disabled={props.disabled}
              aria-label={t(props.locale, 'dragGroup', { label })}
              onDragStart={(event) =>
                props.onDragStart(event, {
                  kind: 'group',
                  groupId: item.groupId,
                  windowId: props.window.windowId,
                  incognito: props.window.incognito,
                })
              }
              onDragEnd={props.onDragEnd}
            >
              ⋮⋮
            </button>
            <span
              className={`chrome-group-color chrome-group-color--${item.color ?? 'grey'}`}
              aria-hidden="true"
            />
            <h4>{label}</h4>
            {item.collapsed !== null && (
              <span className="status-pill">
                {t(
                  props.locale,
                  item.collapsed ? 'chromeGroupCollapsed' : 'chromeGroupExpanded',
                )}
              </span>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${label} tabs`}
            onClick={() =>
              props.onCloseTabs(
                item.tabs
                  .map((tab) => tab.id)
                  .filter((id): id is number => typeof id === 'number'),
              )
            }
            disabled={props.disabled}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="active-tab-list">
          {tabLaneRows(item.tabs, { kind: 'group', groupId: item.groupId }, label)}
        </div>
      </article>
    );
  }

  const firstItem = props.window.items[0];

  return (
    <article
      className="active-window"
      ref={(node) => props.onRegisterTarget(props.window.key, node)}
    >
      <header className="active-window-header">
        <h3>{windowLabel}</h3>
        <span className="meta-pill">{props.window.visibleTabCount} open</span>
      </header>
      {showPinnedLane && (
        <section className="pinned-lane">
          <header className="pinned-lane-header">
            <h4>{t(props.locale, 'pinnedTabs')}</h4>
          </header>
          <div className="active-tab-list">
            {tabLaneRows(props.window.pinnedTabs, { kind: 'pinned' }, 'pinned tabs')}
            {dropZone(
              `Drop at end of pinned tabs in ${windowLabel}`,
              pinnedEndTarget(props.window),
            )}
          </div>
        </section>
      )}
      <div className="active-window-items">
        {firstItem &&
          dropZone(
            `Drop before ${itemLabel(firstItem, props.locale)}`,
            topLevelTarget(props.window, firstItem, 'before'),
          )}
        {props.window.items.map((item) => (
          <Fragment key={item.key}>
            {item.kind === 'tab' ? tabRow(item.tab) : chromeGroup(item)}
            {dropZone(
              `Drop after ${itemLabel(item, props.locale)}`,
              topLevelTarget(props.window, item, 'after'),
            )}
          </Fragment>
        ))}
        {dropZone(`Drop at end of ${windowLabel}`, windowEndTarget(props.window))}
      </div>
    </article>
  );
}
