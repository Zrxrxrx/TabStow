import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

const manifest = config.manifest as
  | {
      action?: {
        default_title?: string;
        default_popup?: unknown;
      };
      permissions?: string[];
    }
  | undefined;

describe('extension manifest', () => {
  it('keeps toolbar action click as the default action', () => {
    expect(manifest?.action).toMatchObject({
      default_title: 'Tabstow',
    });
    expect(manifest?.action).not.toHaveProperty('default_popup');
  });

  it('uses the approved permissions for this migration', () => {
    expect(manifest?.permissions).toEqual(
      expect.arrayContaining(['tabs', 'storage', 'contextMenus', 'tabGroups', 'search']),
    );
    expect(manifest?.permissions).not.toContain('clipboardRead');
  });
});
