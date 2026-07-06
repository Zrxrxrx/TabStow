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
  if (candidate.kind === 'image' && typeof candidate.value === 'string') {
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
        label: String(candidate.label ?? '').trim() || new URL(url).hostname.replace(/^www\./, ''),
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
    label: input.label?.trim() || new URL(url).hostname.replace(/^www\./, ''),
    icon: input.icon ?? null,
    createdAt: new Date().toISOString(),
  };
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
