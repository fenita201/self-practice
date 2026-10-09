import { useEffect, type ReactNode } from 'react';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="btn ghost icon" onClick={props.onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.actions && <div className="modal-actions">{props.actions}</div>}
      </div>
    </div>
  );
}
