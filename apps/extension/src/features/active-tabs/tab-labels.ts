import type { ActiveBrowserTab } from './types';

const LANDING_RULES = [
  { hostname: 'mail.google.com', rejectHashPrefixes: ['#inbox/', '#sent/', '#search/'] },
  { hostname: 'x.com', paths: ['/home'] },
  { hostname: 'www.linkedin.com', paths: ['/'] },
  { hostname: 'github.com', paths: ['/'] },
  { hostname: 'www.youtube.com', paths: ['/'] },
] as const;

export function getTabHostname(tab: Pick<ActiveBrowserTab, 'url'>): string {
  try {
    if (tab.url?.startsWith('file://')) return 'local-files';
    return new URL(tab.url ?? '').hostname;
  } catch {
    return '';
  }
}

export function friendlyDomain(domain: string): string {
  return domain.replace(/^www\./, '').replace(/\./g, ' ').trim();
}

function stripTitleNoise(title: string): string {
  return title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*\([\d,]+\+?\)\s*/g, ' ')
    .replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '')
    .replace(/\s+on X:\s*/, ': ')
    .replace(/\s*\/\s*X\s*$/, '')
    .trim();
}

function smartTitle(title: string, url: string | undefined): string {
  if (!url) return title;

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const titleIsUrl = !title || title === url || title.startsWith(parsed.hostname) || title.startsWith('http');

    if ((parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') && parts.length >= 2) {
      const [owner, repo, section, id] = parts;
      if (section === 'issues' && id) return `${owner}/${repo} Issue #${id}`;
      if (section === 'pull' && id) return `${owner}/${repo} PR #${id}`;
      if ((section === 'blob' || section === 'tree') && parts.length > 4) return `${owner}/${repo} - ${parts.slice(4).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }

    if ((parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com') && parsed.pathname.includes('/status/')) {
      const username = parts[0];
      return titleIsUrl && username ? `Post by @${username}` : title;
    }

    return title;
  } catch {
    return title;
  }
}

export function getTabLabel(tab: Pick<ActiveBrowserTab, 'title' | 'url'>): string {
  const title = smartTitle(stripTitleNoise(tab.title ?? ''), tab.url);
  if (title) return title;

  const hostname = getTabHostname(tab);
  return hostname ? friendlyDomain(hostname) : tab.url ?? 'Tab';
}

export function isLandingPage(url: string | undefined): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return LANDING_RULES.some((rule) => {
      if (parsed.hostname !== rule.hostname) return false;
      if ('rejectHashPrefixes' in rule) {
        return !rule.rejectHashPrefixes.some((prefix) => parsed.hash.includes(prefix));
      }
      return rule.paths.includes(parsed.pathname);
    });
  } catch {
    return false;
  }
}
