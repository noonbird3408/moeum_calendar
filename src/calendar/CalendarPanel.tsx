// 캘린더 탭: 달력 오른쪽 맨 위. 이름·초대코드를 보여 주고, 설정 시트에서 캘린더를 관리한다.
//  · 관리자: 이름·강조색 변경, 초대코드 재발급, 일정 내보내기, 캘린더 삭제
//  · 멤버: 정보 보기, 초대 링크 공유, 일정 내보내기, 캘린더 나가기
import { useState } from 'react';
import type { Calendar, Member } from '@/types';
import { GROUP_COLORS, textOn } from '@/lib/colors';
import { buildIcs, downloadText } from '@/lib/ics';
import { errorMessage, supabase } from '@/lib/supabase';
import { todayYmd } from '@/lib/dates';
import { inviteUrl } from '@/calendars/ShareSheet';
import { ColorPicker } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/Feedback';
import type { CalendarEvent } from '@/types';

type Patch = { name?: string; group_color?: string };

type Props = {
  calendar: Calendar;
  members: Member[];
  myId: string;
  isAdmin: boolean;
  onShare: () => void;
  onManageMembers: () => void;
  onUpdate: (patch: Patch) => Promise<void>;
  onLeave: () => Promise<void>;
  onDelete: () => Promise<void>;
};

export function CalendarPanel(props: Props) {
  const { calendar: cal, isAdmin, onShare } = props;
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(cal.invite_code));
      toast('초대 링크를 복사했어요.', 'success');
    } catch {
      toast('복사하지 못했어요. 공유 버튼을 이용해 주세요.', 'error');
    }
  };

  return (
    <section className="panel cal-panel" aria-label="캘린더">
      <header className="panel-head">
        <h2>캘린더</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen(true)}>
          <Icon name="settings" size={14} /> {isAdmin ? '관리' : '정보'}
        </button>
      </header>
      <div className="cal-panel-id">
        <span className="cal-swatch" style={{ background: cal.group_color, color: textOn(cal.group_color) }}>
          {[...cal.name][0]}
        </span>
        <div className="cal-panel-text">
          <b>{cal.name}</b>
        </div>
      </div>
      <div className="cal-panel-code">
        <span className="code-chip" aria-label="초대코드">
          {cal.invite_code}
        </span>
        <button type="button" className="mini-act" onClick={copy}>
          <Icon name="link" size={14} /> 링크 복사
        </button>
        <button type="button" className="mini-act" onClick={onShare}>
          <Icon name="share" size={14} /> 공유
        </button>
      </div>
      {open && <CalendarSettingsSheet {...props} onClose={() => setOpen(false)} />}
    </section>
  );
}

function CalendarSettingsSheet({ calendar: cal, members, isAdmin, onShare, onManageMembers, onUpdate, onLeave, onDelete, onClose }: Props & { onClose: () => void }) {
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(cal.name);
  const [color, setColor] = useState(cal.group_color);
  const [busy, setBusy] = useState<string | null>(null);
  const admins = members.filter((m) => m.role === 'admin').length;
  const soleAdmin = isAdmin && admins === 1;
  const dirty = name.trim() !== cal.name || color !== cal.group_color;

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    if (!name.trim()) return toast('캘린더 이름을 입력해 주세요.', 'error');
    run('save', () => onUpdate({ name: name.trim(), group_color: color }), '캘린더 설정을 저장했어요.');
  };

  const exportIcs = () =>
    run('ics', async () => {
      const { data, error } = await supabase.from('events').select('*').eq('calendar_id', cal.id).order('start_date');
      if (error) throw error;
      const rows = (data ?? []) as CalendarEvent[];
      if (!rows.length) throw new Error('내보낼 일정이 없어요.');
      downloadText(`${cal.name}-${todayYmd()}.ics`, buildIcs(rows, () => cal.name));
    }, '일정을 내보냈어요.');

  const leave = async () => {
    const ok = await confirm({ title: '캘린더에서 나갈까요?', message: '내가 작성한 이 캘린더의 일정은 모두 삭제돼요.', confirmText: '나가기', danger: true });
    if (ok) run('leave', onLeave);
  };

  const remove = async () => {
    const ok = await confirm({
      title: '캘린더를 삭제할까요?',
      message: '모든 멤버·일정·공지·메모·사진이 영구 삭제돼요.',
      confirmText: '영구 삭제',
      danger: true,
      requireText: cal.name,
    });
    if (ok) run('delete', onDelete);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isAdmin ? '캘린더 관리' : '캘린더 정보'}
      footer={
        isAdmin ? (
          <>
            <button type="button" className="btn btn-primary" disabled={!dirty || busy === 'save'} onClick={save}>
              {busy === 'save' ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              취소
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <section className="set-block">
          <h3>기본 정보</h3>
          <label className="field">
            <span className="field-label">이름</span>
            <input className="input" value={name} maxLength={30} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
          </label>
        </section>

        <section className="set-block">
          <h3>강조색</h3>
          <div className="field">
            <span className="field-label">전체 일정 · 캘린더 표시 색</span>
            {isAdmin ? <ColorPicker label="강조색" value={color} colors={GROUP_COLORS} onChange={setColor} /> : <span className="cal-swatch-lg" style={{ background: color }} />}
          </div>
        </section>

        <section className="set-block">
          <h3>초대 · 멤버</h3>
          <div className="row-btns">
            <button type="button" className="row-btn" onClick={onShare}>
              <Icon name="share" size={18} /> 초대 링크·코드 {isAdmin && '(재발급)'}
            </button>
            <button type="button" className="row-btn" onClick={onManageMembers}>
              <Icon name="users" size={18} /> 멤버 목록 <span className="muted">({members.length}명)</span>
            </button>
            <button type="button" className="row-btn" onClick={exportIcs} disabled={busy === 'ics'}>
              <Icon name="calendar" size={18} /> 이 캘린더 일정 내보내기 (.ics)
            </button>
          </div>
        </section>

        <section className="set-block danger-zone">
          <h3>나가기 · 삭제</h3>
          <button type="button" className="btn btn-ghost danger-text btn-block" onClick={leave} disabled={busy === 'leave' || soleAdmin}>
            <Icon name="logout" size={18} /> 캘린더 나가기
          </button>
          {soleAdmin && <p className="muted small">유일한 관리자는 나갈 수 없어요. 다른 멤버를 관리자로 지정하거나 캘린더를 삭제하세요.</p>}
          {isAdmin && (
            <button type="button" className="btn btn-danger btn-block" onClick={remove} disabled={busy === 'delete'}>
              <Icon name="trash" size={18} /> 캘린더 삭제
            </button>
          )}
        </section>
      </div>
    </Sheet>
  );
}
