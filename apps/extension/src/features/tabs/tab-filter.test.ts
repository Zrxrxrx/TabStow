import { describe, expect, it } from 'vitest';
import type { ExtensionSettings } from '@tabstow/core';
import {
  isBlockedTabUrl,
  isStowableTab,
  shouldCloseSavedTab,
  type StowableBrowserTab,
} from './tab-filter';

const settings: ExtensionSettings = {
  deviceId: 'device-1',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
};

function tab(partial: Partial<StowableBrowserTab>): StowableBrowserTab {
  return {
    id: 1,
    windowId: 1,
    url: 'https://example.com/',
    title: 'Example',
    pinned: false,
    active: false,
    ...partial,
  };
}

describe('tab filtering', () => {
  it('blocks browser and extension URLs', () => {
    expect(isBlockedTabUrl('chrome://settings')).toBe(true);
    expect(isBlockedTabUrl('edge://settings')).toBe(true);
    expect(isBlockedTabUrl('about:blank')).toBe(true);
    expect(isBlockedTabUrl('chrome-extension://abc/newtab.html')).toBe(true);
    expect(isBlockedTabUrl('https://example.com/')).toBe(false);
  });

  it('skips pinned tabs unless includePinnedTabs is enabled', () => {
    expect(isStowableTab(tab({ pinned: true }), settings)).toBe(false);
    expect(isStowableTab(tab({ pinned: true }), { ...settings, includePinnedTabs: true })).toBe(true);
  });

  it('closes pinned saved tabs only when closePinnedTabs is enabled', () => {
    expect(shouldCloseSavedTab(tab({ pinned: true }), { ...settings, includePinnedTabs: true })).toBe(false);
    expect(
      shouldCloseSavedTab(tab({ pinned: true }), {
        ...settings,
        includePinnedTabs: true,
        closePinnedTabs: true,
      }),
    ).toBe(true);
  });
});
