import { History, RotateCcw, Trash2 } from 'lucide-react';
import {
  Fragment,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import type { TabSession } from '@tabstow/core';
import { TabFavicon } from '@/components/TabFavicon';
import { t, type Locale } from '@/features/i18n/i18n';
import { filterSavedSessions } from '@/features/tab-search/tab-search';
import {
  formatLocalizedDateTime,
  presentSessionTitle,
} from '@/features/tabs/session-presentation';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import {
  SAVED_TABS_DRAG_MIME,
  readSavedTabsDragSource,
  resolveSavedDrop,
  writeSavedTabsDragSource,
  type SavedTabsDragSource,
  type SavedTabsDropTarget,
} from './saved-tabs-dnd';

type Props = {
  busyAction: string | null;
  locale: Locale;
  query: string;
  sessions: TabSession[];
  onRunAction: <T>(
    actionId: string,
    action: () => Promise<AppResult<T>>,
    success: (data: T) => string,
    options?: { reloadOnFailure?: boolean },
  ) => Promise<void>;
  onOpenRecovery: () => void;
};

type SavedTab = TabSession['tabs'][number];

function isSafeSavedTabUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isModifiedClick(event: MouseEvent): boolean {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function matchesDragSource(
  serialized: SavedTabsDragSource,
  internal: SavedTabsDragSource,
): boolean {
  if (serialized.kind !== internal.kind || serialized.sessionId !== internal.sessionId) {
    return false;
  }

  return serialized.kind === 'session' ||
    (internal.kind === 'tab' && serialized.tabId === internal.tabId);
}

type SavedTabRowProps = {
  busy: boolean;
  dragDisabled: boolean;
  locale: Locale;
  sessionId: string;
  tab: SavedTab;
  onDelete: () => void;
  onDragEnd: (event: DragEvent) => void;
  onDragStart: (event: DragEvent, source: SavedTabsDragSource) => void;
  onOpen: (consume: boolean) => void;
};

function SavedTabRow({
  busy,
  dragDisabled,
  locale,
  onDelete,
  onDragEnd,
  onDragStart,
  onOpen,
  sessionId,
  tab,
}: SavedTabRowProps) {
  const suppressClickRef = useRef(false);
  const label = tab.title || tab.url;
  const content = (
    <>
      <TabFavicon className="saved-tab-favicon" pageUrl={tab.url} title={label} />
      <span className="tab-copy">
        <span className="tab-title">{label}</span>
        <span className="tab-url">{tab.url}</span>
      </span>
    </>
  );
  const safeUrl = isSafeSavedTabUrl(tab.url);
  const openControl = safeUrl ? (
    <button
      aria-label={t(locale, 'openSavedTab', { label })}
      className="saved-tab-open"
      disabled={busy}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onOpen(false);
      }}
      onClick={(event) => {
        if (suppressClickRef.current || event.button !== 0 || isModifiedClick(event)) return;
        event.preventDefault();
        onOpen(true);
      }}
      type="button"
    >
      {content}
    </button>
  ) : (
    <div className="saved-tab-open">{content}</div>
  );

  return (
    <div
      aria-disabled={dragDisabled}
      className="saved-tab-row"
      draggable={!dragDisabled}
      onDragEnd={(event) => {
        onDragEnd(event);
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }}
      onDragStart={(event) => onDragStart(event, { kind: 'tab', sessionId, tabId: tab.id })}
    >
      <span
        aria-disabled={dragDisabled}
        aria-label={t(locale, 'dragSavedTab', { label })}
        draggable={!dragDisabled}
        className="drag-surface-label"
      />
      {openControl}

      <button
        type="button"
        className="icon-button danger-button saved-tab-delete"
        aria-label={t(locale, 'removeSavedTab', { label })}
        disabled={busy}
        onClick={(event) => { event.stopPropagation(); onDelete(); }}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function StowedSessions({
  busyAction,
  locale,
  onOpenRecovery,
  onRunAction,
  query,
  sessions,
}: Props) {
  const [activeDropTargetKey, setActiveDropTargetKey] = useState<string | null>(null);
  const dragSourceRef = useRef<SavedTabsDragSource | null>(null);
  const dropPendingRef = useRef(false);
  const filteredSessions = useMemo(
    () => filterSavedSessions(sessions, query),
    [query, sessions],
  );
  const presentedSessions = useMemo(
    () => filteredSessions.map((session) => ({
      session,
      sessionTitle: presentSessionTitle(locale, session.title, session.tabs.length),
    })),
    [filteredSessions, locale],
  );
  const totalTabs = useMemo(
    () => filteredSessions.reduce((count, session) => count + session.tabs.length, 0),
    [filteredSessions],
  );
  const sessionCount = t(
    locale,
    filteredSessions.length === 1 ? 'savedSessionCount' : 'savedSessionsCount',
    { count: filteredSessions.length },
  );
  const tabCount = t(
    locale,
    totalTabs === 1 ? 'savedTabCount' : 'savedTabsCount',
    { count: totalTabs },
  );
  const sessionIds = filteredSessions.map(({ id }) => id);
  const searchActive = query.trim() !== '';
  const dragDisabled = searchActive || busyAction !== null;

  function startDrag(event: DragEvent, source: SavedTabsDragSource) {
    event.stopPropagation();
    const control = event.target instanceof HTMLElement
      ? event.target.closest('button, input, a')
      : null;
    if (control && !control.classList.contains('saved-tab-open')) {
      event.preventDefault();
      return;
    }
    if (dragDisabled || dropPendingRef.current) {
      event.preventDefault();
      return;
    }

    dragSourceRef.current = source;
    writeSavedTabsDragSource(event.dataTransfer, source);
  }

  function endDrag(event?: DragEvent) {
    event?.stopPropagation();
    dragSourceRef.current = null;
    setActiveDropTargetKey(null);
  }

  function resolveEventDrop(event: DragEvent, target: SavedTabsDropTarget) {
    if (dragDisabled || dropPendingRef.current) return null;
    const serializedSource = readSavedTabsDragSource(event.dataTransfer);
    const internalSource = dragSourceRef.current;
    if (
      !serializedSource ||
      !internalSource ||
      !matchesDragSource(serializedSource, internalSource)
    ) {
      return null;
    }

    return resolveSavedDrop(serializedSource, target, { searchActive });
  }

  function resolveProtectedDrag(target: SavedTabsDropTarget) {
    if (dragDisabled || dropPendingRef.current) return null;
    const internalSource = dragSourceRef.current;
    return internalSource
      ? resolveSavedDrop(internalSource, target, { searchActive })
      : null;
  }

  function activateDropTarget(
    event: DragEvent,
    key: string,
    target: SavedTabsDropTarget,
  ) {
    event.stopPropagation();
    if (
      !Array.from(event.dataTransfer.types).includes(SAVED_TABS_DRAG_MIME) ||
      !resolveProtectedDrag(target)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setActiveDropTargetKey(key);
  }

  async function dropOnTarget(event: DragEvent, target: SavedTabsDropTarget) {
    event.stopPropagation();
    const dropRequest = resolveEventDrop(event, target);
    if (!dropRequest) {
      endDrag();
      return;
    }

    event.preventDefault();
    dropPendingRef.current = true;
    setActiveDropTargetKey(null);
    try {
      if (dropRequest.kind === 'tab') {
        await onRunAction(
          `move-saved-tab-${dropRequest.request.tabId}`,
          () =>
            sendExtensionMessage<AppResult<{ moved: true }>>({
              type: 'sessions:move-tab',
              request: dropRequest.request,
            }),
          () => t(locale, 'movedSavedTab'),
          { reloadOnFailure: true },
        );
      } else {
        await onRunAction(
          'reorder-saved-sessions',
          () =>
            sendExtensionMessage<AppResult<TabSession[]>>({
              type: 'sessions:reorder',
              orderedIds: dropRequest.orderedIds,
            }),
          () => t(locale, 'reorderedSavedSessions'),
          { reloadOnFailure: true },
        );
      }
    } finally {
      dropPendingRef.current = false;
      endDrag();
    }
  }

  function renderDropTarget(
    key: string,
    label: string,
    target: SavedTabsDropTarget,
  ) {
    return (
      <div
        aria-label={label}
        className={`drop-insertion saved-drop-insertion${
          activeDropTargetKey === key ? ' is-active-drop-target' : ''
        }`}
        onDragEnter={(event) => activateDropTarget(event, key, target)}
        onDragOver={(event) => activateDropTarget(event, key, target)}
        onDragLeave={() =>
          setActiveDropTargetKey((activeKey) => (activeKey === key ? null : activeKey))
        }
        onDrop={(event) => void dropOnTarget(event, target)}
      />
    );
  }

  return (
    <section className="panel column saved-sessions" aria-labelledby="saved-title" data-od-id="saved-tabs-column">
      <header className="section-header">
        <div>
          <h2 id="saved-title" data-od-id="saved-tabs-title">
            {t(locale, 'savedForLater')}
          </h2>
          <p className="subtle">{t(locale, 'savedSessionsSubtitle')}</p>
        </div>
        <div className="header-actions saved-header-actions">
          {filteredSessions.length > 0 ? (
            <span
              className="meta-pill saved-count-summary"
              id="saved-count"
            >
              {t(locale, 'savedCount', {
                sessions: sessionCount,
                tabs: tabCount,
              })}
            </span>
          ) : null}
          <button
            className="secondary-button saved-history-action"
            onClick={onOpenRecovery}
            type="button"
          >
            <History aria-hidden="true" size={15} />
            {t(locale, 'history')}
          </button>
        </div>
      </header>

      <section className="session-list" aria-label={t(locale, 'savedSessions')}>
        {filteredSessions.length === 0 ? (
          searchActive ? (
            <div className="empty-state" role="status">
              {t(locale, 'noMatchingSavedSessions')}
            </div>
          ) : (
            <div
              className="empty-state empty-state--guidance"
              data-od-id="saved-empty-guidance"
              role="status"
            >
              <div className="empty-state-copy">
                <strong>{t(locale, 'noSavedSessions')}</strong>
                <span>{t(locale, 'savedSessionsEmptyGuidance')}</span>
              </div>
            </div>
          )
        ) : (
          <>
            {presentedSessions.map(({ session, sessionTitle }) => (
              <Fragment key={session.id}>
                {renderDropTarget(
                  `session:before:${session.id}`,
                  t(locale, 'dropSavedSessionBefore', { label: sessionTitle }),
                  {
                    kind: 'session',
                    beforeSessionId: session.id,
                    sessionIds,
                  },
                )}
                <article className="session-card">
                  <header
                    aria-disabled={dragDisabled}
                    aria-label={t(locale, 'dragSavedSession', { label: sessionTitle })}
                    draggable={!dragDisabled}
                    onDragEnd={endDrag}
                    onDragStart={(event) => startDrag(event, { kind: 'session', sessionId: session.id })}
                  >
                    <div className="session-heading">
                      <div className="tab-copy">
                        <span className="session-title">
                          {sessionTitle}
                        </span>
                        <span className="session-preview">
                          {t(locale, session.tabs.length === 1 ? 'savedTabCount' : 'savedTabsCount', { count: session.tabs.length })} · {formatLocalizedDateTime(locale, session.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={t(locale, 'restoreSavedSession', { label: sessionTitle })}
                        onClick={() =>
                          void onRunAction(
                            `restore-${session.id}`,
                            () =>
                              sendExtensionMessage<AppResult<{ restored: true; tabCount: number }>>({
                                type: 'sessions:restore',
                                sessionId: session.id,
                              }),
                            (result) =>
                              t(locale, 'restoredSavedSession', { count: result.tabCount }),
                          )
                        }
                        disabled={busyAction !== null}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                        {t(locale, 'restoreAll')}
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        aria-label={t(locale, 'removeSavedSession', { label: sessionTitle })}
                        onClick={() =>
                          void onRunAction(
                            `delete-${session.id}`,
                            () =>
                              sendExtensionMessage<AppResult<{ deleted: true }>>({
                                type: 'sessions:delete',
                                sessionId: session.id,
                              }),
                            () => t(locale, 'movedSavedSessionToHistory'),
                          )
                        }
                        disabled={busyAction !== null}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        {t(locale, 'moveToHistory')}
                      </button>
                    </div>
                  </header>
                  <div className="saved-tab-list">
                    {session.tabs.map((tab) => (
                      <Fragment key={tab.id}>
                        {renderDropTarget(
                          `tab:${session.id}:before:${tab.id}`,
                          t(locale, 'dropSavedTabBefore', { label: tab.title || tab.url }),
                          {
                            kind: 'tab',
                            destinationSessionId: session.id,
                            beforeTabId: tab.id,
                            tabIds: session.tabs.map(({ id }) => id),
                          },
                        )}
                        <SavedTabRow
                          busy={busyAction !== null}
                          dragDisabled={dragDisabled}
                          locale={locale}
                          sessionId={session.id}
                          tab={tab}
                          onDelete={() =>
                            void onRunAction(
                              `delete-tab-${tab.id}`,
                              () =>
                                sendExtensionMessage<AppResult<{ deleted: true }>>({
                                  type: 'sessions:delete-tab',
                                  sessionId: session.id,
                                  tabId: tab.id,
                                }),
                              () => t(locale, 'movedSavedTabToHistory'),
                            )
                          }
                          onDragEnd={endDrag}
                          onDragStart={startDrag}
                          onOpen={(consume) =>
                            void onRunAction(
                              `open-saved-tab-${tab.id}`,
                              () =>
                                sendExtensionMessage<AppResult<{ opened: true; consumed: boolean }>>({
                                  type: 'sessions:open-tab',
                                  sessionId: session.id,
                                  tabId: tab.id,
                                  consume,
                                }),
                              () =>
                                t(
                                  locale,
                                  consume ? 'movedSavedTabToHistory' : 'openedSavedTab',
                                ),
                            )
                          }
                        />
                      </Fragment>
                    ))}
                    {renderDropTarget(
                      `tab:${session.id}:end`,
                      t(locale, 'dropSavedTabAtEnd', { label: sessionTitle }),
                      {
                        kind: 'tab',
                        destinationSessionId: session.id,
                        beforeTabId: null,
                        tabIds: session.tabs.map(({ id }) => id),
                      },
                    )}
                  </div>
                </article>
              </Fragment>
            ))}
            {renderDropTarget(
              'session:end',
              t(locale, 'dropSavedSessionAtEnd'),
              { kind: 'session', beforeSessionId: null, sessionIds },
            )}
          </>
        )}
      </section>
    </section>
  );
}
