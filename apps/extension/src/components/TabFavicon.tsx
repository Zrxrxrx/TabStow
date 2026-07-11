import { useEffect, useMemo, useState } from 'react';

type Props = {
  className?: string;
  favIconUrl?: string;
  pageUrl: string;
  title: string;
};

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function chromeFaviconUrl(pageUrl: string): string | null {
  const safePageUrl = safeHttpUrl(pageUrl);
  if (
    !safePageUrl ||
    typeof chrome === 'undefined' ||
    typeof chrome.runtime?.getURL !== 'function'
  ) {
    return null;
  }

  return chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(safePageUrl)}&size=32`,
  );
}

export function TabFavicon({ className, favIconUrl, pageUrl, title }: Props) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const candidates = useMemo(
    () =>
      [safeHttpUrl(favIconUrl), chromeFaviconUrl(pageUrl)].filter(
        (url): url is string => Boolean(url),
      ),
    [favIconUrl, pageUrl],
  );

  useEffect(() => {
    setCandidateIndex(0);
  }, [favIconUrl, pageUrl]);

  const src = candidates[candidateIndex];
  if (!src) {
    return (
      <span
        className={`favicon tone-blue${className ? ` ${className}` : ''}`}
        aria-hidden="true"
      >
        {(title.match(/[A-Za-z0-9]/)?.[0] ?? 'T').toUpperCase()}
      </span>
    );
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={`tab-favicon${className ? ` ${className}` : ''}`}
      onError={() => setCandidateIndex((index) => index + 1)}
      src={src}
    />
  );
}
