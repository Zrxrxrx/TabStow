import type { ActiveTabGroup } from '@/features/active-tabs/types';

type Props = {
  groups: ActiveTabGroup[];
  onJump: (groupKey: string) => void;
};

export function GroupNav({ groups, onJump }: Props) {
  if (groups.length === 0) return null;

  return (
    <nav className="group-nav" aria-label="Active tab groups">
      {groups.map((group) => (
        <button key={group.key} type="button" onClick={() => onJump(group.key)}>
          <span>{group.title}</span>
          <strong>{group.tabs.length}</strong>
        </button>
      ))}
    </nav>
  );
}
