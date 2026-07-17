import { X } from 'lucide-react';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

type ModalDialogProps = {
  actions?: ReactNode;
  backdropClassName?: string;
  busy?: boolean;
  children: ReactNode;
  closeLabel: string;
  describedBy?: string;
  description?: string;
  id?: string;
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

type ModalStackEntry = {
  id: symbol;
  backdrop: HTMLElement;
  surface: HTMLElement;
};

const modalStack: ModalStackEntry[] = [];
let isolatedRoot: { element: HTMLElement; wasInert: boolean } | null = null;

function syncModalStack(): void {
  const top = modalStack.at(-1);
  for (const entry of modalStack) {
    if (entry === top) entry.backdrop.removeAttribute('inert');
    else entry.backdrop.setAttribute('inert', '');
  }
}

function registerModal(entry: ModalStackEntry): () => void {
  if (modalStack.length === 0) {
    const root = document.querySelector<HTMLElement>('#root');
    if (root) {
      isolatedRoot = { element: root, wasInert: root.hasAttribute('inert') };
      root.setAttribute('inert', '');
    }
  }

  // The last body portal owns interaction; lower portals and #root stay inert until it closes.
  modalStack.push(entry);
  syncModalStack();

  return () => {
    const index = modalStack.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) return;
    modalStack.splice(index, 1);
    syncModalStack();
    if (modalStack.length > 0) return;
    if (isolatedRoot && !isolatedRoot.wasInert) {
      isolatedRoot.element.removeAttribute('inert');
    }
    isolatedRoot = null;
  };
}

function isTopModal(id: symbol): boolean {
  return modalStack.at(-1)?.id === id;
}

function focusInside(surface: HTMLElement): boolean {
  const target =
    surface.querySelector<HTMLElement>('.dialog-body')?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ?? surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ?? surface;
  target.focus();
  return document.activeElement === target;
}

function restoreFocus(previousFocus: HTMLElement | null): void {
  if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) {
    previousFocus.focus();
    if (document.activeElement === previousFocus) return;
  }

  const remainingModal = modalStack.at(-1);
  if (remainingModal && focusInside(remainingModal.surface)) return;

  const root = document.querySelector<HTMLElement>('#root');
  const fallback = root?.hasAttribute('inert')
    ? null
    : root?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (fallback) fallback.focus();
  else document.body.focus();
}

export function ModalDialog({
  actions,
  backdropClassName,
  busy = false,
  children,
  closeLabel,
  describedBy,
  description,
  id,
  initialFocusRef,
  onClose,
  surfaceClassName,
  title,
}: ModalDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const modalId = useRef(Symbol('modal-dialog'));
  const backdropRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const ariaDescribedBy = [description ? descriptionId : null, describedBy]
    .filter(Boolean)
    .join(' ') || undefined;

  useLayoutEffect(() => registerModal({
    id: modalId.current,
    backdrop: backdropRef.current!,
    surface: surfaceRef.current!,
  }), []);

  useEffect(() => {
    const target =
      initialFocusRef?.current ??
      surfaceRef.current
        ?.querySelector<HTMLElement>('.dialog-body')
        ?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      surfaceRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      surfaceRef.current;
    target?.focus();

    return () => restoreFocus(previousFocusRef.current);
  }, [initialFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopModal(modalId.current)) return;

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
      if (!surfaceRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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

  return createPortal(
    <div
      className={`dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
      onMouseDown={(event) => {
        if (isTopModal(modalId.current) && !busy && event.target === event.currentTarget) onClose();
      }}
      ref={backdropRef}
    >
      <section
        aria-describedby={ariaDescribedBy}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-dialog${surfaceClassName ? ` ${surfaceClassName}` : ''}`}
        id={id}
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
            onClick={() => {
              if (isTopModal(modalId.current)) onClose();
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </section>
    </div>,
    document.body,
  );
}
