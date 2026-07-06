import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getTabLabel } from '@/features/active-tabs/tab-labels';
import type { ActiveBrowserTab } from '@/features/active-tabs/types';
import { createQuickLink, type QuickLink } from '@/features/quick-links/quick-links';
import { getQuickLinks, saveQuickLinks } from '@/features/quick-links/quick-links-storage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';

export function QuickLinks() {
  const [links, setLinks] = useState<QuickLink[]>([]);

  useEffect(() => {
    void getQuickLinks().then(setLinks);
  }, []);

  async function addByUrl() {
    const url = window.prompt('Quick link URL');
    if (!url) return;

    const label = window.prompt('Quick link label') ?? '';
    setLinks(await saveQuickLinks([...links, createQuickLink({ url, label })]));
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
  }

  async function remove(id: string) {
    setLinks(await saveQuickLinks(links.filter((link) => link.id !== id)));
  }

  return (
    <section className="utility-panel" aria-labelledby="quick-links-title">
      <header>
        <h2 id="quick-links-title">Quick links</h2>
        <div className="utility-panel-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Add quick link"
            onClick={() => void addByUrl()}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="secondary-button" onClick={() => void addFromOpenTabs()}>
            Add open tab
          </button>
        </div>
      </header>

      {links.length === 0 ? (
        <div className="empty-state utility-empty-state">No quick links yet.</div>
      ) : (
        <div className="quick-link-grid">
          {links.map((link) => (
            <div className="quick-link" key={link.id}>
              <a href={link.url} target="_blank" rel="noreferrer" className="quick-link-anchor">
                <span>{link.label}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${link.label}`}
                onClick={() => void remove(link.id)}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
