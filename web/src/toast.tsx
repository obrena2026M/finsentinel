import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Audit toast (UX §6): every mutating action shows "Recorded in history".

type Toast = { id: number; text: string; kind: 'info' | 'success' | 'danger' };

type ToastApi = { show: (text: string, kind?: Toast['kind']) => void; recorded: () => void };

const ToastContext = createContext<ToastApi>({ show: () => undefined, recorded: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ show, recorded: () => show('Recorded in history', 'success') }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="status">
            <span aria-hidden="true">{t.kind === 'danger' ? '✗' : '✓'}</span> {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
