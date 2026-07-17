import { describe, expect, it } from 'vitest';
import { presentSessionTitle } from './session-presentation';

describe('presentSessionTitle', () => {
  it('localizes only the exact generated title for the supplied tab count', () => {
    expect(presentSessionTitle('en', '1 tabs stowed', 1)).toBe('1 tab stowed');
    expect(presentSessionTitle('en', '3 tabs stowed', 3)).toBe('3 tabs stowed');
    expect(presentSessionTitle('zh-CN', '1 tabs stowed', 1)).toBe('已收起 1 个标签页');
    expect(presentSessionTitle('zh-CN', '3 tabs stowed', 3)).toBe('已收起 3 个标签页');
  });

  it.each([
    ['2 tabs stowed', 1],
    [' 1 tabs stowed', 1],
    ['1 tabs stowed ', 1],
    ['01 tabs stowed', 1],
    ['tabs stowed', 1],
    ['Reading list', 1],
  ])('preserves a non-matching stored title: %s', (title, tabCount) => {
    expect(presentSessionTitle('zh-CN', title, tabCount)).toBe(title);
  });
});
