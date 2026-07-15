import { describe, expect, it } from 'vitest';
import {
  isIdentifiableHttpTab,
  isUnselectedUnprotectedHttpTab,
  validLastAccessed,
} from './tab-lifecycle-eligibility';

function tab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    active: false,
    audible: false,
    autoDiscardable: true,
    discarded: false,
    highlighted: false,
    incognito: false,
    index: 0,
    pinned: false,
    url: 'https://example.com/',
    windowId: 1,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('tab lifecycle eligibility', () => {
  it('identifies only HTTP(S) tabs with stable Chrome IDs', () => {
    expect(isIdentifiableHttpTab(tab({ id: 0, url: 'http://example.com/' }))).toBe(true);
    expect(isIdentifiableHttpTab(tab({ url: 'https://example.com/' }))).toBe(true);

    for (const candidate of [
      tab({ id: undefined }),
      tab({ id: -1 }),
      tab({ id: 1.5 }),
      tab({ url: undefined }),
      tab({ url: 'chrome://settings/' }),
      tab({ url: 'not a url' }),
    ]) {
      expect(isIdentifiableHttpTab(candidate)).toBe(false);
    }
  });

  it('excludes selected and lifecycle-protected tabs', () => {
    expect(isUnselectedUnprotectedHttpTab(tab({ autoDiscardable: undefined }))).toBe(true);

    for (const candidate of [
      tab({ active: true }),
      tab({ pinned: true }),
      tab({ audible: true }),
      tab({ incognito: true }),
      tab({ autoDiscardable: false }),
    ]) {
      expect(isUnselectedUnprotectedHttpTab(candidate)).toBe(false);
    }
  });

  it('accepts only finite last-access timestamps that are not in the future', () => {
    expect(validLastAccessed(0, 1_000)).toBe(0);
    expect(validLastAccessed(1_000, 1_000)).toBe(1_000);

    for (const value of [
      undefined,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      -1,
      1_001,
    ]) {
      expect(validLastAccessed(value, 1_000)).toBeUndefined();
    }
  });
});
