import {
  Copy,
  DownloadCloud,
  ExternalLink,
  GitBranch,
  RefreshCcw,
  Save,
  Unplug,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ExtensionSettings } from '@tabstow/core';
import { StatusMessage } from '@/components/StatusMessage';
import { UtilityPageShell } from '@/components/UtilityPageShell';
import type { AppResult } from '@/lib/errors';
import {
  sendExtensionMessage,
  type SyncResult,
} from '@/lib/messages';
import type { ConnectionView, SyncStatusView } from '@/features/sync/sync-types';

type StatusState = {
  tone: 'info' | 'success' | 'error';
  message: string | null;
};

const EMPTY_FORM: ExtensionSettings = {
  deviceId: '',
  includePinnedTabs: false,
  closePinnedTabs: false,
};

const DISCONNECTED: ConnectionView = {
  phase: 'disconnected',
  sync: { state: 'disconnected' },
};

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function formatTime(value: string | number | undefined): string {
  if (value === undefined) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function OptionsApp({
  initialThemeError = null,
}: {
  initialThemeError?: string | null;
} = {}) {
  const [settings, setSettings] = useState<ExtensionSettings>(EMPTY_FORM);
  const [settingsPatch, setSettingsPatch] = useState<Partial<ExtensionSettings>>({});
  const settingsPatchRef = useRef<Partial<ExtensionSettings>>({});
  const [connection, setConnection] = useState<ConnectionView>(DISCONNECTED);
  const [gistId, setGistId] = useState('');
  const [fileName, setFileName] = useState('tabstow.sync.json');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });

  async function loadSettings(preserveUnsavedChanges = false) {
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({ type: 'settings:get' });
    if (response.ok) {
      setSettings(
        preserveUnsavedChanges
          ? { ...response.data, ...settingsPatchRef.current }
          : response.data,
      );
    }
    else setStatus({ tone: 'error', message: response.error.message });
  }

  async function loadConnection() {
    const response = await sendExtensionMessage<AppResult<ConnectionView>>({ type: 'connection:get' });
    if (response.ok) setConnection(response.data);
    else setStatus({ tone: 'error', message: response.error.message });
  }

  useEffect(() => {
    void Promise.all([loadSettings(), loadConnection()]);
  }, []);

  useEffect(() => {
    function handleRuntimeMessage(message: unknown) {
      if (!message || typeof message !== 'object' || !('type' in message)) return;
      const event = message as { type?: unknown; status?: SyncStatusView };
      if (event.type === 'sync:status-changed' && event.status) {
        setConnection((current) => ({ ...current, sync: event.status! }));
      } else if (event.type === 'connection:state-changed') {
        void loadConnection();
      } else if (event.type === 'sync:data-changed') {
        void loadSettings(true);
      }
    }

    const runtimeMessages = globalThis.chrome?.runtime?.onMessage;
    runtimeMessages?.addListener(handleRuntimeMessage);
    return () => runtimeMessages?.removeListener(handleRuntimeMessage);
  }, []);

  useEffect(() => {
    if (connection.phase !== 'authorizing' || !connection.deviceFlow) return;
    const interval = window.setInterval(() => {
      void sendExtensionMessage<AppResult<ConnectionView>>({ type: 'oauth:poll' }).then(
        (response) => {
          if (response.ok) setConnection(response.data);
          else setStatus({ tone: 'error', message: response.error.message });
        },
      );
    }, Math.max(1_000, connection.deviceFlow.intervalSeconds * 1_000));
    return () => window.clearInterval(interval);
  }, [connection.phase, connection.deviceFlow?.intervalSeconds]);

  function updateField<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    const nextPatch = { ...settingsPatchRef.current, [key]: value };
    settingsPatchRef.current = nextPatch;
    setSettingsPatch(nextPatch);
  }

  async function saveSettings() {
    setBusyAction('save');
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings: settingsPatch,
    });
    setBusyAction(null);
    if (response.ok) {
      setSettings(response.data);
      settingsPatchRef.current = {};
      setSettingsPatch({});
      setStatus({ tone: 'success', message: 'Settings saved.' });
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  async function runConnectionAction(
    actionId: string,
    message:
      | { type: 'oauth:start' | 'oauth:cancel' | 'gist:rescan' | 'gist:choose-another' | 'sync:disconnect' }
      | { type: 'gist:select'; gistId: string; fileName?: string }
      | { type: 'gist:confirm'; targetKey: string },
    successMessage?: string,
  ) {
    setBusyAction(actionId);
    setStatus({ tone: 'info', message: null });
    const response = await sendExtensionMessage<AppResult<ConnectionView>>(message);
    setBusyAction(null);
    if (response.ok) {
      setConnection(response.data);
      if (response.data.sync.state === 'paused' && response.data.sync.message) {
        setStatus({ tone: 'error', message: response.data.sync.message });
      } else if (successMessage) {
        setStatus({ tone: 'success', message: successMessage });
      }
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
  }

  async function runSync(type: 'sync:retry' | 'sync:pull' | 'sync:push') {
    setBusyAction(type);
    setStatus({ tone: 'info', message: null });
    const response = await sendExtensionMessage<AppResult<SyncResult>>({ type });
    setBusyAction(null);
    if (response.ok) {
      setStatus({
        tone: 'success',
        message: `${type === 'sync:pull' ? 'Pulled' : 'Synchronized'} ${response.data.sessionCount} sessions and ${response.data.quickLinkCount} quick links.`,
      });
      await loadConnection();
    } else {
      setStatus({ tone: 'error', message: response.error.message });
      await loadConnection();
    }
  }

  async function copyUserCode() {
    const code = connection.deviceFlow?.userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setStatus({ tone: 'success', message: 'GitHub device code copied.' });
    } catch {
      setStatus({ tone: 'error', message: 'Could not copy the GitHub device code.' });
    }
  }

  const disabled = busyAction !== null;
  const confirmedBinding = connection.binding;
  const visibleBinding = confirmedBinding ?? connection.pendingBinding;

  return (
    <UtilityPageShell
      backToWorkspaceLabel="Back to workspace"
      pageLabel="Settings"
    >
      <p className="options-intro">
        Connect GitHub once, then let Tabstow synchronize automatically.
      </p>

      <StatusMessage message={initialThemeError} tone="error" />
      <StatusMessage message={status.message} tone={status.tone} />

      <section className="settings-section" aria-labelledby="gist-heading">
        <h2 id="gist-heading">GitHub Gist Sync</h2>

        {connection.phase === 'disconnected' ? (
          <div className="connection-card">
            <p>Use GitHub Device Flow to connect. Tabstow requests only the <code>gist</code> scope.</p>
            <button
              type="button"
              className="primary-button"
              disabled={disabled}
              onClick={() => void runConnectionAction('connect', { type: 'oauth:start' })}
            >
              <GitBranch size={16} aria-hidden="true" />
              Connect GitHub
            </button>
          </div>
        ) : null}

        {connection.phase === 'authorizing' && connection.deviceFlow ? (
          <div className="connection-card">
            <p>Enter this code on GitHub:</p>
            <strong className="device-code">{connection.deviceFlow.userCode}</strong>
            <p className="help-text">Expires {formatTime(connection.deviceFlow.expiresAt)}.</p>
            <div className="inline-actions">
              <button type="button" className="secondary-button" onClick={() => void copyUserCode()}>
                <Copy size={16} aria-hidden="true" /> Copy code
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => openExternal(connection.deviceFlow!.verificationUri)}
              >
                <ExternalLink size={16} aria-hidden="true" /> Open GitHub
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() => void runConnectionAction('cancel', { type: 'oauth:cancel' })}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {connection.phase === 'needs-target' ? (
          <div className="connection-card">
            <p>
              Connected as <strong>{connection.account?.login}</strong>. Choose an existing Gist;
              Tabstow never creates one.
            </p>
            {connection.candidates?.length ? (
              <div className="candidate-list" aria-label="Discovered Gists">
                {connection.candidates.map((candidate) => (
                  <button
                    type="button"
                    className="candidate-button"
                    key={candidate.gistId}
                    disabled={disabled}
                    onClick={() =>
                      void runConnectionAction('select-candidate', {
                        type: 'gist:select',
                        gistId: candidate.gistId,
                        fileName: candidate.fileName,
                      })
                    }
                  >
                    <span>{candidate.description || candidate.gistId}</span>
                    <small>{candidate.public ? 'Public Gist — confirmation required' : 'Unlisted Gist'}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="help-text">No unambiguous <code>tabstow.sync.json</code> Gist was found.</p>
            )}
            <div className="target-grid">
              <label>
                Existing Gist ID
                <input value={gistId} onChange={(event) => setGistId(event.target.value)} />
              </label>
              <label>
                Sync filename
                <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
              </label>
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-button"
                disabled={disabled || !gistId.trim() || !fileName.trim()}
                onClick={() =>
                  void runConnectionAction('select-manual', {
                    type: 'gist:select',
                    gistId,
                    fileName,
                  })
                }
              >
                Use existing Gist
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() => void runConnectionAction('rescan', { type: 'gist:rescan' })}
              >
                <RefreshCcw size={16} aria-hidden="true" /> Rescan
              </button>
            </div>
          </div>
        ) : null}

        {connection.phase === 'needs-confirmation' && connection.pendingBinding ? (
          <div className="connection-card warning-card">
            <h3>Confirm synchronization target</h3>
            <p>
              Tabstow will non-destructively merge this device's{' '}
              <strong>{connection.pendingBinding.localCounts.tabCount} saved tabs</strong> and{' '}
              <strong>{connection.pendingBinding.localCounts.quickLinkCount} quick links</strong> with
              the selected Gist.
            </p>
            {connection.pendingBinding.public ? (
              <p className="danger-text">
                This Gist is public. Saved titles and URLs will be visible to anyone.
              </p>
            ) : (
              <p className="help-text">
                Unlisted Gists are not encrypted or truly private; anyone with the URL can read them.
              </p>
            )}
            <p><code>{connection.pendingBinding.gistId}/{connection.pendingBinding.fileName}</code></p>
            <div className="inline-actions">
              <button
                type="button"
                className="primary-button"
                disabled={disabled}
                onClick={() =>
                  void runConnectionAction(
                    'confirm',
                    { type: 'gist:confirm', targetKey: connection.pendingBinding!.targetKey },
                    'GitHub Gist synchronization connected.',
                  )
                }
              >
                Confirm and synchronize
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() =>
                  void runConnectionAction('choose-another', { type: 'gist:choose-another' })
                }
              >
                Choose another Gist
              </button>
            </div>
          </div>
        ) : null}

        {connection.phase === 'connected' && confirmedBinding ? (
          <div className="connection-card">
            <div className="connection-summary">
              <div>
                <strong>Connected as {connection.account?.login}</strong>
                <p><code>{confirmedBinding.gistId}/{confirmedBinding.fileName}</code></p>
              </div>
              <span className={`sync-state sync-state--${connection.sync.state}`}>
                {connection.sync.state}
              </span>
            </div>
            {connection.sync.message ? <p>{connection.sync.message}</p> : null}
            <p className="help-text">Last successful sync: {formatTime(connection.sync.lastSuccessAt)}</p>
            <div className="inline-actions">
              {connection.sync.action === 'reconnect' ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={disabled}
                  onClick={() => void runConnectionAction('reconnect', { type: 'oauth:start' })}
                >
                  <GitBranch size={16} aria-hidden="true" /> Reconnect GitHub
                </button>
              ) : null}
              <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:pull')}>
                <DownloadCloud size={16} aria-hidden="true" /> Pull
              </button>
              <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:push')}>
                <UploadCloud size={16} aria-hidden="true" /> Push
              </button>
              <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:retry')}>
                <RefreshCcw size={16} aria-hidden="true" /> Retry now
              </button>
              <button type="button" className="secondary-button" onClick={() => openExternal(confirmedBinding.htmlUrl)}>
                <ExternalLink size={16} aria-hidden="true" /> Open Gist
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={disabled}
                onClick={() => void runConnectionAction('choose-another', { type: 'gist:choose-another' })}
              >
                Choose another Gist
              </button>
              <button
                type="button"
                className="secondary-button danger-button"
                disabled={disabled}
                onClick={() =>
                  void runConnectionAction(
                    'disconnect',
                    { type: 'sync:disconnect' },
                    'GitHub disconnected on this device.',
                  )
                }
              >
                <Unplug size={16} aria-hidden="true" /> Disconnect
              </button>
            </div>
          </div>
        ) : null}

        {visibleBinding?.public && connection.phase !== 'needs-confirmation' ? (
          <p className="danger-text">The selected Gist is public.</p>
        ) : null}

        <p className="help-text">
          Disconnect removes access from this device only.{' '}
          <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
            Manage or revoke this OAuth App on GitHub
          </a>
          .
        </p>
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
      </section>

      <section className="settings-section" aria-labelledby="device-heading">
        <h2 id="device-heading">Replica</h2>
        <p className="device-id">{settings.deviceId || 'Replica ID will be created automatically.'}</p>
      </section>

      <footer className="options-actions">
        <button type="button" className="primary-button" onClick={() => void saveSettings()} disabled={disabled}>
          <Save size={16} aria-hidden="true" /> Save settings
        </button>
      </footer>
    </UtilityPageShell>
  );
}
