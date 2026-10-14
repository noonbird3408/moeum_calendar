// 토스트 + 확인 대화상자 (전역)
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';

type ToastKind = 'info' | 'error' | 'success';
type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** 이 문자열을 정확히 입력해야 확인 버튼 활성화 (캘린더 삭제 등) */
  requireText?: string;
};

type FeedbackValue = {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: ToastKind }[]>([]);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setTyped('');
    setDialog(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setDialog(null);
  };

  const blocked = Boolean(dialog?.requireText) && typed.trim() !== dialog?.requireText;

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
      <Sheet
        open={dialog !== null}
        onClose={() => close(false)}
        title={dialog?.title ?? ''}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className={`btn ${dialog?.danger ? 'btn-danger' : 'btn-primary'}`}
              disabled={blocked}
              onClick={() => close(true)}
            >
              {dialog?.confirmText ?? '확인'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
              취소
            </button>
          </>
        }
      >
        {dialog?.message && <div className="confirm-message">{dialog.message}</div>}
        {dialog?.requireText && (
          <label className="field">
            <span className="field-label">확인을 위해 「{dialog.requireText}」를 입력하세요</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
        )}
      </Sheet>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('FeedbackProvider 가 필요합니다');
  return ctx;
}
