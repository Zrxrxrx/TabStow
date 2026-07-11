export function subscribeToActiveTabsChanges(onChange: () => void): () => void {
  if (typeof chrome === 'undefined') return () => undefined;

  const tabs = chrome.tabs;
  const groups = chrome.tabGroups;
  const windows = chrome.windows;

  tabs?.onCreated?.addListener(onChange);
  tabs?.onUpdated?.addListener(onChange);
  tabs?.onRemoved?.addListener(onChange);
  tabs?.onMoved?.addListener(onChange);
  tabs?.onAttached?.addListener(onChange);
  tabs?.onDetached?.addListener(onChange);
  tabs?.onActivated?.addListener(onChange);
  tabs?.onReplaced?.addListener(onChange);
  groups?.onCreated?.addListener(onChange);
  groups?.onUpdated?.addListener(onChange);
  groups?.onRemoved?.addListener(onChange);
  groups?.onMoved?.addListener(onChange);
  windows?.onCreated?.addListener(onChange);
  windows?.onRemoved?.addListener(onChange);
  windows?.onFocusChanged?.addListener(onChange);

  return () => {
    tabs?.onCreated?.removeListener(onChange);
    tabs?.onUpdated?.removeListener(onChange);
    tabs?.onRemoved?.removeListener(onChange);
    tabs?.onMoved?.removeListener(onChange);
    tabs?.onAttached?.removeListener(onChange);
    tabs?.onDetached?.removeListener(onChange);
    tabs?.onActivated?.removeListener(onChange);
    tabs?.onReplaced?.removeListener(onChange);
    groups?.onCreated?.removeListener(onChange);
    groups?.onUpdated?.removeListener(onChange);
    groups?.onRemoved?.removeListener(onChange);
    groups?.onMoved?.removeListener(onChange);
    windows?.onCreated?.removeListener(onChange);
    windows?.onRemoved?.removeListener(onChange);
    windows?.onFocusChanged?.removeListener(onChange);
  };
}
