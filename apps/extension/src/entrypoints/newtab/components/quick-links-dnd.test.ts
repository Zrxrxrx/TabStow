import { describe, expect, it } from 'vitest';
import { resolveQuickLinksDrop } from './quick-links-dnd';

describe('quick links drag resolution', () => {
  it('moves a stable link before another link or to the end', () => {
    expect(resolveQuickLinksDrop({ linkId: 'c' }, { beforeLinkId: 'a', orderedIds: ['a', 'b', 'c'] })).toEqual(['c', 'a', 'b']);
    expect(resolveQuickLinksDrop({ linkId: 'a' }, { beforeLinkId: null, orderedIds: ['a', 'b', 'c'] })).toEqual(['b', 'c', 'a']);
  });

  it('rejects stale, duplicate, and no-op destinations', () => {
    expect(resolveQuickLinksDrop({ linkId: 'missing' }, { beforeLinkId: 'a', orderedIds: ['a', 'b'] })).toBeNull();
    expect(resolveQuickLinksDrop({ linkId: 'a' }, { beforeLinkId: 'a', orderedIds: ['a', 'b'] })).toBeNull();
    expect(resolveQuickLinksDrop({ linkId: 'a' }, { beforeLinkId: 'b', orderedIds: ['a', 'a', 'b'] })).toBeNull();
  });
});
