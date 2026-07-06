import { ChevronDown, ChevronUp, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { t, type Locale } from '@/features/i18n/i18n';
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

export function QuickLinks({ locale }: Props) {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    void getQuickLinks().then(setLinks);
  }, []);

  async function addByUrl() {
    const url = window.prompt('Quick link URL');
    if (!url) return;

    const label = window.prompt('Quick link label') ?? '';
    try {
      setLinks(await saveQuickLinks([...links, createQuickLink({ url, label })]));
      setErrorMessage(null);
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

    setLinks(
      await saveQuickLinks([...links, createQuickLink({ url: tab.url, label: getTabLabel(tab) })]),
    );
    setErrorMessage(null);
  }

  async function remove(id: string) {
    setLinks(await saveQuickLinks(links.filter((link) => link.id !== id)));
    setErrorMessage(null);
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
    setLinks(await saveQuickLinks(next));
    setErrorMessage(null);
  }

  async function move(id: string, direction: -1 | 1) {
    const index = links.findIndex((link) => link.id === id);
    const nextIndex = index + direction;
    if (index === -1 || nextIndex < 0 || nextIndex >= links.length) return;

    const orderedIds = links.map((link) => link.id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    setLinks(await saveQuickLinks(reorderQuickLinks(links, orderedIds)));
    setErrorMessage(null);
  }

  return (
    <section className="utility-panel" aria-labelledby="quick-links-title">
      <header>
        <h2 id="quick-links-title">{t(locale, 'quickLinks')}</h2>
        <div className="utility-panel-actions">
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
      </header>

      {links.length === 0 ? (
        <div className="empty-state utility-empty-state">{t(locale, 'noQuickLinks')}</div>
      ) : (
        <div className="quick-link-grid">
          {links.map((link, index) => (
            <div className="quick-link" key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer" className="quick-link-anchor">
                {link.icon?.kind === 'emoji' ? (
                  <span aria-hidden="true">{link.icon.value}</span>
                ) : null}
                <span>{link.label}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
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
