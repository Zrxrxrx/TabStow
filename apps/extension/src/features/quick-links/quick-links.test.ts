import { describe, expect, it } from 'vitest';
import { createQuickLink, normalizeQuickLinks, reorderQuickLinks } from './quick-links';

describe('quick links', () => {
  it('normalizes valid links and drops invalid links', () => {
    expect(
      normalizeQuickLinks([
        { id: 'a', url: 'https://example.com', label: 'Example' },
        { id: '', url: 'bad' },
      ]),
    ).toEqual([
      { id: 'a', url: 'https://example.com/', label: 'Example', icon: null, createdAt: expect.any(String) },
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
});
