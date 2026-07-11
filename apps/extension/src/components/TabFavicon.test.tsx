import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabFavicon } from './TabFavicon';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const getURL = vi.fn((path: string) => `chrome-extension://tabstow-test${path}`);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { getURL } },
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('TabFavicon', () => {
  it.each([
    'http://example.com/favicon.ico',
    'https://example.com/favicon.ico',
    'data:image/png;base64,iVBORw0KGgo=',
    'DATA:IMAGE/PNG;BASE64,iVBORw0KGgo=',
  ])('accepts the safe live favicon source %s', async (favIconUrl) => {
    await renderFavicon({
      favIconUrl,
      pageUrl: '',
      title: 'Allowed',
    });

    expect(getImage().getAttribute('src')).toBe(favIconUrl);
  });

  it.each([
    'javascript:alert(1)',
    'blob:https://example.com/favicon-id',
    'data:text/html,<script>alert(1)</script>',
    'data:application/javascript,alert(1)',
    'data:image/png',
    'file:///tmp/favicon.ico',
    'chrome-extension://other-extension/favicon.ico',
  ])('rejects the unsafe live favicon source %s', async (favIconUrl) => {
    await renderFavicon({
      favIconUrl,
      pageUrl: '',
      title: 'Rejected',
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('R');
  });

  it('falls back from the supplied favicon to Chrome and then the title initial', async () => {
    await renderFavicon({
      favIconUrl: 'https://example.com/favicon.ico',
      pageUrl: 'https://example.com/a',
      title: 'Example',
    });

    expect(getImage().getAttribute('src')).toBe('https://example.com/favicon.ico');

    await failImage();

    expect(getImage().getAttribute('src')).toBe(
      'chrome-extension://tabstow-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fa&size=32',
    );

    await failImage();

    expect(container.textContent).toBe('E');
    expect(container.querySelector('img')).toBeNull();
  });

  it('restarts the candidate cascade when its URLs change', async () => {
    await renderFavicon({
      favIconUrl: 'https://old.example/favicon.ico',
      pageUrl: 'https://old.example/page',
      title: 'Old',
    });
    await failImage();
    await failImage();

    await renderFavicon({
      favIconUrl: 'https://new.example/favicon.ico',
      pageUrl: 'https://new.example/page',
      title: 'New',
    });

    expect(getImage().getAttribute('src')).toBe('https://new.example/favicon.ico');
  });
});

async function renderFavicon(props: {
  favIconUrl?: string;
  pageUrl: string;
  title: string;
}) {
  await act(async () => {
    root.render(<TabFavicon {...props} />);
  });
}

async function failImage() {
  await act(async () => {
    getImage().dispatchEvent(new Event('error', { bubbles: true }));
  });
}

function getImage(): HTMLImageElement {
  const image = container.querySelector<HTMLImageElement>('img');
  if (!image) throw new Error('Missing favicon image');
  return image;
}
