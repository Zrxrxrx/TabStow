import { File } from 'lucide-react';
import { useMemo, useState } from 'react';

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

function safeLiveFaviconUrl(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    if (url.protocol !== 'data:') return null;
    return /^data:image\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:;[a-z0-9!#$&^_.+-]+(?:=[^;,]*)?)*,/i.test(
      value,
    )
      ? value
      : null;
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

export function NeutralFaviconFallback({ className }: { className?: string }) {
  return (
    <span
      className={`favicon favicon-fallback${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    >
      <File size={14} strokeWidth={1.75} />
    </span>
  );
}

export function TabFavicon({ className, favIconUrl, pageUrl }: Props) {
  const candidateIdentity = `${favIconUrl ?? ''}\u0000${pageUrl}`;
  const [candidateState, setCandidateState] = useState({
    identity: candidateIdentity,
    index: 0,
  });
  const candidates = useMemo(
    () =>
      [safeLiveFaviconUrl(favIconUrl), chromeFaviconUrl(pageUrl)].filter(
        (url): url is string => Boolean(url),
      ),
    [favIconUrl, pageUrl],
  );
  const candidateIndex =
    candidateState.identity === candidateIdentity ? candidateState.index : 0;
  const src = candidates[candidateIndex];
  if (!src) {
    return <NeutralFaviconFallback className={className} />;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={`tab-favicon${className ? ` ${className}` : ''}`}
      onError={() =>
        setCandidateState((state) => ({
          identity: candidateIdentity,
          index: state.identity === candidateIdentity ? state.index + 1 : 1,
        }))
      }
      src={src}
    />
  );
}
