import type { SyncedQuickLink } from '@tabstow/core';
import { isQuickLinkIconToken } from './quick-link-icons-cache';

export type QuickLinkIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string }
  | { kind: 'site'; value: null };

export type QuickLink = {
  id: string;
  url: string;
  label: string;
  icon: QuickLinkIcon | null;
  createdAt: string;
};

function hostnameLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '');
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const looksLikeBareDomain = /^[^/\s:@]+(?:\.[^/\s:@]+)+(?::\d+)?(?:[/?#].*)?$/u.test(trimmed);
  if (looksLikeBareDomain) {
    try {
      const url = new URL(`https://${trimmed}`);
      return url.hostname.includes('.') ? url.toString() : null;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCreatedAt(value: unknown): string {
  return typeof value === 'string' ? value : new Date().toISOString();
}

function normalizeIcon(value: unknown): QuickLinkIcon | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<QuickLinkIcon> & { kind?: unknown; value?: unknown };
  if (candidate.kind === 'site' && candidate.value === null) return { kind: 'site', value: null };
  if (candidate.kind === 'emoji' && typeof candidate.value === 'string') {
    return { kind: 'emoji', value: candidate.value };
  }
  if (candidate.kind === 'image' && isQuickLinkIconToken(candidate.value)) {
    return { kind: 'image', value: candidate.value };
  }
  return null;
}

export function normalizeQuickLinks(input: unknown): QuickLink[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const candidate = item as Partial<QuickLink>;
      const url = normalizeUrl(String(candidate.url ?? ''));
      const id = String(candidate.id ?? '');
      if (!id || !url) return null;
      return {
        id,
        url,
        label: String(candidate.label ?? '').trim() || hostnameLabel(url),
        icon: normalizeIcon(candidate.icon),
        createdAt: normalizeCreatedAt(candidate.createdAt),
      };
    })
    .filter((item): item is QuickLink => Boolean(item));
}

export function createQuickLink(
  input: { url: string; label?: string; icon?: QuickLinkIcon | null },
  createId: () => string = () => crypto.randomUUID(),
): QuickLink {
  const url = normalizeUrl(input.url);
  if (!url) throw new Error('Quick link URL is invalid.');
  return {
    id: createId(),
    url,
    label: input.label?.trim() || hostnameLabel(url),
    icon: input.icon ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function previewQuickLinkUrl(input: string): Pick<QuickLink, 'url' | 'label' | 'icon'> {
  const url = normalizeUrl(input);
  if (!url) throw new Error('Quick link URL is invalid.');
  return {
    url,
    label: hostnameLabel(url),
    icon: { kind: 'site', value: null },
  };
}

export function toSyncedQuickLinks(links: QuickLink[]): SyncedQuickLink[] {
  return normalizeQuickLinks(links).map((link) => ({
    id: link.id,
    url: link.url,
    label: link.label,
    icon: link.icon?.kind === 'emoji' ? link.icon : { kind: 'site', value: null },
    createdAt: link.createdAt,
  }));
}

export function fromSyncedQuickLinks(links: SyncedQuickLink[]): QuickLink[] {
  return normalizeQuickLinks(
    links.map((link) => ({
      ...link,
      icon: link.icon?.kind === 'emoji' ? link.icon : { kind: 'site', value: null },
    })),
  );
}

function appendMissingById(primary: QuickLink[], secondary: QuickLink[]): QuickLink[] {
  const seen = new Set(primary.map((link) => link.id));
  return [...primary, ...secondary.filter((link) => !seen.has(link.id))];
}

export function mergeQuickLinksForPush(
  remoteLinks: SyncedQuickLink[],
  localLinks: QuickLink[],
): QuickLink[] {
  return appendMissingById(normalizeQuickLinks(localLinks), fromSyncedQuickLinks(remoteLinks));
}

export function mergeQuickLinksForPull(
  localLinks: QuickLink[],
  remoteLinks: SyncedQuickLink[],
): QuickLink[] {
  const localById = new Map(normalizeQuickLinks(localLinks).map((link) => [link.id, link]));
  const remoteNormalized = fromSyncedQuickLinks(remoteLinks).map((remoteLink) => {
    const localLink = localById.get(remoteLink.id);
    if (localLink?.icon?.kind === 'image' && remoteLink.icon?.kind !== 'emoji') {
      return { ...remoteLink, icon: localLink.icon };
    }
    return remoteLink;
  });
  return appendMissingById(remoteNormalized, normalizeQuickLinks(localLinks));
}

export function updateQuickLink(
  link: QuickLink,
  patch: { label?: string; icon?: QuickLinkIcon | null },
): QuickLink {
  const [normalized] = normalizeQuickLinks([
    {
      ...link,
      label: patch.label ?? link.label,
      icon: patch.icon === undefined ? link.icon : patch.icon,
    },
  ]);
  if (!normalized) throw new Error('Quick link URL is invalid.');
  return normalized;
}

export function reorderQuickLinks(links: QuickLink[], orderedIds: string[]): QuickLink[] {
  const normalized = normalizeQuickLinks(links);
  const byId = new Map(normalized.map((link) => [link.id, link]));
  const seen = new Set<string>();
  const ordered = orderedIds.reduce<QuickLink[]>((acc, id) => {
    if (seen.has(id)) return acc;
    const link = byId.get(id);
    if (!link) return acc;
    seen.add(id);
    acc.push(link);
    return acc;
  }, []);
  return [...ordered, ...normalized.filter((link) => !seen.has(link.id))];
}
