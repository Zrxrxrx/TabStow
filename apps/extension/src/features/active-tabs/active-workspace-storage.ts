import { storage } from '#imports';
import { normalizeManualGroupsState } from './manual-groups';
import type { ActiveWorkspaceOrderState, ManualGroupsState } from './types';

const ACTIVE_WORKSPACE_KEY = 'local:tabstow-active-workspace';

export type ChromeTabGroupMapping = {
  virtualGroupKey: string;
  windowId: number;
  chromeGroupId: number;
};

export type ChromeTabGroupsState = {
  enabled: boolean;
  mappings: ChromeTabGroupMapping[];
};

export type ActiveWorkspaceState = {
  manualGroups: ManualGroupsState;
  order: ActiveWorkspaceOrderState;
  chromeTabGroups: ChromeTabGroupsState;
};

function normalizeOrder(input: Partial<ActiveWorkspaceOrderState> | undefined): ActiveWorkspaceOrderState {
  const dedupe = (values: unknown[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const stringValue = String(value);
      if (!stringValue || seen.has(stringValue)) continue;
      seen.add(stringValue);
      result.push(stringValue);
    }

    return result;
  };

  return {
    groupOrder: Array.isArray(input?.groupOrder) ? dedupe(input.groupOrder) : [],
    pinnedGroupKeys: Array.isArray(input?.pinnedGroupKeys)
      ? dedupe(input.pinnedGroupKeys)
      : [],
    groupTabOrder:
      input?.groupTabOrder && typeof input.groupTabOrder === 'object'
        ? Object.fromEntries(
            Object.entries(input.groupTabOrder).map(([key, ids]) => [
              key,
              Array.isArray(ids) ? dedupe(ids) : [],
            ]),
          )
        : {},
  };
}

function normalizeChromeGroups(input: Partial<ChromeTabGroupsState> | undefined): ChromeTabGroupsState {
  return {
    enabled: Boolean(input?.enabled),
    mappings: Array.isArray(input?.mappings)
      ? input.mappings
          .filter(
            (
              mapping,
            ): mapping is {
              virtualGroupKey: unknown;
              windowId: unknown;
              chromeGroupId: unknown;
            } => Boolean(mapping && typeof mapping === 'object'),
          )
          .filter(
            (mapping) =>
              Boolean(mapping.virtualGroupKey) &&
              Number.isInteger(mapping.windowId) &&
              Number.isInteger(mapping.chromeGroupId),
          )
          .map((mapping) => ({
            virtualGroupKey: String(mapping.virtualGroupKey),
            windowId: Number(mapping.windowId),
            chromeGroupId: Number(mapping.chromeGroupId),
          }))
      : [],
  };
}

export function normalizeActiveWorkspaceState(
  input: Partial<ActiveWorkspaceState> | null | undefined,
): ActiveWorkspaceState {
  return {
    manualGroups: normalizeManualGroupsState(input?.manualGroups),
    order: normalizeOrder(input?.order),
    chromeTabGroups: normalizeChromeGroups(input?.chromeTabGroups),
  };
}

export async function getActiveWorkspaceState(): Promise<ActiveWorkspaceState> {
  return normalizeActiveWorkspaceState(
    await storage.getItem<Partial<ActiveWorkspaceState>>(ACTIVE_WORKSPACE_KEY),
  );
}

export async function updateActiveWorkspaceState(
  partial: Partial<ActiveWorkspaceState>,
): Promise<ActiveWorkspaceState> {
  const current = await getActiveWorkspaceState();
  const next = normalizeActiveWorkspaceState({
    ...current,
    ...partial,
    manualGroups: partial.manualGroups ?? current.manualGroups,
    order: partial.order ?? current.order,
    chromeTabGroups: partial.chromeTabGroups ?? current.chromeTabGroups,
  });

  await storage.setItem(ACTIVE_WORKSPACE_KEY, next);

  return next;
}
