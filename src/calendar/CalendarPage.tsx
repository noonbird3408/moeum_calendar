import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import type { CalendarEvent, Profile } from '@/types';
import { useAuth } from '@/auth/AuthProvider';
import { addMonths, fmtMonthTitle, isSameMonth, monthGrid, parseYmd, startOfMonth, todayYmd } from '@/lib/dates';
import { useIsMobile } from '@/lib/hooks';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { expandEvents } from '@/lib/recurrence';
import { Link, useRouter } from '@/lib/router';
import { computeAvailability, type Chip } from '@/availability/computeAvailability';
import { AvailabilityPanel, HighlightToggles } from '@/availability/AvailabilityChips';
import { AnnouncementsPanel } from './Announcements';
import { CalendarPanel } from './CalendarPanel';
import { Memos } from './Memos';
import { supabase } from '@/lib/supabase';
import { ShareSheet } from '@/calendars/ShareSheet';
import { Icon } from '@/ui/Icon';
import { Dot, Segmented, Splash } from '@/ui/controls';
import { useFeedback } from '@/ui/Feedback';
import { AgendaList } from './AgendaList';
import { DaySheet } from './DaySheet';
import { EventDetailSheet } from './EventDetailSheet';
import { EventFormSheet, type FormTarget } from './EventFormSheet';
import { MobileMonth } from './MobileMonth';
import { MonthGrid, type Highlight } from './MonthGrid';
import { MonthPicker } from './MonthPicker';
import { MembersPanel } from './SidePanels';
import { MyEventsPanel, MyEventsSheet, useMyEvents } from './MyEvents';
import { UpcomingGroups } from './UpcomingGroups';
import { canEditEvent, groupByDay } from './eventUtils';
import { useCalendarMeta, useEvents } from './useCalendarData';
import { usePresence } from './usePresence';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function CalendarPage({ calendarId }: { calendarId: string }) {
  const { userId } = useAuth();
  const { navigate, search } = useRouter();
  const { toast } = useFeedback();
  const prefs = usePrefs();
  const isMobile = useIsMobile();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const days = useMemo(() => monthGrid(month, prefs.weekStart), [month, prefs.weekStart]);
  const inMonth = useMemo(() => days.filter((d) => isSameMonth(d, month)), [days, month]);
  const from = days[0];
  const to = days[days.length - 1];

  const meta = useCalendarMeta(calendarId, userId, () => {
    toast('이 캘린더의 멤버가 아니게 되었어요.', 'info');
    navigate('/', { replace: true });
  });
  const ev = useEvents(calendarId, userId, from, to);
  // 반복(요일) 일정은 화면 기간 안의 실제 회차로 펼쳐서 셀·가능 날짜 계산에 쓴다
  const expanded = useMemo(() => expandEvents(ev.events, from, to), [ev.events, from, to]);
  const myRows = useMyEvents(calendarId, userId, ev.events);
  const memberProfiles = useMemo(() => meta.members.map((m) => m.profile).filter((p): p is Profile => !!p), [meta.members]);
  const byDay = useMemo(() => groupByDay(expanded, days), [expanded, days]);
  const online = usePresence(calendarId, userId);

  const today = todayYmd();
  const chips = useMemo(
    () =>
      computeAvailability(
        expanded,
        inMonth.filter((d) => d >= today),
        { dayStart: prefs.dayStart, dayEnd: prefs.dayEnd, minFree: prefs.minFree },
      ),
    [expanded, inMonth, today, prefs.dayStart, prefs.dayEnd, prefs.minFree],
  );
  const highlight: Highlight = useMemo(
    () => ({
      full: new Set(chips.filter((c) => c.kind === 'full').map((c) => c.date)),
      partial: new Set(chips.filter((c) => c.kind === 'partial').map((c) => c.date)),
      showFull: prefs.showFull,
      showPartial: prefs.showPartial,
    }),
    [chips, prefs.showFull, prefs.showPartial],
  );

  const [daySheet, setDaySheet] = useState<{ date: string; hint?: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // 내 일정 패널처럼 현재 달 밖의 일정을 열 때를 위해 스냅샷을 함께 보관
  const [detailSnap, setDetailSnap] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<{ key: number; target: FormTarget } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [myOpen, setMyOpen] = useState(false);

  const detail = detailId ? (ev.events.find((e) => e.id === detailId) ?? (detailSnap?.id === detailId ? detailSnap : null)) : null;
  const groupColor = meta.calendar?.group_color ?? '#FF6B35';

  useEffect(() => {
    try {
      localStorage.setItem('lastCalendar', calendarId);
    } catch {
      /* noop */
    }
  }, [calendarId]);

  // 메인 화면의 단체 일정에서 넘어온 경우 (?date=YYYY-MM-DD): 그 달을 열고 그날 목록을 연다
  const dateParam = search.get('date');
  useEffect(() => {
    if (!dateParam || !YMD.test(dateParam)) return;
    setMonth(startOfMonth(parseYmd(dateParam)));
    setDaySheet({ date: dateParam });
    navigate(`/c/${calendarId}`, { replace: true });
  }, [dateParam, calendarId, navigate]);

  // 상세를 보고 있던 일정이 다른 사람에 의해 삭제되면 닫기 (보이는 기간 안에서만 판단)
  useEffect(() => {
    if (!detailId || ev.loading || !detailSnap) return;
    const inView = detailSnap.start_date <= to && detailSnap.end_date >= from;
    if (inView && !ev.events.some((e) => e.id === detailId)) setDetailId(null);
  }, [detailId, detailSnap, ev.events, ev.loading, from, to]);

  // 좌우 스와이프로 월 이동
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setMonth((m) => addMonths(m, dx < 0 ? 1 : -1));
  };

  if (meta.status === 'loading') return <Splash />;
  if (meta.status === 'missing' || meta.status === 'error') {
    return (
      <main className="center-page">
        <div className="login-card">
          <h1>{meta.status === 'missing' ? '캘린더를 열 수 없어요' : '불러오지 못했어요'}</h1>
          <p className="muted">
            {meta.status === 'missing'
              ? '삭제되었거나 이 캘린더의 멤버가 아니에요. 초대 링크로 다시 참여해 주세요.'
              : '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'}
          </p>
          <div className="btn-row">
            {meta.status === 'error' && (
              <button type="button" className="btn btn-ghost" onClick={() => meta.reload()}>
                다시 시도
              </button>
            )}
            <Link to="/" className="btn btn-primary">
              내 캘린더로
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const addDate = isSameMonth(today, month) ? today : inMonth[0];
  const openForm = (target: FormTarget) => {
    setDaySheet(null);
    setDetailId(null);
    setForm({ key: Date.now(), target });
  };
  const openEvent = (e: CalendarEvent) => {
    setDetailSnap(e);
    setDetailId(e.id);
  };
  // 공지에 태그된 일정: 지금 불러온 목록에 없으면 한 번 읽어 와서 상세를 연다
  const openEventById = async (id: string) => {
    const hit = ev.events.find((e) => e.id === id);
    if (hit) return openEvent(hit);
    const { data } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
    if (data) openEvent(data as CalendarEvent);
    else toast('일정을 찾을 수 없어요. 삭제되었을 수 있어요.', 'error');
  };
  // 내 일정 패널: 그 일정이 있는 달로 옮겨 상세를 연다
  const openFromPanel = (e: CalendarEvent) => {
    const target = startOfMonth(parseYmd(e.start_date));
    if (!isSameMonth(e.start_date, month)) setMonth(target);
    openEvent(e);
  };
  const pickChip = (c: Chip) =>
    setDaySheet({
      date: c.date,
      hint: c.kind === 'full' ? '하루종일 가능' : `${c.range} 가능`,
    });

  const avail = <AvailabilityPanel chips={chips} onPick={pickChip} />;
  const upcoming = (
    <UpcomingGroups calendars={[{ id: calendarId, name: meta.calendar?.name ?? '', group_color: groupColor }]} limit={10} showCalendar={false} />
  );
  const people = (
    <>
      {meta.calendar && (
        <CalendarPanel
          calendar={meta.calendar}
          members={meta.members}
          myId={userId}
          isAdmin={meta.isAdmin}
          onShare={() => setShareOpen(true)}
          onManageMembers={() => navigate(`/c/${calendarId}/members`)}
          onUpdate={meta.updateCalendar}
          onLeave={async () => {
            await meta.removeMember(userId);
            toast('캘린더에서 나왔어요.', 'success');
            navigate('/', { replace: true });
          }}
          onDelete={async () => {
            await meta.deleteCalendar();
            toast('캘린더를 삭제했어요.', 'success');
            navigate('/', { replace: true });
          }}
        />
      )}
      <MembersPanel
        members={meta.members}
        myId={userId}
        online={online}
        isAdmin={meta.isAdmin}
        onManage={() => navigate(`/c/${calendarId}/members`)}
      />
      <MyEventsPanel rows={myRows} onOpen={openFromPanel} onOpenAll={() => setMyOpen(true)} />
      <AnnouncementsPanel calendarId={calendarId} myId={userId} isAdmin={meta.isAdmin} profiles={meta.profiles} onOpenEvent={openEventById} />
    </>
  );
  const calOption = [{ id: calendarId, name: meta.calendar?.name ?? '' }];

  return (
    <div className="page calendar-page">
      <header className="topbar">
        <Link to="/" className="icon-btn" ariaLabel="모음달력 홈">
          <Icon name="home" />
        </Link>
        <div className="cal-name">
          <Dot color={groupColor} size={12} />
          <span>{meta.calendar?.name}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-btn" aria-label="공유" onClick={() => setShareOpen(true)}>
            <Icon name="share" />
          </button>
          <Link to={`/c/${calendarId}/members`} className="icon-btn" ariaLabel="멤버">
            <Icon name="users" />
          </Link>
          <Link to="/settings" className="icon-btn" ariaLabel="설정">
            <Icon name="settings" />
          </Link>
        </div>
      </header>

      <div className="cal-layout">
        {/* PC 좌측: 모두 가능한 날 (모바일에서는 아래쪽) */}
        {!isMobile && (
          <aside className="cal-side cal-side-left">
            {avail}
            {upcoming}
          </aside>
        )}

        <div className="cal-main">
          <div className="month-bar">
            <div className="month-nav">
              <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => setMonth((m) => addMonths(m, -1))}>
                <Icon name="chevron-left" />
              </button>
              <button type="button" className="ym" onClick={() => setPickerOpen(true)} aria-label={`${fmtMonthTitle(month)} — 년·월 선택`}>
                <span className="ym-year">{month.getFullYear()}년</span>
                <span className="ym-month">{month.getMonth() + 1}월</span>
              </button>
              <button type="button" className="icon-btn" aria-label="다음 달" onClick={() => setMonth((m) => addMonths(m, 1))}>
                <Icon name="chevron-right" />
              </button>
            </div>
            {isMobile ? (
              <Segmented
                ariaLabel="보기 방식"
                value={prefs.mobileView}
                onChange={(v) => setPrefs({ mobileView: v })}
                options={[
                  { value: 'month', label: <><Icon name="grid" size={16} /> 달력</> },
                  { value: 'list', label: <><Icon name="list" size={16} /> 목록</> },
                ]}
              />
            ) : (
              <button type="button" className="btn btn-primary btn-add" onClick={() => openForm({ date: addDate })}>
                <Icon name="plus" size={18} /> 일정 추가
              </button>
            )}
          </div>

          <div className="cal-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {!isMobile ? (
              <MonthGrid
                month={month}
                days={days}
                byDay={byDay}
                profiles={meta.profiles}
                groupColor={groupColor}
                grayPersonal={prefs.grayPersonal}
                highlight={highlight}
                weekStart={prefs.weekStart}
                onOpenDay={(d) => setDaySheet({ date: d })}
                onOpenEvent={openEvent}
              />
            ) : prefs.mobileView === 'month' ? (
              <MobileMonth
                month={month}
                days={days}
                byDay={byDay}
                groupColor={groupColor}
                highlight={highlight}
                weekStart={prefs.weekStart}
                onOpenDay={(d) => setDaySheet({ date: d })}
              />
            ) : (
              <AgendaList
                key={month.getTime()}
                monthDays={inMonth}
                byDay={byDay}
                profiles={meta.profiles}
                groupColor={groupColor}
                grayPersonal={prefs.grayPersonal}
                onOpenEvent={openEvent}
                onAdd={(d) => openForm({ date: d })}
              />
            )}
            {ev.loading && <div className="loading-bar" aria-hidden="true" />}
          </div>

          <div className="cal-foot">
            <HighlightToggles showFull={prefs.showFull} showPartial={prefs.showPartial} onChange={(v) => setPrefs(v)} />
          </div>

          {/* 달력 아래: 공용 메모 · 개인 메모 */}
          <Memos calendarId={calendarId} myId={userId} profiles={meta.profiles} />

          {isMobile && upcoming}

          {/* 모바일: 하단에 가능 날짜 → 멤버 → 내 일정 */}
          {isMobile && (
            <div className="cal-bottom">
              {avail}
              {people}
            </div>
          )}
        </div>

        {/* PC 우측: 멤버 목록 → 내 일정 */}
        {!isMobile && <aside className="cal-side cal-side-right">{people}</aside>}
      </div>

      {isMobile && (
        <button type="button" className="fab" aria-label="일정 추가" onClick={() => openForm({ date: addDate })}>
          <Icon name="plus" size={26} />
        </button>
      )}

      <MonthPicker
        open={pickerOpen}
        value={month}
        onPick={(d) => {
          setMonth(startOfMonth(d));
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />

      <DaySheet
        date={daySheet?.date ?? null}
        hint={daySheet?.hint}
        events={daySheet ? (byDay.get(daySheet.date) ?? []) : []}
        profiles={meta.profiles}
        groupColor={groupColor}
        grayPersonal={prefs.grayPersonal}
        isAdmin={meta.isAdmin}
        onClose={() => setDaySheet(null)}
        onOpenEvent={openEvent}
        onAdd={(date, group) => openForm({ date, group })}
      />
      <EventDetailSheet
        event={detail}
        profiles={meta.profiles}
        groupColor={groupColor}
        myId={userId}
        canEdit={detail ? canEditEvent(detail, userId, meta.isAdmin) : false}
        isAdmin={meta.isAdmin}
        onClose={() => setDetailId(null)}
        onEdit={(e) => openForm({ event: e })}
        onDelete={ev.remove}
      />
      <MyEventsSheet
        open={myOpen}
        rows={myRows}
        onClose={() => setMyOpen(false)}
        // 전체 보기 시트는 열어 둔 채 위에 상세·수정 시트를 띄운다 (닫으면 목록으로 돌아온다)
        onOpen={openEvent}
        onEdit={(e) => openForm({ event: e })}
        onAdd={() => openForm({ date: addDate })}
      />
      {form && (
        <EventFormSheet
          key={form.key}
          target={form.target}
          calendars={calOption}
          defaultCalendarId={calendarId}
          adminOf={() => meta.isAdmin}
          members={memberProfiles}
          onClose={() => setForm(null)}
          onCreate={ev.create}
          onUpdate={ev.update}
        />
      )}
      <ShareSheet
        open={shareOpen}
        calendar={meta.calendar}
        isAdmin={meta.isAdmin}
        onClose={() => setShareOpen(false)}
        onRegenerate={meta.regenerateCode}
      />
    </div>
  );
}
