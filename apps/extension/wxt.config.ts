import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  zip: {
    name: 'tabstow',
  },
  manifest: {
    name: 'Tabstow',
    description: 'Stow, organize, and restore your browser tabs.',
    minimum_chrome_version: '114',
    permissions: [
      'tabs',
      'storage',
      'contextMenus',
      'tabGroups',
      'search',
      'favicon',
      'alarms',
      'sidePanel',
    ],
    host_permissions: [
      'https://api.github.com/*',
      'https://gist.githubusercontent.com/*',
      'https://github.com/*',
    ],
    action: {
      default_title: 'Tabstow',
    },
  },
});
