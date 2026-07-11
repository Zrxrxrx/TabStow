import { expect, it } from 'vitest';
import {
  ACTIVE_TABS_DRAG_MIME,
  readActiveTabsDragSource,
  resolveActiveTabsDropRequest,
  writeActiveTabsDragSource,
} from './active-tabs-dnd';

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
}

it('round-trips a tab source and resolves a compatible tab request', () => {
  const transfer = fakeDataTransfer();
  const source = {
    kind: 'tab',
    tabId: 10,
    windowId: 2,
    pinned: false,
    incognito: false,
  } as const;
  writeActiveTabsDragSource(transfer, source);

  expect(transfer.effectAllowed).toBe('move');
  expect(readActiveTabsDragSource(transfer)).toEqual(source);
  expect(
    resolveActiveTabsDropRequest(source, {
      key: 'group:31:end',
      incognito: false,
      tabDestination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    }),
  ).toEqual({
    kind: 'tab',
    request: {
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    },
  });
});

it('round-trips a group source and resolves a complete top-level target', () => {
  const transfer = fakeDataTransfer();
  const source = {
    kind: 'group',
    groupId: 31,
    windowId: 2,
    incognito: false,
  } as const;
  writeActiveTabsDragSource(transfer, source);

  expect(readActiveTabsDragSource(transfer)).toEqual(source);
  expect(
    resolveActiveTabsDropRequest(source, {
      key: 'window:3:end',
      incognito: false,
      groupDestination: { windowId: 3, position: { kind: 'end' } },
    }),
  ).toEqual({
    kind: 'group',
    request: {
      groupId: 31,
      sourceWindowId: 2,
      destination: { windowId: 3, position: { kind: 'end' } },
    },
  });
});

it('rejects missing, invalid, and structurally malformed payloads', () => {
  const transfer = fakeDataTransfer();
  const malformedPayloads = [
    '',
    '{',
    'null',
    '[]',
    JSON.stringify({ kind: 'tab', tabId: 10, windowId: 2, pinned: false }),
    JSON.stringify({ kind: 'tab', tabId: 10.5, windowId: 2, pinned: false, incognito: false }),
    JSON.stringify({ kind: 'group', groupId: '31', windowId: 2, incognito: false }),
    JSON.stringify({ kind: 'other', tabId: 10, windowId: 2, pinned: false, incognito: false }),
  ];

  for (const payload of malformedPayloads) {
    transfer.setData(ACTIVE_TABS_DRAG_MIME, payload);
    expect(readActiveTabsDragSource(transfer)).toBeNull();
  }
});

it('rejects pinned-lane and incognito mismatches', () => {
  const pinned = {
    kind: 'tab',
    tabId: 10,
    windowId: 2,
    pinned: true,
    incognito: false,
  } as const;
  const unpinned = { ...pinned, pinned: false } as const;
  const ungroupedTarget = {
    key: 'window:3:end',
    incognito: false,
    tabDestination: {
      windowId: 3,
      lane: { kind: 'ungrouped' as const },
      position: { kind: 'end' as const },
    },
  };
  const pinnedTarget = {
    key: 'window:3:pinned:end',
    incognito: false,
    tabDestination: {
      windowId: 3,
      lane: { kind: 'pinned' as const },
      position: { kind: 'end' as const },
    },
  };

  expect(resolveActiveTabsDropRequest(pinned, ungroupedTarget)).toBeNull();
  expect(resolveActiveTabsDropRequest(unpinned, pinnedTarget)).toBeNull();
  expect(
    resolveActiveTabsDropRequest(unpinned, { ...ungroupedTarget, incognito: true }),
  ).toBeNull();
});

it('only resolves groups against complete top-level group targets', () => {
  const group = {
    kind: 'group',
    groupId: 31,
    windowId: 2,
    incognito: false,
  } as const;
  const groupLaneTarget = {
    key: 'group:44:end',
    incognito: false,
    tabDestination: {
      windowId: 3,
      lane: { kind: 'group' as const, groupId: 44 },
      position: { kind: 'end' as const },
    },
  };

  expect(resolveActiveTabsDropRequest(group, groupLaneTarget)).toBeNull();
  expect(resolveActiveTabsDropRequest(group, { ...groupLaneTarget, incognito: true })).toBeNull();
});
