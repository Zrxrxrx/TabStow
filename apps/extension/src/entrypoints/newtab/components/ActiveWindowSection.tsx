import { Archive, MoonStar, Trash2, Volume2, X } from 'lucide-react';
import { Fragment, useId, useRef, type DragEvent } from 'react';
import { TabFavicon } from '@/components/TabFavicon';
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
  dragDisabled: boolean;
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
  onSleepTabs: (tabIds: number[]) => void;
  onStowTab: (tab: ActiveBrowserTab) => void;
  sleepEligibleTabIds: ReadonlySet<number>;
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
  const suppressClickRef = useRef(false);
  const sleepUnavailableId = useId();
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
        disabled={props.dragDisabled}
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
    const sleepEligible = typeof tab.id === 'number' && props.sleepEligibleTabIds.has(tab.id);
    const source: ActiveTabsDragSource = {
      kind: 'tab',
      tabId: tab.id as number,
      windowId: props.window.windowId,
      pinned: Boolean(tab.pinned),
      incognito: props.window.incognito,
    };

    return (
      <div
        aria-disabled={props.dragDisabled}
        className={`tab-row${tab.discarded === true ? ' sleeping' : ''}${tab.audible === true ? ' audible' : ''}`}
        draggable={!props.dragDisabled}
        onDragEnd={(event) => {
          props.onDragEnd(event);
          suppressClickRef.current = true;
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }}
        onDragStart={(event) => props.onDragStart(event, source)}
      >
        <span
          aria-disabled={props.dragDisabled}
          aria-label={t(props.locale, 'dragTab', { label })}
          className="drag-surface-label"
          draggable={!props.dragDisabled}
        />
        <button
          className="tab-open-button"
          disabled={props.disabled}
          onClick={() => {
            if (suppressClickRef.current || props.disabled) return;
            props.onFocusTab(tab);
          }}
          type="button"
        >
          <TabFavicon
            className="active-tab-favicon"
            favIconUrl={tab.favIconUrl}
            pageUrl={tab.url ?? ''}
            title={label}
          />
          <span className="tab-copy">
            <span className="tab-title">{label}</span>
            <span className="tab-url">{tab.url ?? ''}</span>
            {tab.audible === true ? <span className="state-tag"><Volume2 aria-hidden="true" size={11} /> {t(props.locale, 'audible')}</span> : null}
            {tab.discarded === true ? <span className="state-tag sleep">{t(props.locale, 'sleeping')}</span> : null}
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
            aria-label={t(props.locale, 'sleepTab', { label })}
            aria-describedby={sleepEligible ? undefined : sleepUnavailableId}
            className="icon-button"
            disabled={props.disabled || !sleepEligible}
            onClick={() => {
              if (sleepEligible && typeof tab.id === 'number') props.onSleepTabs([tab.id]);
            }}
            title={sleepEligible ? undefined : t(props.locale, 'sleepProtectedReason')}
            type="button"
          >
            <MoonStar aria-hidden="true" size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t(props.locale, 'closeTab', { label })}
            onClick={() => { if (typeof tab.id === 'number') props.onCloseTabs([tab.id]); }}
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
            t(props.locale, 'dropBeforeIn', { label: getTabLabel(firstTab), lane: laneLabel }),
            tabLaneTarget(props.window, lane, firstTab.id as number, 'before'),
          )}
        {tabs.map((tab) => (
          <Fragment key={tab.id ?? tab.url}>
            {tabRow(tab)}
            {dropZone(
              t(props.locale, 'dropAfterIn', { label: getTabLabel(tab), lane: laneLabel }),
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
      !props.dragDisabled &&
        props.dragSource &&
        resolveActiveTabsDropRequest(props.dragSource, target),
    );

    return (
      <article
        className="tab-group"
        ref={(node) => props.onRegisterTarget(item.key, node)}
      >
        <header
          aria-disabled={props.dragDisabled}
          aria-label={t(props.locale, 'dragGroup', { label })}
          className={`drop-target${
            props.activeDropTargetKey === target.key ? ' is-active-drop-target' : ''
          }`}
          draggable={!props.dragDisabled}
          onDragStart={(event) =>
            props.onDragStart(event, {
              kind: 'group',
              groupId: item.groupId,
              windowId: props.window.windowId,
              incognito: props.window.incognito,
            })
          }
          onDragEnd={props.onDragEnd}
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
          <span
            aria-label={t(props.locale, 'dropInto', { label })}
            className={`group-drop-label${props.activeDropTargetKey === target.key ? ' is-active-drop-target' : ''}`}
          />
          <div className="chrome-group-meta">
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
            aria-label={t(props.locale, 'closeGroupTabs', { label })}
            onClick={(event) => {
              event.stopPropagation();
              props.onCloseTabs(
                item.tabs
                  .map((tab) => tab.id)
                  .filter((id): id is number => typeof id === 'number'),
              );
            }}
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
        <span className="meta-pill">{t(props.locale, 'openCount', { count: props.window.visibleTabCount })}</span>
      </header>
      <span className="visually-hidden" id={sleepUnavailableId}>
        {t(props.locale, 'sleepProtectedReason')}
      </span>
      {showPinnedLane && (
        <section className="pinned-lane">
          <header className="pinned-lane-header">
            <h4>{t(props.locale, 'pinnedTabs')}</h4>
          </header>
          <div className="active-tab-list">
            {tabLaneRows(props.window.pinnedTabs, { kind: 'pinned' }, t(props.locale, 'pinnedTabsDropLabel'))}
            {dropZone(
              t(props.locale, 'dropAtEndIn', { label: t(props.locale, 'pinnedTabsDropLabel'), container: windowLabel }),
              pinnedEndTarget(props.window),
            )}
          </div>
        </section>
      )}
      <div className="active-window-items">
        {firstItem &&
          dropZone(
            t(props.locale, 'dropBefore', { label: itemLabel(firstItem, props.locale) }),
            topLevelTarget(props.window, firstItem, 'before'),
          )}
        {props.window.items.map((item) => (
          <Fragment key={item.key}>
            {item.kind === 'tab' ? tabRow(item.tab) : chromeGroup(item)}
            {dropZone(
              t(props.locale, 'dropAfter', { label: itemLabel(item, props.locale) }),
              topLevelTarget(props.window, item, 'after'),
            )}
          </Fragment>
        ))}
        {dropZone(t(props.locale, 'dropAtEnd', { label: windowLabel }), windowEndTarget(props.window))}
      </div>
    </article>
  );
}
