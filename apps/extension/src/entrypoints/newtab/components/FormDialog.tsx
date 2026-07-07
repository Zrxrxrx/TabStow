import { X } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';

export type FormDialogProps = {
  cancelLabel: string;
  children: ReactNode;
  description?: string;
  errorMessage?: string | null;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitDisabled?: boolean;
  submitting?: boolean;
  title: string;
};

export function FormDialog({
  cancelLabel,
  children,
  description,
  errorMessage,
  initialFocusRef,
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled = false,
  submitting = false,
  title,
}: FormDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const describedBy = [description ? descriptionId : null, errorMessage ? errorId : null]
    .filter(Boolean)
    .join(' ')
    || undefined;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyFocusSelector =
      '.dialog-body input:not([disabled]), .dialog-body textarea:not([disabled]), .dialog-body select:not([disabled]), .dialog-body button:not([disabled]), .dialog-body [tabindex]:not([tabindex="-1"])';
    const dialogFocusSelector =
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const fallbackFocus =
      dialogRef.current?.querySelector<HTMLElement>(bodyFocusSelector) ??
      dialogRef.current?.querySelector<HTMLElement>(dialogFocusSelector);
    const target = initialFocusRef?.current ?? fallbackFocus;
    target?.focus();

    return () => {
      previousFocusRef.current?.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (
        dialogRef.current &&
        event.target instanceof Node &&
        !dialogRef.current.contains(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }

    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitDisabled) return;
    void onSubmit();
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        aria-describedby={describedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className="form-dialog"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <p className="subtle" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" className="icon-button" aria-label={cancelLabel} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="dialog-body">{children}</div>

        {errorMessage ? (
          <p className="status-message status-message--error" id={errorId} role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </button>
          <button type="submit" className="primary-button" disabled={submitting || submitDisabled}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
