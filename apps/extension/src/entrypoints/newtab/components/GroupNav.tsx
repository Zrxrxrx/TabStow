import type { ActiveTabGroup } from '@/features/active-tabs/types';

type Props = {
  groups: ActiveTabGroup[];
  onJump: (groupKey: string) => void;
};

export function GroupNav({ groups, onJump }: Props) {
  if (groups.length === 0) return null;

  return (
    <nav className="tabs-toolbar group-nav" aria-label="Active tab groups">
      <button className="group-filter" type="button" onClick={() => onJump(groups[0]?.key ?? '')} aria-pressed="true">
        <span>All</span>
        <strong>{groups.reduce((count, group) => count + group.tabs.length, 0)}</strong>
      </button>
      {groups.map((group) => (
        <button className="group-filter" key={group.key} type="button" onClick={() => onJump(group.key)}>
          <span>{group.title}</span>
          <strong>{group.tabs.length}</strong>
        </button>
      ))}
    </nav>
  );
}
