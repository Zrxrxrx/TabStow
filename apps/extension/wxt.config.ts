import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Tabstow',
    description: 'Stow, organize, and restore your browser tabs.',
    permissions: ['tabs', 'storage', 'contextMenus'],
    host_permissions: ['https://api.github.com/*', 'https://gist.githubusercontent.com/*'],
    action: {
      default_title: 'Tabstow',
    },
  },
});
