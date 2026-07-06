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

type Props = {
  locale: Locale;
};

function iconFromPrompt(value: string): QuickLinkIcon {
  return value.trim() ? { kind: 'emoji', value: value.trim() } : { kind: 'site', value: null };
}

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

  async function addByUrl() {
    const url = window.prompt('Quick link URL');
    if (!url) return;

    const label = window.prompt('Quick link label') ?? '';
    try {
      await persistLinks([...links, createQuickLink({ url, label })]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Quick link URL is invalid.');
    }
  }

  async function addFromOpenTabs() {
    const response = await sendExtensionMessage<AppResult<ActiveBrowserTab[]>>({ type: 'active-tabs:list' });
    if (!response.ok) return;

    const choices = response.data
      .filter((tab) => typeof tab.url === 'string' && tab.url.length > 0)
      .map((tab, index) => ({ index: index + 1, tab }));
    if (choices.length === 0) return;

    const menu = choices.map((choice) => `${choice.index}. ${getTabLabel(choice.tab)}`).join('\n');
    const selected = Number(window.prompt(`Choose an open tab:\n${menu}`));
    const tab = choices.find((choice) => choice.index === selected)?.tab;
    if (!tab?.url) return;

    try {
      await persistLinks([...links, createQuickLink({ url: tab.url, label: getTabLabel(tab) })]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Quick link URL is invalid.');
    }
  }

  async function remove(id: string) {
    await persistLinks(links.filter((link) => link.id !== id));
  }

  async function edit(link: QuickLink) {
    const label = window.prompt('Quick link label', link.label);
    if (label === null) return;
    const currentIcon = link.icon?.kind === 'emoji' ? link.icon.value : '';
    const iconValue = window.prompt('Quick link icon. Leave blank to use the site icon.', currentIcon);
    if (iconValue === null) return;

    const next = links.map((item) =>
      item.id === link.id ? updateQuickLink(item, { label, icon: iconFromPrompt(iconValue) }) : item,
    );
    await persistLinks(next);
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
          <p className="subtle">Custom web icons stay one click away at the top of the new tab page.</p>
        </div>
        <div className="header-actions" data-od-id="quick-link-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={t(locale, 'addQuickLink')}
            onClick={() => void addByUrl()}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={() => void addFromOpenTabs()}>
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
                  onClick={() => void edit(link)}
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
    </section>
  );
}
