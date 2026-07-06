import type { ManualGroupsState, ManualTabGroup } from './types';

const EMPTY_STATE: ManualGroupsState = { groups: [], assignments: {} };

export function normalizeManualGroupsState(input: unknown): ManualGroupsState {
  if (!input || typeof input !== 'object') {
    return EMPTY_STATE;
  }

  const candidate = input as Partial<ManualGroupsState>;
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups
        .filter((group): group is ManualTabGroup => Boolean(group?.id && group?.name))
        .map((group) => ({
          id: String(group.id),
          name: String(group.name).trim(),
          createdAt: group.createdAt || new Date().toISOString(),
        }))
        .filter((group) => group.id.length > 0 && group.name.length > 0)
    : [];

  const groupIds = new Set(groups.map((group) => group.id));
  const assignments = Object.fromEntries(
    Object.entries(candidate.assignments ?? {})
      .map(([tabId, groupId]) => [String(tabId), String(groupId)])
      .filter(([tabId, groupId]) => tabId.length > 0 && groupIds.has(groupId)),
  );

  return { groups, assignments };
}

export function addManualGroup(
  state: ManualGroupsState,
  name: string,
  createId: () => string = () => crypto.randomUUID(),
): { state: ManualGroupsState; group: ManualTabGroup } {
  const normalized = normalizeManualGroupsState(state);
  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error('Group name is required.');
  }

  if (normalized.groups.some((group) => group.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('A group with that name already exists.');
  }

  const group = {
    id: createId(),
    name: cleanName,
    createdAt: new Date().toISOString(),
  };

  return {
    group,
    state: { ...normalized, groups: [...normalized.groups, group] },
  };
}

export function assignTabToManualGroup(
  state: ManualGroupsState,
  tabId: number,
  groupId: string,
): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);

  if (!normalized.groups.some((group) => group.id === groupId)) {
    throw new Error('Group not found.');
  }

  return {
    ...normalized,
    assignments: { ...normalized.assignments, [String(tabId)]: groupId },
  };
}

export function clearTabManualGroup(state: ManualGroupsState, tabId: number): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);
  const assignments = { ...normalized.assignments };

  delete assignments[String(tabId)];

  return { ...normalized, assignments };
}

export function pruneManualGroups(state: ManualGroupsState, openTabIds: number[]): ManualGroupsState {
  const normalized = normalizeManualGroupsState(state);
  const openIds = new Set(openTabIds.map(String));
  const assignments = Object.fromEntries(
    Object.entries(normalized.assignments).filter(([tabId]) => openIds.has(tabId)),
  );
  const activeGroupIds = new Set(Object.values(assignments));

  return {
    groups: normalized.groups.filter((group) => activeGroupIds.has(group.id)),
    assignments,
  };
}
