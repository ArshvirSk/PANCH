'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ButtonSpinner } from './Spinner';
import { Icon, type IconName } from './Icon';

interface Props {
  open: boolean;
  title: string;
  icon?: IconName;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Confirmation step for irreversible actions (funding, disputing, submitting).
 * Uses the native <dialog> element: focus trapping, Escape and the backdrop come for free.
 */
export function ConfirmDialog({ open, title, icon = 'info', children, confirmLabel, tone = 'primary', busy = false, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === ref.current && !busy) onCancel();
      }}
    >
      <div className="dialog-body">
        <span className={`dialog-icon dialog-icon-${tone}`}><Icon name={icon} size={22} /></span>
        <h2 id={titleId} className="dialog-title">{title}</h2>
        {children && <div className="dialog-text">{children}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy} data-testid="dialog-confirm">
            {busy && <ButtonSpinner />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
