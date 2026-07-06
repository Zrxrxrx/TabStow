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

function normalizeUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function normalizeQuickLinks(input: unknown): QuickLink[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      const candidate = item as Partial<QuickLink>;
      const url = normalizeUrl(String(candidate.url ?? ''));
      const id = String(candidate.id ?? '');
      if (!id || !url) return null;
      return {
        id,
        url,
        label: String(candidate.label ?? '').trim() || new URL(url).hostname.replace(/^www\./, ''),
        icon: candidate.icon ?? null,
        createdAt: candidate.createdAt ?? new Date().toISOString(),
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
    label: input.label?.trim() || new URL(url).hostname.replace(/^www\./, ''),
    icon: input.icon ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function reorderQuickLinks(links: QuickLink[], orderedIds: string[]): QuickLink[] {
  const normalized = normalizeQuickLinks(links);
  const byId = new Map(normalized.map((link) => [link.id, link]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((link): link is QuickLink => Boolean(link));
  const orderedSet = new Set(ordered.map((link) => link.id));
  return [...ordered, ...normalized.filter((link) => !orderedSet.has(link.id))];
}
