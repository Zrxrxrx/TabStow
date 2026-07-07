import { describe, expect, it } from 'vitest';
import {
  createQuickLink,
  mergeQuickLinksForPull,
  mergeQuickLinksForPush,
  normalizeQuickLinks,
  previewQuickLinkUrl,
  reorderQuickLinks,
  toSyncedQuickLinks,
  updateQuickLink,
} from './quick-links';

describe('quick links', () => {
  it('normalizes valid links and drops invalid links', () => {
    expect(
      normalizeQuickLinks([
        null,
        undefined,
        'bad',
        {
          id: 'a',
          url: 'https://example.com',
          label: 'Example',
          createdAt: 123,
          icon: { kind: 'emoji', value: 'sparkles' },
        },
        {
          id: 'b',
          url: 'https://site.example',
          label: 'Site',
          createdAt: '2026-07-06T00:00:00.000Z',
          icon: { kind: 'site', value: null },
        },
        {
          id: 'c',
          url: 'https://image.example',
          label: 'Image',
          createdAt: undefined,
          icon: { kind: 'emoji', value: 42 },
        },
        { id: '', url: 'bad' },
      ]),
    ).toEqual([
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'emoji', value: 'sparkles' },
        createdAt: expect.any(String),
      },
      {
        id: 'b',
        url: 'https://site.example/',
        label: 'Site',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'c',
        url: 'https://image.example/',
        label: 'Image',
        icon: null,
        createdAt: expect.any(String),
      },
    ]);
  });

  it('creates a quick link with deterministic id', () => {
    expect(createQuickLink({ url: 'https://openai.com', label: 'OpenAI' }, () => 'q-1')).toEqual({
      id: 'q-1',
      url: 'https://openai.com/',
      label: 'OpenAI',
      icon: null,
      createdAt: expect.any(String),
    });
  });

  it('creates an https quick link from a bare domain', () => {
    expect(createQuickLink({ url: 'google.com', label: 'Google' }, () => 'q-1')).toEqual({
      id: 'q-1',
      url: 'https://google.com/',
      label: 'Google',
      icon: null,
      createdAt: expect.any(String),
    });
  });

  it('creates an https quick link from a bare domain with a port and path', () => {
    expect(createQuickLink({ url: 'example.com:8080/path', label: 'Example' }, () => 'q-1')).toEqual({
      id: 'q-1',
      url: 'https://example.com:8080/path',
      label: 'Example',
      icon: null,
      createdAt: expect.any(String),
    });
  });

  it('rejects quick links outside http and https', () => {
    expect(() => createQuickLink({ url: 'javascript:alert(1)' })).toThrow('Quick link URL is invalid.');
    expect(() => createQuickLink({ url: 'data:text/html,hello' })).toThrow('Quick link URL is invalid.');
    expect(() => createQuickLink({ url: 'ftp://example.com/file.txt' })).toThrow('Quick link URL is invalid.');
  });

  it('updates label and icon metadata while preserving link identity', () => {
    const link = {
      id: 'a',
      url: 'https://a.example/',
      label: 'A',
      icon: null,
      createdAt: '2026-07-06T00:00:00.000Z',
    };

    expect(updateQuickLink(link, { label: 'Alpha', icon: { kind: 'emoji', value: '*' } })).toEqual({
      ...link,
      label: 'Alpha',
      icon: { kind: 'emoji', value: '*' },
    });
  });

  it('keeps only lightweight image icon tokens during normalization', () => {
    expect(
      normalizeQuickLinks([
        {
          id: 'a',
          url: 'https://example.com',
          label: 'Example',
          createdAt: '2026-07-06T00:00:00.000Z',
          icon: { kind: 'image', value: 'quick-link-icon:token-1' },
        },
        {
          id: 'b',
          url: 'https://example.com/docs',
          label: 'Docs',
          createdAt: '2026-07-06T00:00:00.000Z',
          icon: { kind: 'image', value: 'data:image/png;base64,abc' },
        },
        {
          id: 'c',
          url: 'https://example.com/blog',
          label: 'Blog',
          createdAt: '2026-07-06T00:00:00.000Z',
          icon: { kind: 'image', value: 'https://cdn.example.com/icon.png' },
        },
      ]),
    ).toEqual([
      {
        id: 'a',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:token-1' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'b',
        url: 'https://example.com/docs',
        label: 'Docs',
        icon: null,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'c',
        url: 'https://example.com/blog',
        label: 'Blog',
        icon: null,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('previews a pasted URL without fetching page metadata', () => {
    expect(previewQuickLinkUrl('example.com/docs')).toEqual({
      url: 'https://example.com/docs',
      label: 'example.com',
      icon: { kind: 'site', value: null },
    });
  });

  it('exports quick links for sync without uploaded image icons', () => {
    expect(
      toSyncedQuickLinks([
        {
          id: 'image-link',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'image', value: 'quick-link-icon:local-only' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'emoji-link',
          url: 'https://emoji.example/',
          label: 'Emoji',
          icon: { kind: 'emoji', value: '*' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        id: 'image-link',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'emoji-link',
        url: 'https://emoji.example/',
        label: 'Emoji',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('merges quick links for push with local precedence and local order first', () => {
    const local = [
      { id: 'shared', url: 'https://local.example/', label: 'Local', icon: null, createdAt: '2026-07-07T00:00:00.000Z' },
      {
        id: 'local-only',
        url: 'https://local-only.example/',
        label: 'Local only',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ];
    const remote = [
      {
        id: 'remote-only',
        url: 'https://remote-only.example/',
        label: 'Remote only',
        icon: { kind: 'site' as const, value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'shared',
        url: 'https://remote.example/',
        label: 'Remote',
        icon: { kind: 'site' as const, value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ];

    expect(mergeQuickLinksForPush(remote, local).map((link) => [link.id, link.label])).toEqual([
      ['shared', 'Local'],
      ['local-only', 'Local only'],
      ['remote-only', 'Remote only'],
    ]);
  });

  it('merges quick links for pull with remote precedence and preserves local uploaded icons', () => {
    const local = [
      {
        id: 'shared',
        url: 'https://old.example/',
        label: 'Old',
        icon: { kind: 'image' as const, value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
      {
        id: 'local-only',
        url: 'https://local-only.example/',
        label: 'Local only',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ];
    const remote = [
      {
        id: 'shared',
        url: 'https://remote.example/',
        label: 'Remote',
        icon: { kind: 'site' as const, value: null },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'remote-only',
        url: 'https://remote-only.example/',
        label: 'Remote only',
        icon: { kind: 'site' as const, value: null },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ];

    expect(mergeQuickLinksForPull(local, remote)).toEqual([
      {
        id: 'shared',
        url: 'https://remote.example/',
        label: 'Remote',
        icon: { kind: 'image', value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'remote-only',
        url: 'https://remote-only.example/',
        label: 'Remote only',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
      {
        id: 'local-only',
        url: 'https://local-only.example/',
        label: 'Local only',
        icon: null,
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ]);
  });

  it('reorders by id and appends missing links', () => {
    const links = [
      { id: 'a', url: 'https://a.example/', label: 'A', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'b', url: 'https://b.example/', label: 'B', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
    ];

    expect(reorderQuickLinks(links, ['b'])).toEqual([links[1], links[0]]);
  });

  it('keeps each link once when ordered ids repeat', () => {
    const links = [
      { id: 'a', url: 'https://a.example/', label: 'A', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'b', url: 'https://b.example/', label: 'B', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'c', url: 'https://c.example/', label: 'C', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
    ];

    expect(reorderQuickLinks(links, ['b', 'b', 'a'])).toEqual([links[1], links[0], links[2]]);
  });

  it('appends unspecified links in their existing relative order', () => {
    const links = [
      { id: 'a', url: 'https://a.example/', label: 'A', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'b', url: 'https://b.example/', label: 'B', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'c', url: 'https://c.example/', label: 'C', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
      { id: 'd', url: 'https://d.example/', label: 'D', icon: null, createdAt: '2026-07-06T00:00:00.000Z' },
    ];

    expect(reorderQuickLinks(links, ['c', 'a'])).toEqual([links[2], links[0], links[1], links[3]]);
  });
});
