import { Button } from './ui/Controls.tsx';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Native modal shared by Preferences and project controls. */
export default function ModalDialog({ title, closeLabel, className = '', onClose, children }: {
  title: string; closeLabel: string; className?: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); };
  }, []);
  return <dialog ref={dialog} className={`dialog preferences-dialog ${className}`} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      )).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <div className="dialog-heading"><h2 id={heading}>{title}</h2>
      <Button autoFocus variant="icon" aria-label={closeLabel} onClick={onClose}><Icon name="close" /></Button>
    </div>
    {children}
  </dialog>;
}
