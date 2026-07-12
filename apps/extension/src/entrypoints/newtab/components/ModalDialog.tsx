import { X } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';

type Props = {
  actions?: ReactNode;
  busy?: boolean;
  children: ReactNode;
  closeLabel: string;
  describedBy?: string;
  description?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  surfaceClassName?: string;
  title: string;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalDialog({
  actions,
  busy = false,
  children,
  closeLabel,
  describedBy,
  description,
  initialFocusRef,
  onClose,
  surfaceClassName,
  title,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const ariaDescribedBy = [description ? descriptionId : null, describedBy]
    .filter(Boolean)
    .join(' ') || undefined;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target =
      initialFocusRef?.current ??
      surfaceRef.current
        ?.querySelector<HTMLElement>('.dialog-body')
        ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      surfaceRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      surfaceRef.current;
    target?.focus();

    return () => previousFocusRef.current?.focus();
  }, [initialFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const backdrops = document.querySelectorAll('.dialog-backdrop');
      if (backdrops.item(backdrops.length - 1) !== backdropRef.current) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
        return;
      }

      if (event.key !== 'Tab' || !surfaceRef.current) return;
      const focusable = Array.from(
        surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        surfaceRef.current.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [busy, onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      ref={backdropRef}
    >
      <section
        aria-describedby={ariaDescribedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-dialog${surfaceClassName ? ` ${surfaceClassName}` : ''}`}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p className="subtle" id={descriptionId}>{description}</p> : null}
          </div>
          <button
            aria-label={closeLabel}
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </section>
    </div>
  );
}
