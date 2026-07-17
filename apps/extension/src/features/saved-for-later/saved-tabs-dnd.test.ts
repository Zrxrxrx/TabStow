import { expect, it } from 'vitest';
import {
  SAVED_TABS_DRAG_MIME,
  readSavedTabsDragSource,
  resolveSavedDrop,
  writeSavedTabsDragSource,
  type SavedTabsDragSource,
} from './saved-tabs-dnd';

function fakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
  } as unknown as DataTransfer;
}

it('resolves a saved tab drop from stable tab IDs', () => {
  const source = {
    kind: 'tab',
    sessionId: 'source',
    tabId: 'tab-2',
  } as const;

  expect(
    resolveSavedDrop(source, {
      kind: 'tab',
      destinationSessionId: 'destination',
      beforeTabId: 'tab-3',
      tabIds: ['tab-3', 'tab-4'],
    }),
  ).toEqual({
    kind: 'tab',
    request: {
      sourceSessionId: 'source',
      tabId: 'tab-2',
      destinationSessionId: 'destination',
      destinationIndex: 0,
    },
  });
});

it('resolves a saved session drop from stable session IDs', () => {
  const source = { kind: 'session', sessionId: 'session-2' } as const;

  expect(
    resolveSavedDrop(source, {
      kind: 'session',
      beforeSessionId: 'session-1',
      sessionIds: ['session-1', 'session-2'],
    }),
  ).toEqual({
    kind: 'sessions',
    orderedIds: ['session-2', 'session-1'],
  });
});

it('adjusts same-session tab destinations after removing the source tab', () => {
  const source = { kind: 'tab', sessionId: 'session-1', tabId: 'tab-1' } as const;

  expect(
    resolveSavedDrop(source, {
      kind: 'tab',
      destinationSessionId: 'session-1',
      beforeTabId: null,
      tabIds: ['tab-1', 'tab-2', 'tab-3'],
    }),
  ).toEqual({
    kind: 'tab',
    request: {
      sourceSessionId: 'session-1',
      tabId: 'tab-1',
      destinationSessionId: 'session-1',
      destinationIndex: 2,
    },
  });
});

it('rejects no-op, incompatible, and search-filtered drops', () => {
  const tab = { kind: 'tab', sessionId: 'session-1', tabId: 'tab-1' } as const;
  const session = { kind: 'session', sessionId: 'session-1' } as const;
  const target = {
    kind: 'tab',
    destinationSessionId: 'session-2',
    beforeTabId: null,
    tabIds: ['tab-2'],
  } as const;

  expect(resolveSavedDrop(tab, target, { searchActive: true })).toBeNull();
  expect(resolveSavedDrop(session, target)).toBeNull();
  expect(
    resolveSavedDrop(tab, {
      kind: 'tab',
      destinationSessionId: 'session-1',
      beforeTabId: 'tab-1',
      tabIds: ['tab-1', 'tab-2'],
    }),
  ).toBeNull();
  expect(
    resolveSavedDrop(session, {
      kind: 'session',
      beforeSessionId: 'session-1',
      sessionIds: ['session-1', 'session-2'],
    }),
  ).toBeNull();
});

it('round-trips only valid Tabstow saved drag payloads', () => {
  const transfer = fakeDataTransfer();
  const source: SavedTabsDragSource = {
    kind: 'tab',
    sessionId: 'session-1',
    tabId: 'tab-1',
  };

  writeSavedTabsDragSource(transfer, source);

  expect(SAVED_TABS_DRAG_MIME).toBe('application/x-tabstow-saved-tabs');
  expect(transfer.effectAllowed).toBe('move');
  expect(readSavedTabsDragSource(transfer)).toEqual(source);
});

it('rejects malformed and external drag payloads', () => {
  const transfer = fakeDataTransfer();
  const malformedPayloads = [
    '',
    '{',
    'null',
    '[]',
    JSON.stringify({ kind: 'tab', sessionId: 'session-1' }),
    JSON.stringify({ kind: 'tab', sessionId: '', tabId: 'tab-1' }),
    JSON.stringify({ kind: 'session', sessionId: 1 }),
    JSON.stringify({ kind: 'other', sessionId: 'session-1' }),
    JSON.stringify({ kind: 'session', sessionId: 'session-1', tabId: 'unexpected' }),
  ];

  transfer.setData('text/plain', JSON.stringify({ kind: 'session', sessionId: 'external' }));
  expect(readSavedTabsDragSource(transfer)).toBeNull();

  for (const payload of malformedPayloads) {
    transfer.setData(SAVED_TABS_DRAG_MIME, payload);
    expect(readSavedTabsDragSource(transfer)).toBeNull();
  }
});
