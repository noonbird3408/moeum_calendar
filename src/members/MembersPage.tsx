import { useState } from 'react';
import type { Member } from '@/types';
import { useAuth } from '@/auth/AuthProvider';
import { GRAY, textOn } from '@/lib/colors';
import { errorMessage } from '@/lib/supabase';
import { Link, useRouter } from '@/lib/router';
import { useCalendarMeta } from '@/calendar/useCalendarData';
import { orderMembers } from '@/calendar/SidePanels';
import { Splash } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';

export function MembersPage({ calendarId }: { calendarId: string }) {
  const { userId } = useAuth();
  const { navigate } = useRouter();
  const { toast, confirm } = useFeedback();
  const meta = useCalendarMeta(calendarId, userId, () => {
    toast('이 캘린더의 멤버가 아니게 되었어요.', 'info');
    navigate('/', { replace: true });
  });
  const [busy, setBusy] = useState<string | null>(null);

  if (meta.status === 'loading') return <Splash />;
  if (meta.status !== 'ready' || !meta.calendar) {
    return (
      <main className="center-page">
        <div className="login-card">
          <h1>멤버 정보를 열 수 없어요</h1>
          <Link to="/" className="btn btn-primary">
            내 캘린더로
          </Link>
        </div>
      </main>
    );
  }

  const cal = meta.calendar;
  const isAdmin = meta.isAdmin;

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

  const toggleRole = (m: Member) => {
    const next = m.role === 'admin' ? 'member' : 'admin';
    run(m.user_id, () => meta.setRole(m.user_id, next), next === 'admin' ? '관리자로 지정했어요.' : '관리자에서 해제했어요.');
  };

  const kick = async (m: Member) => {
    const n = await meta.countEventsBy(m.user_id);
    const ok = await confirm({
      title: `${m.profile?.nickname ?? '멤버'}님을 내보낼까요?`,
      message: (
        <>
          작성한 일정 <b>{n}개</b>도 함께 삭제돼요. 초대코드를 알고 있으면 다시 들어올 수 있으니, 필요하면 내보낸 뒤 초대코드를 새로 만드세요.
        </>
      ),
      confirmText: '내보내기',
      danger: true,
    });
    if (ok) run(m.user_id, () => meta.removeMember(m.user_id), '멤버를 내보냈어요.');
  };

  return (
    <div className="page narrow">
      <header className="topbar">
        <Link to={`/c/${calendarId}`} className="icon-btn" ariaLabel="캘린더로 돌아가기">
          <Icon name="chevron-left" />
        </Link>
        <div className="cal-name">
          <span>멤버 · {cal.name}</span>
        </div>
        <div className="top-actions" />
      </header>

      <section className="card">
        <h2 className="card-title">
          멤버 <span className="muted">{meta.members.length}명</span>
        </h2>
        <ul className="member-list">
          {orderMembers(meta.members, userId, new Set()).map((m) => {
            const color = m.profile?.color ?? GRAY;
            const me = m.user_id === userId;
            return (
              <li key={m.user_id} className="member">
                <span className="avatar" style={{ background: color, color: textOn(color) }}>
                  {[...(m.profile?.nickname ?? '?')][0]}
                </span>
                <div className="member-main">
                  <div className="member-name">
                    {m.profile?.nickname ?? '(이름 없음)'}
                    {me && <span className="muted small"> (나)</span>}
                    {m.role === 'admin' && <span className="badge badge-admin">관리자</span>}
                  </div>
                  <div className="muted small">{new Date(m.joined_at).toLocaleDateString('ko-KR')} 참여</div>
                </div>
                {isAdmin && !me && (
                  <div className="member-actions">
                    <button type="button" className="btn btn-small btn-ghost" disabled={busy === m.user_id} onClick={() => toggleRole(m)}>
                      {m.role === 'admin' ? '관리자 해제' : '관리자 지정'}
                    </button>
                    <button type="button" className="btn btn-small btn-ghost danger-text" disabled={busy === m.user_id} onClick={() => kick(m)}>
                      내보내기
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="muted small center">캘린더 이름·색·초대·삭제는 캘린더 화면 오른쪽의 ‘캘린더’ 탭에서 관리해요.</p>
    </div>
  );
}
