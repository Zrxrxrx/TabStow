export const QUICK_LINKS_DRAG_MIME = 'application/x-tabstow-quick-link';

export type QuickLinksDragSource = { linkId: string };
export type QuickLinksDropTarget = { beforeLinkId: string | null; orderedIds: string[] };

export function writeQuickLinksDragSource(
  dataTransfer: DataTransfer,
  source: QuickLinksDragSource,
) {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(QUICK_LINKS_DRAG_MIME, JSON.stringify(source));
}

export function readQuickLinksDragSource(dataTransfer: DataTransfer): QuickLinksDragSource | null {
  try {
    const value = JSON.parse(dataTransfer.getData(QUICK_LINKS_DRAG_MIME)) as unknown;
    if (!value || typeof value !== 'object') return null;
    const linkId = (value as { linkId?: unknown }).linkId;
    return typeof linkId === 'string' && linkId.length > 0 ? { linkId } : null;
  } catch {
    return null;
  }
}

export function resolveQuickLinksDrop(
  source: QuickLinksDragSource,
  target: QuickLinksDropTarget,
): string[] | null {
  const uniqueIds = new Set(target.orderedIds);
  if (uniqueIds.size !== target.orderedIds.length || !uniqueIds.has(source.linkId)) return null;
  if (target.beforeLinkId !== null && !uniqueIds.has(target.beforeLinkId)) return null;
  if (target.beforeLinkId === source.linkId) return null;

  const orderedIds = target.orderedIds.filter((id) => id !== source.linkId);
  const destinationIndex = target.beforeLinkId === null
    ? orderedIds.length
    : orderedIds.indexOf(target.beforeLinkId);
  if (destinationIndex < 0) return null;
  orderedIds.splice(destinationIndex, 0, source.linkId);

  return orderedIds.every((id, index) => id === target.orderedIds[index]) ? null : orderedIds;
}
