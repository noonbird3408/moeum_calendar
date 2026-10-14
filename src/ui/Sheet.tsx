// 모바일은 아래에서 올라오는 바텀시트, 데스크톱은 가운데 다이얼로그.
import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 제목 오른쪽(닫기 버튼 앞)에 붙는 작은 버튼들 */
  actions?: ReactNode;
  size?: 'md' | 'sm' | 'lg';
};

let openCount = 0;
// 겹쳐 열린 시트 중 맨 위 것만 Esc 로 닫히도록 순서를 기억한다
const stack: symbol[] = [];

export function Sheet({ open, onClose, title, children, footer, actions, size = 'md' }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = Symbol('sheet');
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== me) return;
      e.stopImmediatePropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    openCount += 1;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(me), 1);
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = '';
      prevFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // 손잡이를 아래로 끌어 닫기 (모바일)
  const onTouchStart = (e: TouchEvent) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!drag.current || !panel.current) return;
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    panel.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onTouchEnd = () => {
    if (!drag.current || !panel.current) return;
    const closeIt = drag.current.dy > 90;
    panel.current.style.transform = '';
    drag.current = null;
    if (closeIt) onClose();
  };

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <div
        ref={panel}
        className={`sheet sheet-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <span />
        </div>
        <header className="sheet-head">
          <h2>{title}</h2>
          {actions && <div className="sheet-actions">{actions}</div>}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
