import { useState } from 'react';
import type { Calendar } from '@/types';
import { copyText } from '@/lib/hooks';
import { errorMessage } from '@/lib/supabase';
import { Sheet } from '@/ui/Sheet';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';

export const inviteUrl = (code: string) => `${window.location.origin}/join/${code}`;

type Props = {
  open: boolean;
  calendar: Calendar | null;
  isAdmin: boolean;
  onClose: () => void;
  onRegenerate: () => Promise<string>;
};

export function ShareSheet({ open, calendar, isAdmin, onClose, onRegenerate }: Props) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  if (!calendar) return null;
  const url = inviteUrl(calendar.invite_code);
  const canShare = typeof navigator.share === 'function';

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) toast(`${what}를 복사했어요.`, 'success');
  };

  const share = async () => {
    try {
      await navigator.share({ title: calendar.name, text: `「${calendar.name}」 캘린더에 초대합니다. 초대코드: ${calendar.invite_code}`, url });
    } catch {
      /* 사용자가 취소 */
    }
  };

  const regenerate = async () => {
    const ok = await confirm({
      title: '초대코드를 새로 만들까요?',
      message: '기존 링크와 코드로는 더 이상 들어올 수 없어요. 이미 참여한 멤버는 그대로 유지돼요.',
      confirmText: '새로 만들기',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onRegenerate();
      toast('새 초대코드를 만들었어요.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="캘린더 공유" size="sm">
      <div className="stack">
        <div className="code-box" aria-label="초대코드">
          {calendar.invite_code.split('').map((c, i) => (
            <span key={i}>{c}</span>
          ))}
        </div>
        <div className="copy-row">
          <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="초대 링크" />
          <button type="button" className="btn btn-ghost" onClick={() => copy(url, '링크')}>
            <Icon name="link" size={18} /> 링크 복사
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => copy(calendar.invite_code, '코드')}>
            <Icon name="copy" size={18} /> 코드 복사
          </button>
          {canShare && (
            <button type="button" className="btn btn-primary" onClick={share}>
              <Icon name="share" size={18} /> 공유하기
            </button>
          )}
        </div>
        {isAdmin && (
          <button type="button" className="link-btn small" onClick={regenerate} disabled={busy}>
            <Icon name="refresh" size={14} /> 초대코드 새로 만들기 (기존 링크 무효화)
          </button>
        )}
      </div>
    </Sheet>
  );
}
