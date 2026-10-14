// 메인 화면: 좌측 모음달력 + 그 아래 초대코드 참여 / 우측 프로필 카드 + 내 캘린더 + 내 일정·공지사항 탭 / 하단 다가오는 단체 일정
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Role } from '@/types';
import { useAuth } from '@/auth/AuthProvider';
import { ProfileForm } from '@/auth/ProfileForm';
import { GROUP_COLORS, textOn } from '@/lib/colors';
import { errorMessage, supabase } from '@/lib/supabase';
import { Link, useRouter } from '@/lib/router';
import { ColorPicker, Splash } from '@/ui/controls';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { useFeedback } from '@/ui/Feedback';
import { UpcomingGroups } from '@/calendar/UpcomingGroups';
import { AggregateCalendar, type CalLite } from './AggregateCalendar';
import { HomeGroupEvents, HomeMyEvents, HomeNotices } from './HomePanels';

type Row = { role: Role; joined_at: string; calendar: { id: string; name: string; group_color: string } | null };

export function HomePage() {
  const { userId, profile } = useAuth();
  const { navigate } = useRouter();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const [code, setCode] = useState('');
  const [joinOpen, setJoinOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase
      .from('calendar_members')
      .select('role, joined_at, calendar:calendars(id, name, group_color)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) toast(errorMessage(error), 'error');
        setRows(((data ?? []) as unknown as Row[]).filter((r) => r.calendar));
      });
    return () => {
      alive = false;
    };
  }, [userId, toast]);

  const lite = useMemo<CalLite[]>(
    () => (rows ?? []).map((r) => ({ id: r.calendar!.id, name: r.calendar!.name, group_color: r.calendar!.group_color, admin: r.role === 'admin' })),
    [rows],
  );

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('create_calendar', { p_name: name.trim(), p_color: color });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    toast('캘린더를 만들었어요. 공유 버튼으로 멤버를 초대하세요.', 'success');
    navigate(`/c/${data as string}`);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(c)) return toast('초대코드는 영문·숫자 6자리예요.', 'error');
    navigate(`/join/${c}`);
  };

  if (rows === null) return <Splash />;

  return (
    <div className="page home-page">
      <header className="topbar">
        <div className="cal-name home-title">
          <Icon name="calendar" /> <span>모음달력</span>
        </div>
        <div className="top-actions">
          <Link to="/settings" className="icon-btn" ariaLabel="설정">
            <Icon name="settings" />
          </Link>
        </div>
      </header>

      <div className="home-grid">
        <div className="home-main">
          {/* 다가오는 단체 일정은 달력 왼쪽(내 캘린더 칩 아래)에 붙는다 */}
          <AggregateCalendar calendars={lite} side={<UpcomingGroups calendars={lite} limit={8} />} />
        </div>

        <aside className="home-side">
          {/* 프로필: 내 캘린더 목록 위 */}
          <section className="card profile-card" aria-label="내 프로필">
            <Avatar profile={profile} size={56} />
            <div className="profile-text">
              <span className="profile-name" style={{ color: profile?.color }}>
                {profile?.nickname}
              </span>
              <span className="profile-sub muted small">
                <span className="swatch-mini" style={{ background: profile?.color }} aria-hidden="true" /> 퍼스널 컬러
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setProfileOpen(true)}>
              프로필 확인/수정
            </button>
          </section>

          <section className="card">
            <h2 className="card-title">내 캘린더</h2>
            {rows.length === 0 ? (
              <p className="empty">참여한 캘린더가 없어요.</p>
            ) : (
              <ul className="cal-list">
                {rows.map((r) => (
                  <li key={r.calendar!.id}>
                    <Link to={`/c/${r.calendar!.id}`} className="cal-item">
                      <span className="cal-swatch" style={{ background: r.calendar!.group_color, color: textOn(r.calendar!.group_color) }}>
                        {[...r.calendar!.name][0]}
                      </span>
                      <span className="cal-item-name">{r.calendar!.name}</span>
                      {r.role === 'admin' && <span className="badge badge-admin">관리자</span>}
                      <Icon name="chevron-right" size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-primary btn-block" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={18} /> 새 캘린더 만들기
            </button>
            {/* 초대코드로 참여: 버튼을 누르면 입력 칸이 열린다 */}
            <button
              type="button"
              className="btn btn-ghost btn-block join-toggle"
              aria-expanded={joinOpen}
              onClick={() => setJoinOpen((v) => !v)}
            >
              <Icon name="link" size={18} /> 초대코드로 참여
            </button>
            {joinOpen && (
              <form className="join-inline" onSubmit={join} aria-label="초대코드로 참여">
                <input
                  className="input code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                  placeholder="AB12CD"
                  aria-label="초대코드 6자리"
                  autoCapitalize="characters"
                  autoFocus
                />
                <button className="btn btn-primary" disabled={code.length !== 6}>
                  참여
                </button>
              </form>
            )}
          </section>

          {/* 내 일정 · 전체 일정 · 공지사항: 개수만 보이고 '전체 보기'로 목록을 연다 */}
          <HomeMyEvents calendars={lite} />
          <HomeGroupEvents calendars={lite} />
          <HomeNotices calendars={lite} />
        </aside>
      </div>

      <Sheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="새 캘린더"
        size="sm"
        footer={
          <>
            <button type="submit" form="create-cal" className="btn btn-primary" disabled={!name.trim() || busy}>
              {busy ? '만드는 중…' : '만들기'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)}>
              취소
            </button>
          </>
        }
      >
        <form id="create-cal" className="stack" onSubmit={create}>
          <label className="field">
            <span className="field-label">이름</span>
            <input className="input" value={name} maxLength={30} placeholder="예: 동아리 일정, 가족 캘린더" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <div className="field">
            <span className="field-label">단체 일정 강조색</span>
            <ColorPicker label="단체 일정 강조색" value={color} colors={GROUP_COLORS} onChange={setColor} />
          </div>
        </form>
      </Sheet>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title="프로필" size="sm">
        <ProfileForm submitText="저장" onDone={() => setProfileOpen(false)} />
      </Sheet>
    </div>
  );
}
