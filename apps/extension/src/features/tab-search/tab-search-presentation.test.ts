import { describe, expect, it } from 'vitest';
import {
  presentActiveTabContext,
  presentSavedTabContext,
} from './tab-search-presentation';

describe('tab search presentation', () => {
  it('localizes active window, unnamed group, pinned, and ungrouped context without IDs', () => {
    expect(
      presentActiveTabContext('en', {
        currentWindow: true,
        windowNumber: 1,
        lane: { kind: 'group', title: null },
      }),
    ).toBe('Current window · Unnamed group');
    expect(
      presentActiveTabContext('zh-CN', {
        currentWindow: false,
        windowNumber: 2,
        lane: { kind: 'pinned' },
      }),
    ).toBe('窗口 2 · 固定标签页');
    expect(
      presentActiveTabContext('en', {
        currentWindow: false,
        windowNumber: 3,
        lane: { kind: 'ungrouped' },
      }),
    ).toBe('Window 3 · Ungrouped');
  });

  it('uses localized generated titles for saved-window context', () => {
    const context = { sessionTitle: '1 tabs stowed', tabCount: 1 };

    expect(presentSavedTabContext('en', context)).toBe('1 tab stowed');
    expect(presentSavedTabContext('zh-CN', context)).toBe('已收起 1 个标签页');
  });
});
