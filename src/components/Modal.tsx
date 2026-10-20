import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FormStatus { dirty: boolean; busy: boolean }
const ModalContext = createContext<{ setStatus(status: FormStatus): void; requestClose(): void } | null>(null);

/** A native modal: background is inert, focus is trapped, and closing restores the trigger. */
export function Modal({ title, description, wide, compact, onClose, children }: {
  title: string; description?: string; wide?: boolean; compact?: boolean; onClose(): void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [status, setStatus] = useState<FormStatus>({ dirty: false, busy: false });
  const [confirming, setConfirming] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>(".modal-body input:not([type=hidden]):not([disabled]), .modal-body textarea, .modal-body select")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  const context = useMemo(() => ({
    setStatus,
    requestClose() {
      if (status.busy) return;
      if (status.dirty) setConfirming(true);
      else onCloseRef.current();
    },
  }), [status]);
  return createPortal(
    <dialog ref={ref} className={`modal${wide ? " modal-wide" : ""}${compact ? " modal-compact" : ""}`} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(e) => { e.preventDefault(); if (confirming) setConfirming(false); else context.requestClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) context.requestClose(); }}>
      <ModalContext.Provider value={context}>
        <div className="modal-panel">
          <header className="modal-header">
            <div><span className="eyebrow">Expense Tracker</span><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div>
            <button type="button" className="iconbtn modal-close" aria-label="Close dialog" disabled={status.busy} onClick={context.requestClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>
          {confirming && <div className="modal-confirm" role="alert">
            <strong>Discard your changes?</strong><p>Your changes have not been saved yet.</p>
            <div className="headbtns"><button type="button" className="btn primary" onClick={() => setConfirming(false)} autoFocus>Keep editing</button><button type="button" className="btn danger" onClick={() => onCloseRef.current()}>Discard changes</button></div>
          </div>}
          <div className="modal-body" hidden={confirming}>{children}</div>
        </div>
      </ModalContext.Provider>
    </dialog>, document.body,
  );
}

/** Forms report pending writes and unsaved edits to their containing dialog. */
export function useModalForm(dirty: boolean, busy: boolean, fallback: () => void) {
  const context = useContext(ModalContext);
  const setStatus = context?.setStatus;
  useEffect(() => { setStatus?.({ dirty, busy }); }, [dirty, busy, setStatus]);
  return context?.requestClose ?? fallback;
}
