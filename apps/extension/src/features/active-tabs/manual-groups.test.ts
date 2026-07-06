import { describe, expect, it } from 'vitest';
import {
  addManualGroup,
  assignTabToManualGroup,
  clearTabManualGroup,
  normalizeManualGroupsState,
  pruneManualGroups,
} from './manual-groups';

describe('manual active tab groups', () => {
  it('normalizes invalid state to empty state', () => {
    expect(normalizeManualGroupsState({ groups: [{ id: '', name: '' }], assignments: { 1: '' } })).toEqual({
      groups: [],
      assignments: {},
    });
  });

  it('adds a group with a deterministic id factory', () => {
    const result = addManualGroup({ groups: [], assignments: {} }, 'Launch', () => 'manual-1');

    expect(result.group).toEqual({ id: 'manual-1', name: 'Launch', createdAt: expect.any(String) });
    expect(result.state.groups).toHaveLength(1);
  });

  it('assigns and clears tabs', () => {
    const state = { groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }], assignments: {} };
    expect(assignTabToManualGroup(state, 4, 'manual-1').assignments).toEqual({ '4': 'manual-1' });
    expect(clearTabManualGroup({ ...state, assignments: { '4': 'manual-1' } }, 4).assignments).toEqual({});
  });

  it('prunes closed tab assignments and empty groups', () => {
    const state = {
      groups: [
        { id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' },
        { id: 'manual-2', name: 'Closed', createdAt: '2026-07-06T00:00:00.000Z' },
      ],
      assignments: { '4': 'manual-1', '5': 'manual-2' },
    };

    expect(pruneManualGroups(state, [4])).toEqual({
      groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }],
      assignments: { '4': 'manual-1' },
    });
  });
});
