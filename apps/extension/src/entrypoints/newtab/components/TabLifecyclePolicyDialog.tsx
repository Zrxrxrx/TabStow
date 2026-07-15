import { useEffect, useRef, useState } from 'react';
import {
  AUTOMATIC_SLEEP_DAY_PRESETS,
  STOW_SUGGESTION_DAY_PRESETS,
  type AutomaticSleepDays,
  type StowSuggestionDays,
  type TabLifecyclePolicy,
  type TabLifecycleState,
} from '@/features/tab-lifecycle/types';
import { t, type Locale } from '@/features/i18n/i18n';
import type { AppResult } from '@/lib/errors';
import { sendExtensionMessage } from '@/lib/messages';
import { FormDialog } from './FormDialog';

type Props = {
  locale: Locale;
  onClose: () => void;
};

export function TabLifecyclePolicyDialog({ locale, onClose }: Props) {
  const [state, setState] = useState<TabLifecycleState | null>(null);
  const [draft, setDraft] = useState<TabLifecyclePolicy | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeRef = useRef(true);
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  async function load(preserveDraft: boolean) {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadError(null);
    const response = await sendExtensionMessage<AppResult<TabLifecycleState>>({
      type: 'tab-lifecycle:get-state',
    });
    if (!activeRef.current || requestId !== loadRequestRef.current) return;
    setLoading(false);
    if (!response.ok) {
      setLoadError(response.error.message);
      return;
    }
    setState(response.data);
    setDraft((current) => preserveDraft && current ? current : response.data.policy);
  }

  useEffect(() => {
    activeRef.current = true;
    void load(false);
    return () => {
      activeRef.current = false;
      loadRequestRef.current += 1;
      previewRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const requestId = ++previewRequestRef.current;
    if (
      !draft?.automaticSleepEnabled
      || state?.automaticSleepCapability.status !== 'supported'
    ) {
      setPreviewCount(null);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    void sendExtensionMessage<AppResult<{ eligibleTabCount: number }>>({
      type: 'tab-lifecycle:preview-auto-sleep',
      afterDays: draft.automaticSleepAfterDays,
    }).then((response) => {
      if (requestId !== previewRequestRef.current) return;
      setPreviewLoading(false);
      setPreviewCount(response.ok ? response.data.eligibleTabCount : null);
    });
  }, [draft?.automaticSleepAfterDays, draft?.automaticSleepEnabled, state?.automaticSleepCapability.status]);

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    const response = await sendExtensionMessage<AppResult<TabLifecycleState>>({
      type: 'tab-lifecycle:update-policy',
      policy: draft,
    });
    if (!activeRef.current) return;
    setSaving(false);
    if (response.ok) {
      onClose();
      return;
    }
    setSaveError(response.error.message);
  }

  return (
    <FormDialog
      cancelLabel={t(locale, 'cancel')}
      description={t(locale, 'tabLifecycleDescription')}
      errorMessage={loadError ?? saveError}
      onCancel={onClose}
      onSubmit={save}
      submitDisabled={!draft || loading}
      submitLabel={t(locale, 'saveSettings')}
      submitting={saving}
      title={t(locale, 'tabLifecycle')}
    >
      {!draft || !state ? (
        <>
          {loading ? <p className="subtle">{t(locale, 'tabLifecycleLoading')}</p> : null}
          {loadError ? (
            <button
              className="secondary-button lifecycle-policy-retry"
              disabled={loading}
              onClick={() => void load(false)}
              type="button"
            >
              {t(locale, 'retry')}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <fieldset aria-label={t(locale, 'automaticSleep')} className="lifecycle-policy-rule">
            <label className="lifecycle-policy-toggle">
              <input
                checked={draft.automaticSleepEnabled}
                disabled={
                  saving
                  || loading
                  || (
                    state.automaticSleepCapability.status !== 'supported'
                    && !draft.automaticSleepEnabled
                  )
                }
                onChange={(event) => setDraft({
                  ...draft,
                  automaticSleepEnabled: event.target.checked,
                })}
                type="checkbox"
              />
              <span>{t(locale, 'automaticSleep')}</span>
            </label>
            <label className="lifecycle-policy-field">
              <span>{t(locale, 'automaticSleepAfter')}</span>
              <select
                disabled={
                  saving
                  || loading
                  || !draft.automaticSleepEnabled
                  || state.automaticSleepCapability.status !== 'supported'
                }
                onChange={(event) => setDraft({
                  ...draft,
                  automaticSleepAfterDays: Number(event.target.value) as AutomaticSleepDays,
                })}
                value={draft.automaticSleepAfterDays}
              >
                {AUTOMATIC_SLEEP_DAY_PRESETS.map((days) => (
                  <option key={days} value={days}>
                    {days === 1 ? t(locale, 'oneDay') : t(locale, 'dayCount', { count: days })}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {state.automaticSleepCapability.status === 'supported' ? (
            <p className="status-message status-message--success" data-capability="supported">
              {t(locale, 'automaticSleepSupported')}
            </p>
          ) : state.automaticSleepCapability.status === 'unsupported' ? (
            <p className="status-message status-message--info" data-capability="unsupported">
              {t(locale, 'automaticSleepUnsupported')}
            </p>
          ) : (
            <div
              className="status-message status-message--error lifecycle-policy-capability"
              data-capability="unavailable"
              role="alert"
            >
              <p>{t(locale, 'automaticSleepUnavailable', {
                message: state.automaticSleepCapability.message,
              })}</p>
              <button
                className="secondary-button"
                disabled={loading}
                onClick={() => void load(true)}
                type="button"
              >
                {t(locale, 'retry')}
              </button>
            </div>
          )}

          {draft.automaticSleepEnabled && state.automaticSleepCapability.status === 'supported' ? (
            <p className="subtle" aria-live="polite">
              {previewLoading
                ? t(locale, 'automaticSleepPreviewLoading')
                : previewCount === null
                  ? null
                  : t(locale, 'automaticSleepPreview', { count: previewCount })}
            </p>
          ) : null}

          <fieldset aria-label={t(locale, 'stowSuggestions')} className="lifecycle-policy-rule">
            <label className="lifecycle-policy-toggle">
              <input
                checked={draft.stowSuggestionsEnabled}
                disabled={saving || loading}
                onChange={(event) => setDraft({
                  ...draft,
                  stowSuggestionsEnabled: event.target.checked,
                })}
                type="checkbox"
              />
              <span>{t(locale, 'stowSuggestions')}</span>
            </label>
            <label className="lifecycle-policy-field">
              <span>{t(locale, 'stowSuggestionsAfter')}</span>
              <select
                disabled={saving || loading || !draft.stowSuggestionsEnabled}
                onChange={(event) => setDraft({
                  ...draft,
                  stowSuggestionAfterDays: Number(event.target.value) as StowSuggestionDays,
                })}
                value={draft.stowSuggestionAfterDays}
              >
                {STOW_SUGGESTION_DAY_PRESETS.map((days) => (
                  <option key={days} value={days}>{t(locale, 'dayCount', { count: days })}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <p className="subtle lifecycle-policy-local-note">{t(locale, 'tabLifecycleDeviceLocal')}</p>
        </>
      )}
    </FormDialog>
  );
}
