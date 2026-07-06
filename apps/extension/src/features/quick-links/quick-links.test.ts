import { describe, expect, it } from 'vitest';
import { createQuickLink, normalizeQuickLinks, reorderQuickLinks } from './quick-links';

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
});
