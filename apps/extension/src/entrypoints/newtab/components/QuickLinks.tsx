import { ImageUp, Pencil, PencilLine, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { TabFavicon } from '@/components/TabFavicon';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import {
  deleteQuickLinkIcon,
  resolveQuickLinkIconUrl,
  saveQuickLinkIcon,
} from '@/features/quick-links/quick-link-icons-cache';
import {
  createQuickLink,
  previewQuickLinkUrl,
  type QuickLink,
  type QuickLinkIcon,
} from '@/features/quick-links/quick-links';
import { getQuickLinks } from '@/features/quick-links/quick-links-storage';
import {
  buildOpenTabChoices,
  type OpenTabChoice,
} from '@/features/tab-search/tab-search';
import { presentActiveTabContext } from '@/features/tab-search/tab-search-presentation';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type ExtensionMessage } from '@/lib/messages';
import { FormDialog } from './FormDialog';
import {
  readQuickLinksDragSource,
  resolveQuickLinksDrop,
  writeQuickLinksDragSource,
  type QuickLinksDragSource,
} from './quick-links-dnd';

type Props = {
  disabled: boolean;
  locale: Locale;
  refreshKey: number;
};

type QuickLinkWriteMessage = Extract<
  ExtensionMessage,
  { type: 'quick-links:add' | 'quick-links:update' | 'quick-links:remove' | 'quick-links:reorder' }
>;

function iconFromValue(value: string): QuickLinkIcon {
  return value.trim() ? { kind: 'emoji', value: value.trim() } : { kind: 'site', value: null };
}

type QuickLinkDialogState =
  | {
      kind: 'add-url';
      url: string;
      label: string;
      labelEdited: boolean;
      preview: { url: string; label: string; icon: QuickLinkIcon | null } | null;
      error: string | null;
      submitting: boolean;
    }
  | { kind: 'edit'; linkId: string; label: string; iconValue: string; error: string | null; submitting: boolean }
  | {
      kind: 'open-tabs';
      snapshot: ActiveTabsSnapshot;
      query: string;
      error: string | null;
      selectedKey: string;
      submittingKey: string | null;
    }
  | null;

function getImageIconToken(icon: QuickLinkIcon | null | undefined): string | null {
  return icon?.kind === 'image' ? icon.value : null;
}

function isImageIconToken(value: string | null): value is string {
  return Boolean(value);
}

function QuickLinkImageIcon({ token, link }: { token: string; link: QuickLink }) {
  const [src, setSrc] = useState<string | null>(null);
  const srcRef = useRef<string | null>(null);

  function replaceSrc(nextSrc: string | null) {
    if (srcRef.current?.startsWith('blob:')) URL.revokeObjectURL(srcRef.current);
    srcRef.current = nextSrc;
    setSrc(nextSrc);
  }

  useEffect(() => {
    let cancelled = false;

    void resolveQuickLinkIconUrl(token)
      .then((resolved) => {
        if (cancelled) {
          if (resolved?.startsWith('blob:')) URL.revokeObjectURL(resolved);
          return;
        }
        replaceSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) replaceSrc(null);
      });

    return () => {
      cancelled = true;
      if (srcRef.current?.startsWith('blob:')) URL.revokeObjectURL(srcRef.current);
      srcRef.current = null;
    };
  }, [token]);

  if (!src) return <QuickLinkSiteIcon link={link} />;

  return (
    <img
      alt=""
      aria-hidden="true"
      className="quick-link-image-icon"
      onError={() => replaceSrc(null)}
      src={src}
      title={link.label}
    />
  );
}

function QuickLinkSiteIcon({ link }: { link: QuickLink }) {
  return (
    <TabFavicon
      className="quick-link-site-icon"
      pageUrl={link.url}
      title={link.label}
    />
  );
}

