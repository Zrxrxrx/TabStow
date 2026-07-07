import { ChevronDown, ChevronUp, ImageUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
import {
  deleteQuickLinkIcon,
  resolveQuickLinkIconUrl,
  saveQuickLinkIcon,
} from '@/features/quick-links/quick-link-icons-cache';
import {
  createQuickLink,
  reorderQuickLinks,
  updateQuickLink,
  type QuickLink,
  type QuickLinkIcon,
} from '@/features/quick-links/quick-links';
import { getQuickLinks, saveQuickLinks } from '@/features/quick-links/quick-links-storage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { FormDialog } from './FormDialog';

type Props = {
  locale: Locale;
};

function iconFromValue(value: string): QuickLinkIcon {
  return value.trim() ? { kind: 'emoji', value: value.trim() } : { kind: 'site', value: null };
}

type OpenTabChoice = {
  key: string;
  tab: ActiveBrowserTab;
};

type QuickLinkDialogState =
  | { kind: 'add-url'; url: string; label: string; error: string | null; submitting: boolean }
  | { kind: 'edit'; linkId: string; label: string; iconValue: string; error: string | null; submitting: boolean }
  | {
      kind: 'open-tabs';
      choices: OpenTabChoice[];
      error: string | null;
      selectedKey: string;
      submittingKey: string | null;
    }
  | null;

function getImageIconToken(icon: QuickLinkIcon | null | undefined): string | null {
  return icon?.kind === 'image' ? icon.value : null;
}

function hostnameInitial(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').slice(0, 1).toUpperCase() || 'T';
  } catch {
    return 'T';
  }
}

function renderTextIcon(link: QuickLink) {
  if (link.icon?.kind === 'emoji') return link.icon.value;
  return hostnameInitial(link.url);
}

function QuickLinkImageIcon({ token, label }: { token: string; label: string }) {
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

  if (!src) return null;

  return <img alt="" aria-hidden="true" className="quick-link-image-icon" src={src} title={label} />;
}

