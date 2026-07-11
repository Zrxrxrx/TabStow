import { Archive, Trash2, X } from 'lucide-react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab, ActiveTabWindow } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';

type Props = {
  disabled: boolean;
  displayIndex: number;
  locale: Locale;
  window: ActiveTabWindow;
  onCloseTabs: (tabIds: number[]) => void;
  onFocusTab: (tab: ActiveBrowserTab) => void;
  onRegisterTarget: (key: string, node: HTMLElement | null) => void;
  onStowTab: (tab: ActiveBrowserTab) => void;
};

export function ActiveWindowSection(props: Props) {
  const windowLabel = props.window.focused
    ? t(props.locale, 'currentWindow')
    : t(props.locale, 'windowNumber', { number: props.displayIndex + 1 });

  function tabRow(tab: ActiveBrowserTab) {
    const label = getTabLabel(tab);
    return (
      <div className="tab-row" key={tab.id ?? tab.url}>
        <button className="tab-open-button" type="button" onClick={() => props.onFocusTab(tab)}>
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

  return (
    <article
      className="active-window"
      ref={(node) => props.onRegisterTarget(props.window.key, node)}
    >
      <header className="active-window-header">
        <h3>{windowLabel}</h3>
        <span className="meta-pill">{props.window.visibleTabCount} open</span>
      </header>
      {props.window.pinnedTabs.length > 0 && (
        <section className="pinned-lane">
          <h4>{t(props.locale, 'pinnedTabs')}</h4>
          <div className="active-tab-list">{props.window.pinnedTabs.map(tabRow)}</div>
        </section>
      )}
      <div className="active-window-items">
        {props.window.items.map((item) =>
          item.kind === 'tab' ? (
            tabRow(item.tab)
          ) : (
            <article
              className="tab-group"
              key={item.key}
              ref={(node) => props.onRegisterTarget(item.key, node)}
            >
              <header>
                <div className="chrome-group-meta">
                  <span
                    className={`chrome-group-color chrome-group-color--${item.color ?? 'grey'}`}
                    aria-hidden="true"
                  />
                  <h4>
                    {item.title ??
                      t(props.locale, 'chromeGroupFallback', { id: item.groupId })}
                  </h4>
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
                  aria-label={`Close ${item.title ?? `Chrome group ${item.groupId}`} tabs`}
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
              <div className="active-tab-list">{item.tabs.map(tabRow)}</div>
            </article>
          ),
        )}
      </div>
    </article>
  );
}
