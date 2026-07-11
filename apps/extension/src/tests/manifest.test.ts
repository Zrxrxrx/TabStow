import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

const manifest = config.manifest as
  | {
      action?: {
        default_title?: string;
        default_popup?: unknown;
      };
      permissions?: string[];
      host_permissions?: string[];
      content_scripts?: unknown[];
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
    expect(manifest?.permissions).toEqual([
      'tabs',
      'storage',
      'contextMenus',
      'tabGroups',
      'search',
      'favicon',
    ]);
  });

  it('does not register content scripts', () => {
    expect(manifest).not.toHaveProperty('content_scripts');
  });

  it('keeps host permissions narrow while enabling Chrome favicon resolution', () => {
    expect(manifest?.host_permissions).toEqual([
      'https://api.github.com/*',
      'https://gist.githubusercontent.com/*',
    ]);
  });
});
