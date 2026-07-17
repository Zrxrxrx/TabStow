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

type SettingsFormState = {
  persisted: ExtensionSettings;
  draft: ExtensionSettings;
};

const EDITABLE_SETTINGS_KEYS = ['includePinnedTabs', 'closePinnedTabs'] as const;

const EMPTY_FORM: ExtensionSettings = {
  deviceId: '',
  includePinnedTabs: false,
  closePinnedTabs: false,
};

const DISCONNECTED: ConnectionView = {
  phase: 'disconnected',
  sync: { state: 'disconnected' },
};

function deriveSettingsPatch({
  persisted,
  draft,
}: SettingsFormState): Partial<ExtensionSettings> {
  const patch: Partial<ExtensionSettings> = {};
  for (const key of EDITABLE_SETTINGS_KEYS) {
    if (draft[key] !== persisted[key]) patch[key] = draft[key];
  }
  return patch;
}

function rebaseSettingsForm(
  current: SettingsFormState,
  incoming: ExtensionSettings,
): SettingsFormState {
  return {
    persisted: incoming,
    draft: { ...incoming, ...deriveSettingsPatch(current) },
  };
}

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
  const [settingsForm, setSettingsForm] = useState<SettingsFormState | null>(null);
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false);
  const settingsLoadGenerationRef = useRef(0);
  const settingsSettledGenerationRef = useRef(0);
  const savePendingRef = useRef(false);
  const [connection, setConnection] = useState<ConnectionView>(DISCONNECTED);
  const [gistId, setGistId] = useState('');
  const [fileName, setFileName] = useState('tabstow.sync.json');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusState>({ tone: 'info', message: null });

  const settingsDraft = settingsForm?.draft ?? EMPTY_FORM;
  const settingsPatch = settingsForm ? deriveSettingsPatch(settingsForm) : {};
  const settingsDirty = Object.keys(settingsPatch).length > 0;
  const settingsSaveState = !settingsForm
    ? settingsLoadFailed
      ? 'Preferences are unavailable.'
      : 'Loading preferences…'
    : settingsDirty
      ? 'Unsaved preference changes.'
      : 'Preferences are up to date.';

  async function loadSettings(preserveUnsavedChanges = false) {
    const generation = ++settingsLoadGenerationRef.current;
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({ type: 'settings:get' });
    if (generation !== settingsLoadGenerationRef.current) return;
    settingsSettledGenerationRef.current = generation;
    if (response.ok) {
      setSettingsLoadFailed(false);
      setSettingsForm((current) =>
        preserveUnsavedChanges && current
          ? rebaseSettingsForm(current, response.data)
          : { persisted: response.data, draft: response.data },
      );
    }
    else {
      setSettingsLoadFailed(true);
      setStatus({ tone: 'error', message: response.error.message });
    }
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
    setSettingsForm((current) =>
      current
        ? { ...current, draft: { ...current.draft, [key]: value } }
        : current,
    );
  }

  async function saveSettings() {
    if (!settingsForm || !settingsDirty || savePendingRef.current) return;
    const settingsLoadGenerationAtStart = settingsLoadGenerationRef.current;
    const settingsLoadWasPending =
      settingsSettledGenerationRef.current !== settingsLoadGenerationAtStart;
    savePendingRef.current = true;
    setBusyAction('save');
    const response = await sendExtensionMessage<AppResult<ExtensionSettings>>({
      type: 'settings:update',
      settings: settingsPatch,
    });
    if (response.ok) {
      setSettingsForm({ persisted: response.data, draft: response.data });
      setStatus({ tone: 'success', message: 'Preferences saved.' });
      if (
        settingsLoadWasPending ||
        settingsLoadGenerationRef.current !== settingsLoadGenerationAtStart
      ) {
        await loadSettings();
      }
    } else {
      setStatus({ tone: 'error', message: response.error.message });
    }
    savePendingRef.current = false;
    setBusyAction(null);
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

  async function copyDeviceId() {
    const deviceId = settingsForm?.draft.deviceId;
    if (!deviceId) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setStatus({ tone: 'success', message: 'Device ID copied.' });
    } catch {
      setStatus({ tone: 'error', message: 'Could not copy the Device ID.' });
    }
  }

  const disabled = busyAction !== null;
  const confirmedBinding = connection.binding;
  const visibleBinding = confirmedBinding ?? connection.pendingBinding;
  const canDisconnect =
    connection.phase === 'needs-target' ||
    connection.phase === 'needs-confirmation' ||
    connection.phase === 'connected';
  const showManualSyncActions =
    connection.phase === 'connected' &&
    (connection.sync.state === 'synced' || connection.sync.state === 'pending');
  const showRetryAction =
    connection.phase === 'connected' &&
    (connection.sync.state === 'retrying' || connection.sync.action === 'inspect-file');
  const showOpenGistAction =
    connection.phase === 'connected' && connection.sync.action !== 'rebind';
  const showChooseAnotherAction =
    connection.phase === 'connected' &&
    (connection.sync.state === 'synced' ||
      connection.sync.state === 'pending' ||
      connection.sync.action === 'rebind' ||
      connection.sync.action === 'inspect-file');

  return (
    <UtilityPageShell
      backToWorkspaceLabel="Back to workspace"
      pageLabel="Settings"
    >
      <p className="options-intro">
        Tabstow works locally first. GitHub sync is optional.
      </p>
      <p className="options-intro-detail">
        Connect an existing Gist to synchronize Saved windows, Quick Links, and pinned-tab preferences across devices.
      </p>

      <StatusMessage message={initialThemeError} tone="error" />
      <StatusMessage message={status.message} tone={status.tone} />

      <section className="settings-section" aria-labelledby="gist-heading">
        <h2 id="gist-heading">Optional GitHub sync</h2>

        {connection.phase === 'disconnected' ? (
          <div className="connection-card">
            <p>Stow and restore work without GitHub. Connect only for cross-device synchronization.</p>
            <p className="help-text">Tabstow uses GitHub Device Flow and requests only the <code>gist</code> scope.</p>
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
            {showManualSyncActions ? (
              <p className="help-text">
                Pull and Push safely merge synchronized data instead of replacing local data.
              </p>
            ) : null}
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
              {showManualSyncActions ? (
                <>
                  <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:pull')}>
                    <DownloadCloud size={16} aria-hidden="true" /> Pull
                  </button>
                  <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:push')}>
                    <UploadCloud size={16} aria-hidden="true" /> Push
                  </button>
                </>
              ) : null}
              {showRetryAction ? (
                <button type="button" className="secondary-button" disabled={disabled} onClick={() => void runSync('sync:retry')}>
                  <RefreshCcw size={16} aria-hidden="true" /> Retry now
                </button>
              ) : null}
              {showOpenGistAction ? (
                <button type="button" className="secondary-button" onClick={() => openExternal(confirmedBinding.htmlUrl)}>
                  <ExternalLink size={16} aria-hidden="true" /> Open Gist
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {visibleBinding?.public && connection.phase !== 'needs-confirmation' ? (
          <p className="danger-text">The selected Gist is public.</p>
        ) : null}

        {canDisconnect ? (
          <div className="connection-card connection-management">
            <strong>Connection management</strong>
            <div className="inline-actions">
              {showChooseAnotherAction ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={disabled}
                  onClick={() => void runConnectionAction('choose-another', { type: 'gist:choose-another' })}
                >
                  Choose another Gist
                </button>
              ) : null}
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
            <p className="help-text">
              Disconnect removes access from this device only.{' '}
              <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">
                Manage or revoke this OAuth App on GitHub
              </a>
              .
            </p>
          </div>
        ) : null}

      </section>

      <section className="settings-section" aria-labelledby="behavior-heading">
        <h2 id="behavior-heading">Stow preferences</h2>
        <p className="help-text settings-section-copy">
          These preferences are saved only when you choose Save preferences. When GitHub sync is connected, they also synchronize across devices.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settingsDraft.includePinnedTabs}
            onChange={(event) => updateField('includePinnedTabs', event.target.checked)}
            disabled={!settingsForm || busyAction === 'save'}
          />
          Save pinned tabs when stowing
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settingsDraft.closePinnedTabs}
            onChange={(event) => updateField('closePinnedTabs', event.target.checked)}
            disabled={!settingsForm || busyAction === 'save' || !settingsDraft.includePinnedTabs}
          />
          Close pinned tabs after saving
        </label>
        <div className="settings-save-row">
          <p className="settings-save-state" id="settings-save-state" aria-live="polite">
            {settingsSaveState}
          </p>
          <button
            type="button"
            className="primary-button"
            aria-describedby="settings-save-state"
            onClick={() => void saveSettings()}
            disabled={disabled || !settingsDirty}
          >
            <Save size={16} aria-hidden="true" /> Save preferences
          </button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="advanced-heading">
        <h2 id="advanced-heading">Advanced / diagnostics</h2>
        <details className="diagnostics-disclosure">
          <summary>Device diagnostics</summary>
          <div className="diagnostics-content">
            <div>
              <strong>Device ID</strong>
              <p className="device-id">{settingsDraft.deviceId || 'Device ID will be created automatically.'}</p>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={!settingsDraft.deviceId}
              onClick={() => void copyDeviceId()}
            >
              <Copy size={16} aria-hidden="true" /> Copy Device ID
            </button>
          </div>
          <p className="help-text diagnostics-note">
            This identifier is owned by this device and is never imported or replaced by synchronization.
          </p>
        </details>
      </section>

    </UtilityPageShell>
  );
}
