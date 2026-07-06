import { DownloadCloud, Save, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExtensionSettings } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage, type SyncResult } from '@/lib/messages';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

const EMPTY_FORM: ExtensionSettings = {
  deviceId: '',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
};

export function OptionsApp() {
  const [settings, setSettings] = useState<ExtensionSettings>(EMPTY_FORM);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });

  async function loadSettings() {
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({ type: 'settings:get' });
    if (response.ok) {
      setSettings(response.data);
      return;
    }
    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  function updateField<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setBusyAction('save');
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings,
    });
    setBusyAction(null);

    if (response.ok) {
      setSettings(response.data);
      setStatus({ tone: 'success', message: 'Settings saved.' });
      return;
    }

    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  async function runSync(
    actionId: string,
    type: 'sync:push' | 'sync:pull',
    success: (result: SyncResult) => string,
  ) {
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const saved = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings,
    });

    if (!saved.ok) {
      setBusyAction(null);
      setStatus({ tone: 'error', message: saved.error.message });
      return;
    }

    const response = await sendExtensionMessage<AppResult<SyncResult>>({ type });
    setBusyAction(null);

    if (response.ok) {
      setStatus({ tone: 'success', message: success(response.data) });
      return;
    }

    if (!response.ok) {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  return (
    <main className="options-shell">
      <header className="options-header">
        <div>
          <h1>Tabstow Settings</h1>
          <p>Configure manual GitHub Gist sync.</p>
        </div>
      </header>

      <StatusMessage message={status.message} tone={status.tone} />

      <section className="settings-section" aria-labelledby="gist-heading">
        <h2 id="gist-heading">Gist Sync</h2>
        <label>
          GitHub token
          <input
            type="password"
            value={settings.githubToken ?? ''}
            onChange={(event) => updateField('githubToken', event.target.value || undefined)}
            autoComplete="off"
          />
        </label>
        <label>
          Gist ID
          <input
            type="text"
            value={settings.gistId ?? ''}
            onChange={(event) => updateField('gistId', event.target.value || undefined)}
          />
        </label>
        <label>
          Gist filename
          <input
            type="text"
            value={settings.gistFileName}
            onChange={(event) => updateField('gistFileName', event.target.value)}
          />
        </label>
      </section>

      <section className="settings-section" aria-labelledby="behavior-heading">
        <h2 id="behavior-heading">Tab Behavior</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.includePinnedTabs}
            onChange={(event) => updateField('includePinnedTabs', event.target.checked)}
          />
          Save pinned tabs when stowing
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.closePinnedTabs}
            onChange={(event) => updateField('closePinnedTabs', event.target.checked)}
            disabled={!settings.includePinnedTabs}
          />
          Close pinned tabs after saving
        </label>
        <label>
          Theme
          <select
            value={settings.theme}
            onChange={(event) =>
              updateField('theme', event.target.value as ExtensionSettings['theme'])
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </section>

      <section className="settings-section" aria-labelledby="device-heading">
        <h2 id="device-heading">Device</h2>
        <p className="device-id">{settings.deviceId || 'Device ID will be created on first save.'}</p>
      </section>

      <footer className="options-actions">
        <button type="button" className="primary-button" onClick={() => void saveSettings()} disabled={busyAction !== null}>
          <Save size={16} aria-hidden="true" />
          Save
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void runSync('pull', 'sync:pull', (result) => `Pulled ${result.sessionCount} sessions.`)
          }
          disabled={busyAction !== null}
        >
          <DownloadCloud size={16} aria-hidden="true" />
          Pull
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void runSync('push', 'sync:push', (result) => `Pushed ${result.sessionCount} sessions.`)
          }
          disabled={busyAction !== null}
        >
          <UploadCloud size={16} aria-hidden="true" />
          Push
        </button>
      </footer>
    </main>
  );
}