export function QuickLinks({ disabled, locale, refreshKey }: Props) {
  const noMatchingOpenTabsId = useId();
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [linksLoaded, setLinksLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<QuickLinkDialogState>(null);
  const [editing, setEditing] = useState(false);
  const disabledRef = useRef(disabled);
  const openTabFilterRef = useRef<HTMLInputElement>(null);
  const uploadInputRefs = useRef(new Map<string, HTMLInputElement>());
  const dragSourceRef = useRef<QuickLinksDragSource | null>(null);
  const dropPendingRef = useRef(false);
  disabledRef.current = disabled;

  useEffect(() => {
    let cancelled = false;
    setLinksLoaded(false);
    void getQuickLinks().then((storedLinks) => {
      if (cancelled) return;
      setLinks(storedLinks);
      setLinksLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function persistLinks(message: QuickLinkWriteMessage) {
    if (disabledRef.current) return null;
    const currentLinks = await getQuickLinks();
    if (disabledRef.current) return null;
    const previousImageTokens = new Set(currentLinks.map((link) => getImageIconToken(link.icon)).filter(isImageIconToken));
    const response = await sendExtensionMessage<AppResult<QuickLink[]>>(message);
    if (!response.ok) throw new Error(response.error.message);
    const saved = response.data;
    if (disabledRef.current) return null;
    setLinks(saved);
    setErrorMessage(null);

    const nextImageTokens = new Set(saved.map((link) => getImageIconToken(link.icon)).filter(isImageIconToken));
    for (const token of previousImageTokens) {
      if (token && !nextImageTokens.has(token)) {
        void deleteQuickLinkIcon(token).catch(() => undefined);
      }
    }

    return saved;
  }

  function openAddByUrlDialog() {
    if (disabledRef.current) return;
    setErrorMessage(null);
    setDialog({ kind: 'add-url', url: '', label: '', labelEdited: false, preview: null, error: null, submitting: false });
  }

  function fetchAddByUrlPreview() {
    if (!dialog || dialog.kind !== 'add-url') return;

    try {
      const preview = previewQuickLinkUrl(dialog.url);
      setDialog({
        ...dialog,
        label: dialog.labelEdited ? dialog.label : preview.label,
        preview,
        error: null,
      });
    } catch (error) {
      setDialog({
        ...dialog,
        preview: null,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
      });
    }
  }

  async function submitAddByUrl() {
    if (!dialog || dialog.kind !== 'add-url' || disabledRef.current) return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      const preview = dialog.preview ?? previewQuickLinkUrl(dialog.url);
      const saved = await persistLinks({
        type: 'quick-links:add',
        link: createQuickLink({
          url: preview.url,
          label: dialog.labelEdited ? dialog.label : preview.label,
          icon: preview.icon,
        }),
      });
      if (!saved) {
        setDialog((current) => (current?.kind === 'add-url' ? { ...current, submitting: false } : current));
        return;
      }
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
        submitting: false,
      });
    }
  }

  async function openOpenTabsDialog() {
    if (disabledRef.current) return;
    setErrorMessage(null);
    const response = await sendExtensionMessage<AppResult<ActiveTabsSnapshot>>({
      type: 'active-tabs:snapshot',
    });
    if (!response.ok) {
      setErrorMessage(response.error.message);
      return;
    }

    const { choices } = buildOpenTabChoices(response.data, '');

    if (choices.length === 0) {
      setErrorMessage(t(locale, 'noOpenTabsForQuickLink'));
      return;
    }

    setDialog({
      kind: 'open-tabs',
      snapshot: response.data,
      query: '',
      error: null,
      selectedKey: choices[0].key,
      submittingKey: null,
    });
  }

  async function submitOpenTabChoice(choice: OpenTabChoice) {
    if (!choice.tab.url || disabledRef.current) return;
    const url = choice.tab.url;
    setDialog((current) =>
      current?.kind === 'open-tabs'
        ? { ...current, error: null, submittingKey: choice.key }
        : current,
    );

    try {
      const saved = await persistLinks({
        type: 'quick-links:add',
        link: createQuickLink({ url, label: choice.label }),
      });
      if (!saved) {
        setDialog((current) =>
          current?.kind === 'open-tabs' ? { ...current, submittingKey: null } : current,
        );
        return;
      }
      setDialog(null);
    } catch (error) {
      setDialog((current) =>
        current?.kind === 'open-tabs'
          ? {
              ...current,
              error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
              submittingKey: null,
            }
          : current,
      );
    }
  }

  async function submitSelectedOpenTab() {
    if (!dialog || dialog.kind !== 'open-tabs' || disabledRef.current) return;
    const choice = buildOpenTabChoices(dialog.snapshot, dialog.query).choices.find(
      (item) => item.key === dialog.selectedKey,
    );
    if (!choice) return;
    await submitOpenTabChoice(choice);
  }

  function updateOpenTabQuery(query: string) {
    setDialog((current) => {
      if (current?.kind !== 'open-tabs') return current;
      const { choices } = buildOpenTabChoices(current.snapshot, query);
      const selectedKey = choices.some((choice) => choice.key === current.selectedKey)
        ? current.selectedKey
        : choices[0]?.key ?? '';
      return { ...current, query, selectedKey };
    });
  }

  function selectOpenTabChoice(selectedKey: string) {
    setDialog((current) =>
      current?.kind === 'open-tabs' ? { ...current, selectedKey } : current,
    );
  }

  async function remove(id: string) {
    if (disabledRef.current) return;
    await persistLinks({ type: 'quick-links:remove', linkId: id });
  }

  function openEditDialog(link: QuickLink) {
    if (disabledRef.current) return;
    setErrorMessage(null);
    setDialog({
      kind: 'edit',
      linkId: link.id,
      label: link.label,
      iconValue: link.icon?.kind === 'emoji' ? link.icon.value : '',
      error: null,
      submitting: false,
    });
  }

  async function submitEdit() {
    if (!dialog || dialog.kind !== 'edit' || disabledRef.current) return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      const saved = await persistLinks({
        type: 'quick-links:update',
        linkId: dialog.linkId,
        patch: { label: dialog.label, icon: iconFromValue(dialog.iconValue) },
      });
      if (!saved) {
        setDialog((current) => (current?.kind === 'edit' ? { ...current, submitting: false } : current));
        return;
      }
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Could not update quick link.',
        submitting: false,
      });
    }
  }

  async function uploadIcon(link: QuickLink, file: File | undefined) {
    if (disabledRef.current) return;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Quick link icon must be an image.');
      return;
    }

    let token: string | null = null;

    try {
      token = await saveQuickLinkIcon(file);
      await persistLinks({
        type: 'quick-links:update',
        linkId: link.id,
        patch: { icon: { kind: 'image', value: token as string } },
      });
    } catch (error) {
      await deleteQuickLinkIcon(token);
      setErrorMessage(error instanceof Error ? error.message : 'Could not save quick link icon.');
    }
  }

  function startDrag(event: DragEvent<HTMLDivElement>, linkId: string) {
    if (!editing || disabledRef.current || dropPendingRef.current) {
      event.preventDefault();
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest('button, input')) {
      event.preventDefault();
      return;
    }
    const source = { linkId };
    dragSourceRef.current = source;
    writeQuickLinksDragSource(event.dataTransfer, source);
  }

  async function drop(event: DragEvent, beforeLinkId: string | null) {
    event.preventDefault();
    const source = readQuickLinksDragSource(event.dataTransfer) ?? dragSourceRef.current;
    const orderedIds = source
      ? resolveQuickLinksDrop(source, {
          beforeLinkId,
          orderedIds: links.map((link) => link.id),
        })
      : null;
    if (!orderedIds || dropPendingRef.current || disabledRef.current) return;

    dropPendingRef.current = true;
    try {
      await persistLinks({ type: 'quick-links:reorder', orderedIds });
    } catch (error) {
      setLinks(await getQuickLinks());
      setErrorMessage(error instanceof Error ? error.message : 'Could not reorder quick links.');
    } finally {
      dropPendingRef.current = false;
      dragSourceRef.current = null;
    }
  }

  async function reorderWithKeyboard(linkId: string, offset: -1 | 1) {
    if (!editing || disabledRef.current || dropPendingRef.current) return;
    const currentIndex = links.findIndex((link) => link.id === linkId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= links.length) return;
    const orderedIds = links.map((link) => link.id);
    [orderedIds[currentIndex], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[currentIndex]];
    dropPendingRef.current = true;
    try {
      await persistLinks({ type: 'quick-links:reorder', orderedIds });
    } catch (error) {
      setLinks(await getQuickLinks());
      setErrorMessage(error instanceof Error ? error.message : 'Could not reorder quick links.');
    } finally {
      dropPendingRef.current = false;
    }
  }

  const openTabChoices =
    dialog?.kind === 'open-tabs'
      ? buildOpenTabChoices(dialog.snapshot, dialog.query)
      : { choices: [], overflow: false };

  return (
    <section className="panel quick-links-panel" aria-labelledby="quick-links-title" data-od-id="quick-links-section">
      <div className="section-header">
        <div>
          <h2 id="quick-links-title" data-od-id="quick-links-title">
            {t(locale, 'quickLinks')}
          </h2>
          <p className="subtle">{t(locale, 'quickLinksSubtitle')}</p>
        </div>
        <div className="header-actions" data-od-id="quick-link-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={editing ? t(locale, 'showQuickLinksMode') : t(locale, 'editQuickLinksMode')}
            aria-pressed={editing}
            onClick={() => setEditing((value) => !value)}
            disabled={disabled || !linksLoaded}
          >
            <PencilLine size={16} aria-hidden="true" />
          </button>
          {editing ? (
            <>
              <button
                type="button"
                className="icon-button"
                aria-label={t(locale, 'addQuickLink')}
                onClick={openAddByUrlDialog}
                disabled={disabled}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void openOpenTabsDialog()}
                disabled={disabled}
              >
                {t(locale, 'addOpenTab')}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!linksLoaded ? null : links.length === 0 ? (
        <div className="empty-state utility-empty-state quick-links-empty-state">
          <div className="empty-state-copy">
            <strong>{t(locale, 'noQuickLinks')}</strong>
            <button
              className="secondary-button"
              disabled={disabled || !linksLoaded}
              onClick={openAddByUrlDialog}
              type="button"
            >
              {t(locale, 'addQuickLink')}
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-link-grid" data-od-id="quick-link-grid">
          {links.map((link) => (
            <div
              aria-label={editing ? t(locale, 'reorderQuickLink', { label: link.label }) : undefined}
              className="quick-link-card-shell"
              draggable={editing && !disabled}
              key={link.id}
              onDragEnd={() => { dragSourceRef.current = null; }}
              onDragOver={(event) => { if (editing) event.preventDefault(); }}
              onDragStart={(event) => startDrag(event, link.id)}
              onDrop={(event) => void drop(event, link.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (!event.altKey) return;
                if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  void reorderWithKeyboard(link.id, -1);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  void reorderWithKeyboard(link.id, 1);
                }
              }}
              tabIndex={editing ? 0 : undefined}
            >
              <a
                href={editing ? undefined : link.url}
                target="_blank"
                rel="noreferrer"
                className="quick-link-card"
              >
                {link.icon?.kind === 'image' ? (
                  <QuickLinkImageIcon token={link.icon.value} link={link} />
                ) : link.icon?.kind === 'emoji' ? (
                  <span className="favicon tone-blue" aria-hidden="true">
                    {link.icon.value}
                  </span>
                ) : (
                  <QuickLinkSiteIcon link={link} />
                )}
                <span className="quick-link-label">{link.label}</span>
              </a>
              {editing ? (
                <div className="quick-link-card-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t(locale, 'uploadQuickLinkIcon', { label: link.label })}
                    onClick={() => uploadInputRefs.current.get(link.id)?.click()}
                    disabled={disabled}
                  >
                    <ImageUp size={14} aria-hidden="true" />
                  </button>
                  <input
                    accept="image/*"
                    aria-label={t(locale, 'uploadQuickLinkIcon', { label: link.label })}
                    data-quick-link-upload-id={link.id}
                    hidden
                    ref={(node) => {
                      if (node) {
                        uploadInputRefs.current.set(link.id, node);
                        return;
                      }

                      uploadInputRefs.current.delete(link.id);
                    }}
                    onChange={(event) => {
                      void uploadIcon(link, event.target.files?.[0]);
                      event.target.value = '';
                    }}
                    type="file"
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t(locale, 'editQuickLink', { label: link.label })}
                    onClick={() => openEditDialog(link)}
                    disabled={disabled}
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t(locale, 'removeQuickLink', { label: link.label })}
                    onClick={() => void remove(link.id)}
                    disabled={disabled}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {editing ? (
            <div
              aria-label={t(locale, 'dropQuickLinkAtEnd')}
              className="quick-link-drop-end"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void drop(event, null)}
            />
          ) : null}
        </div>
      )}

      {errorMessage ? (
        <p className="status-message status-message--error utility-status" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {dialog?.kind === 'add-url' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={dialog.error}
          onCancel={() => setDialog(null)}
          onSubmit={submitAddByUrl}
          submitLabel={t(locale, 'add')}
          submitDisabled={disabled}
          submitting={dialog.submitting}
          title={t(locale, 'addQuickLink')}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'quickLinkUrl')}
              <input
                aria-label={t(locale, 'quickLinkUrl')}
                className="dialog-input"
                inputMode="url"
                onChange={(event) => {
                  const nextUrl = event.currentTarget.value;
                  setDialog((current) =>
                    current?.kind === 'add-url'
                      ? {
                          ...current,
                          url: nextUrl,
                          label: current.labelEdited ? current.label : '',
                          preview: null,
                        }
                      : current,
                  );
                }}
                type="text"
                value={dialog.url}
              />
            </label>
            <button
              type="button"
              className="secondary-button quick-link-fetch-button"
              onClick={fetchAddByUrlPreview}
            >
              {t(locale, 'fetchQuickLink')}
            </button>
            {dialog.preview ? (
              <div className="quick-link-preview" aria-label={t(locale, 'quickLinkPreview')}>
                <QuickLinkSiteIcon
                  link={{
                    id: 'preview',
                    url: dialog.preview.url,
                    label: dialog.label || dialog.preview.label,
                    icon: { kind: 'site', value: null },
                    createdAt: new Date().toISOString(),
                  }}
                />
                <span className="tab-copy">
                  <span className="tab-title">{dialog.label || dialog.preview.label}</span>
                  <span className="tab-url">{dialog.preview.url}</span>
                </span>
              </div>
            ) : null}
            <label className="field-label">
              {t(locale, 'quickLinkLabel')}
              <input
                aria-label={t(locale, 'quickLinkLabel')}
                className="dialog-input"
                onChange={(event) => {
                  const nextLabel = event.currentTarget.value;
                  setDialog((current) =>
                    current?.kind === 'add-url' ? { ...current, label: nextLabel, labelEdited: true } : current,
                  );
                }}
                type="text"
                value={dialog.label}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}

      {dialog?.kind === 'edit' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          description={t(locale, 'quickLinkIconHelp')}
          errorMessage={dialog.error}
          onCancel={() => setDialog(null)}
          onSubmit={submitEdit}
          submitLabel={t(locale, 'save')}
          submitDisabled={disabled}
          submitting={dialog.submitting}
          title={t(locale, 'editQuickLink', { label: dialog.label })}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'quickLinkLabel')}
              <input
                aria-label={t(locale, 'quickLinkLabel')}
                className="dialog-input"
                onChange={(event) => {
                  const nextLabel = event.currentTarget.value;
                  setDialog((current) => (current?.kind === 'edit' ? { ...current, label: nextLabel } : current));
                }}
                type="text"
                value={dialog.label}
              />
            </label>
            <label className="field-label">
              {t(locale, 'quickLinkIcon')}
              <input
                aria-label={t(locale, 'quickLinkIcon')}
                className="dialog-input"
                onChange={(event) => {
                  const nextIconValue = event.currentTarget.value;
                  setDialog((current) =>
                    current?.kind === 'edit' ? { ...current, iconValue: nextIconValue } : current,
                  );
                }}
                type="text"
                value={dialog.iconValue}
              />
            </label>
          </div>
        </FormDialog>
      ) : null}

      {dialog?.kind === 'open-tabs' ? (
        <FormDialog
          cancelLabel={t(locale, 'cancel')}
          errorMessage={dialog.error}
          initialFocusRef={openTabFilterRef}
          onCancel={() => setDialog(null)}
          onSubmit={submitSelectedOpenTab}
          submitAriaDescribedBy={
            openTabChoices.choices.length === 0 ? noMatchingOpenTabsId : undefined
          }
          submitLabel={t(locale, 'add')}
          submitDisabled={disabled || openTabChoices.choices.length === 0}
          submitting={dialog.submittingKey !== null}
          title={t(locale, 'chooseOpenTab')}
        >
          <label className="field-label">
            {t(locale, 'filterOpenTabs')}
            <input
              aria-label={t(locale, 'filterOpenTabs')}
              className="dialog-input"
              onChange={(event) => updateOpenTabQuery(event.currentTarget.value)}
              ref={openTabFilterRef}
              type="search"
              value={dialog.query}
            />
          </label>
          <div className="open-tab-chooser">
            {openTabChoices.choices.map((choice) => {
              const context = presentActiveTabContext(locale, choice.context);
              return (
                <button
                  type="button"
                  aria-label={`${choice.label}, ${context}`}
                  aria-pressed={dialog.selectedKey === choice.key}
                  className="open-tab-choice"
                  disabled={disabled || dialog.submittingKey !== null}
                  key={choice.key}
                  onClick={() => selectOpenTabChoice(choice.key)}
                >
                  <TabFavicon
                    className="favicon"
                    favIconUrl={choice.tab.favIconUrl}
                    pageUrl={choice.tab.url ?? ''}
                    title={choice.label}
                  />
                  <span className="tab-copy">
                    <span className="tab-title">{choice.label}</span>
                    <span className="tab-url">{choice.tab.url ?? ''}</span>
                    <span className="suggestion-context">{context}</span>
                  </span>
                </button>
              );
            })}
            {openTabChoices.choices.length === 0 ? (
              <p className="empty-copy" id={noMatchingOpenTabsId}>
                {t(locale, 'noMatchingOpenTabsForQuickLink')}
              </p>
            ) : null}
          </div>
          {openTabChoices.overflow ? (
            <p className="chooser-limit-hint">{t(locale, 'openTabChooserLimitHint')}</p>
          ) : null}
        </FormDialog>
      ) : null}
    </section>
  );
}