export function QuickLinks({ locale }: Props) {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<QuickLinkDialogState>(null);
  const uploadInputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    void getQuickLinks().then(setLinks);
  }, []);

  async function persistLinks(nextLinks: QuickLink[]) {
    const previousImageTokens = new Set(links.map((link) => getImageIconToken(link.icon)).filter(Boolean));
    const saved = await saveQuickLinks(nextLinks);
    setLinks(saved);
    setErrorMessage(null);

    const nextImageTokens = new Set(saved.map((link) => getImageIconToken(link.icon)).filter(Boolean));
    for (const token of previousImageTokens) {
      if (token && !nextImageTokens.has(token)) {
        void deleteQuickLinkIcon(token).catch(() => undefined);
      }
    }

    return saved;
  }

  function openAddByUrlDialog() {
    setErrorMessage(null);
    setDialog({ kind: 'add-url', url: '', label: '', error: null, submitting: false });
  }

  async function submitAddByUrl() {
    if (!dialog || dialog.kind !== 'add-url') return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      await persistLinks([...links, createQuickLink({ url: dialog.url, label: dialog.label })]);
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
    setErrorMessage(null);
    const response = await sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' });
    if (!response.ok) {
      setErrorMessage(response.error.message);
      return;
    }

    const choices = response.data
      .filter((tab) => typeof tab.url === 'string' && tab.url.length > 0)
      .map((tab) => ({
        key: String(tab.id ?? tab.url ?? getTabLabel(tab)),
        tab,
      }));

    if (choices.length === 0) {
      setErrorMessage(t(locale, 'noOpenTabsForQuickLink'));
      return;
    }

    setDialog({ kind: 'open-tabs', choices, error: null, selectedKey: choices[0].key, submittingKey: null });
  }

  async function submitOpenTabChoice(choice: OpenTabChoice) {
    if (!dialog || dialog.kind !== 'open-tabs' || !choice.tab.url) return;
    setDialog({ ...dialog, error: null, submittingKey: choice.key });

    try {
      await persistLinks([...links, createQuickLink({ url: choice.tab.url, label: getTabLabel(choice.tab) })]);
      setDialog(null);
    } catch (error) {
      setDialog({
        ...dialog,
        error: error instanceof Error ? error.message : 'Quick link URL is invalid.',
        submittingKey: null,
      });
    }
  }

  async function submitSelectedOpenTab() {
    if (!dialog || dialog.kind !== 'open-tabs') return;
    const choice = dialog.choices.find((item) => item.key === dialog.selectedKey);
    if (!choice) return;
    await submitOpenTabChoice(choice);
  }

  async function remove(id: string) {
    await persistLinks(links.filter((link) => link.id !== id));
  }

  function openEditDialog(link: QuickLink) {
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
    if (!dialog || dialog.kind !== 'edit') return;
    setDialog({ ...dialog, error: null, submitting: true });

    try {
      const next = links.map((item) =>
        item.id === dialog.linkId
          ? updateQuickLink(item, { label: dialog.label, icon: iconFromValue(dialog.iconValue) })
          : item,
      );
      await persistLinks(next);
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
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('Quick link icon must be an image.');
      return;
    }

    let token: string | null = null;

    try {
      token = await saveQuickLinkIcon(file);
      await persistLinks(
        links.map((item) =>
          item.id === link.id ? updateQuickLink(item, { icon: { kind: 'image', value: token as string } }) : item,
        ),
      );
    } catch (error) {
      await deleteQuickLinkIcon(token);
      setErrorMessage(error instanceof Error ? error.message : 'Could not save quick link icon.');
    }
  }

  async function move(id: string, direction: -1 | 1) {
    const index = links.findIndex((link) => link.id === id);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= links.length) return;

    const orderedIds = links.map((link) => link.id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    await persistLinks(reorderQuickLinks(links, orderedIds));
  }

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
            aria-label={t(locale, 'addQuickLink')}
            onClick={openAddByUrlDialog}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={() => void openOpenTabsDialog()}>
            {t(locale, 'addOpenTab')}
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="empty-state utility-empty-state">{t(locale, 'noQuickLinks')}</div>
      ) : (
        <div className="quick-link-grid" data-od-id="quick-link-grid">
          {links.map((link, index) => (
            <div className="quick-link-card-shell" key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer" className="quick-link-card">
                {link.icon?.kind === 'image' ? (
                  <QuickLinkImageIcon token={link.icon.value} label={link.label} />
                ) : (
                  <span className="favicon tone-blue" aria-hidden="true">
                    {renderTextIcon(link)}
                  </span>
                )}
                <span className="quick-link-label">{link.label}</span>
              </a>
              <div className="quick-link-card-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'moveUp', { label: link.label })}
                  onClick={() => void move(link.id, -1)}
                  disabled={index === 0}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'moveDown', { label: link.label })}
                  onClick={() => void move(link.id, 1)}
                  disabled={index === links.length - 1}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'uploadQuickLinkIcon', { label: link.label })}
                  onClick={() => uploadInputRefs.current.get(link.id)?.click()}
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
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'editQuickLink', { label: link.label })}
                  onClick={() => openEditDialog(link)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(locale, 'removeQuickLink', { label: link.label })}
                  onClick={() => void remove(link.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
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
          submitting={dialog.submitting}
          title={t(locale, 'addQuickLink')}
        >
          <div className="field-stack">
            <label className="field-label">
              {t(locale, 'quickLinkUrl')}
              <input
                aria-label={t(locale, 'quickLinkUrl')}
                className="dialog-input"
                onChange={(event) => {
                  const nextUrl = event.currentTarget.value;
                  setDialog((current) => (current?.kind === 'add-url' ? { ...current, url: nextUrl } : current));
                }}
                type="url"
                value={dialog.url}
              />
            </label>
            <label className="field-label">
              {t(locale, 'quickLinkLabel')}
              <input
                aria-label={t(locale, 'quickLinkLabel')}
                className="dialog-input"
                onChange={(event) => {
                  const nextLabel = event.currentTarget.value;
                  setDialog((current) => (current?.kind === 'add-url' ? { ...current, label: nextLabel } : current));
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
          onCancel={() => setDialog(null)}
          onSubmit={submitSelectedOpenTab}
          submitLabel={t(locale, 'add')}
          submitting={dialog.submittingKey !== null}
          title={t(locale, 'chooseOpenTab')}
        >
          <div className="open-tab-chooser">
            {dialog.choices.map((choice) => {
              const tabLabel = getTabLabel(choice.tab);
              return (
                <button
                  type="button"
                  aria-label={tabLabel}
                  aria-pressed={dialog.selectedKey === choice.key}
                  className="open-tab-choice"
                  disabled={dialog.submittingKey !== null}
                  key={choice.key}
                  onClick={() => {
                    setDialog((current) =>
                      current?.kind === 'open-tabs' ? { ...current, selectedKey: choice.key } : current,
                    );
                    void submitOpenTabChoice(choice);
                  }}
                >
                  <span className="favicon tone-blue" aria-hidden="true">
                    {(tabLabel.match(/[A-Za-z0-9]/)?.[0] ?? 'T').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="tab-copy">
                    <span className="tab-title">{tabLabel}</span>
                    <span className="tab-url">{choice.tab.url ?? ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </FormDialog>
      ) : null}
    </section>
  );
}
