import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useId,
} from 'react';
import { ModalDialog } from '@/components/ModalDialog';

export type FormDialogProps = {
  cancelLabel: string;
  children: ReactNode;
  description?: string;
  errorMessage?: string | null;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitAriaDescribedBy?: string;
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
  submitAriaDescribedBy,
  submitLabel,
  submitDisabled = false,
  submitting = false,
  title,
}: FormDialogProps) {
  const formId = useId();
  const errorId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || submitDisabled) return;
    void onSubmit();
  }

  return (
    <ModalDialog
      actions={
        <>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </button>
          <button
            aria-describedby={submitAriaDescribedBy}
            className="primary-button"
            disabled={submitting || submitDisabled}
            form={formId}
            type="submit"
          >
            {submitLabel}
          </button>
        </>
      }
      busy={submitting}
      closeLabel={cancelLabel}
      describedBy={errorMessage ? errorId : undefined}
      description={description}
      initialFocusRef={initialFocusRef}
      onClose={onCancel}
      surfaceClassName="form-dialog"
      title={title}
    >
      <form
        className="dialog-form"
        id={formId}
        onSubmit={submit}
      >
        {children}

        {errorMessage ? (
          <p className="status-message status-message--error" id={errorId} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </ModalDialog>
  );
}
