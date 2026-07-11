import type { SavedTab } from '@tabstow/core';

export type HistoryReason = 'opened' | 'restored' | 'deleted';

export type HistoryEntry = {
  id: string;
  sourceSessionId: string;
  sourceTitle: string;
  tabs: SavedTab[];
  originalCreatedAt: string;
  movedAt: string;
  reason: HistoryReason;
  deviceId: string;
};

export type MoveSavedTabRequest = {
  sourceSessionId: string;
  tabId: string;
  destinationSessionId: string;
  destinationIndex: number;
};
