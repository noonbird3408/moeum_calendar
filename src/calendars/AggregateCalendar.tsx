// 메인 화면의 '모음달력': 내가 속한 모든 캘린더의 일정을 한 달력에 합쳐 보여준다.
// PC: 좌측 캘린더 칩(보기/숨기기) + 달력 / 모바일: 상단 칩 가로 스크롤 + 간략 달력
// 메인에서 추가한 일정은 고른 캘린더마다 실제 일정으로 저장되므로 각 캘린더 화면과 바로 연동된다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CalendarEvent, EventInput, Profile } from '@/types';
import { addMonths, isSameMonth, monthGrid, startOfMonth, todayYmd } from '@/lib/dates';
import { useIsMobile } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { expandEvents } from '@/lib/recurrence';
import { useRouter } from '@/lib/router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/ui/Icon';
import { Dot } from '@/ui/controls';
import { groupByDay } from '@/calendar/eventUtils';
import { DaySheet } from '@/calendar/DaySheet';
import { EventFormSheet, type FormTarget } from '@/calendar/EventFormSheet';
import { MobileMonth } from '@/calendar/MobileMonth';
import { MonthGrid } from '@/calendar/MonthGrid';
import { MonthPicker } from '@/calendar/MonthPicker';
import { createEventsIn } from '@/calendar/useCalendarData';

export type CalLite = { id: string; name: string; group_color: string; admin?: boolean };

const uniq = () => Math.random().toString(36).slice(2, 8);

/** side: PC 에서 캘린더 칩 아래(달력 왼쪽)에 붙일 내용, 모바일에서는 달력 아래 */
export function AggregateCalendar({ calendars, side }: { calendars: CalLite[]; side?: ReactNode }) {
  const { userId } = useAuth();
  const { navigate } = useRouter();
  const isMobile = useIsMobile();
  const prefs = usePrefs();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(() => new Map());
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const [form, setForm] = useState<{ key: number; target: FormTarget } | null>(null);

  const days = useMemo(() => monthGrid(month, prefs.weekStart), [month, prefs.weekStart]);
  const from = days[0];
  const to = days[days.length - 1];
  const calMap = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const idsKey = calendars.map((c) => c.id).join(',');

  const load = useCallback(async () => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (!ids.length) {
      setEvents([]);
      return;
    }
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .in('calendar_id', ids)
      .lte('start_date', to)
      .gte('end_date', from);
    if (error || !data) return;
    const rows = data as CalendarEvent[];
    setEvents(rows);

    const authors = [...new Set(rows.map((e) => e.author_id))];
    if (authors.length) {
      const { data: ps } = await supabase.from('profiles').select('id, nickname, color, avatar_url').in('id', authors);
      if (ps) setProfiles(new Map((ps as Profile[]).map((p) => [p.id, p])));
    }
  }, [idsKey, from, to]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

  // 어느 캘린더에서든 일정이 바뀌면 다시 불러온다 (RLS 가 내 캘린더 일정만 전달)
  useEffect(() => {
    const ch = supabase
      .channel(`agg:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => loadRef.current())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const expanded = useMemo(() => expandEvents(events, from, to), [events, from, to]);
  const visible = useMemo(() => expanded.filter((e) => !hidden.has(e.calendar_id)), [expanded, hidden]);
  const byDay = useMemo(() => groupByDay(visible, days), [visible, days]);
  const colorOf = (e: CalendarEvent) => calMap.get(e.calendar_id)?.group_color ?? '#FF6B35';

  const toggle = (id: string) =>
    setHidden((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (calendars.length === 0) {
    return (
      <section className="agg-empty card">
        <p className="empty">참여한 캘린더가 없어요.</p>
      </section>
    );
  }

  const today = todayYmd();
  const addDate = isSameMonth(today, month) ? today : days.find((d) => isSameMonth(d, month))!;
  const calOptions = calendars.map((c) => ({ id: c.id, name: c.name }));
  const adminOf = (id: string) => calMap.get(id)?.admin ?? false;

  const createEvent = async (input: EventInput, ids: string[]) => {
    const rows = await createEventsIn(ids, input, userId);
    await loadRef.current();
    return rows;
  };
  const updateEvent = async (id: string, input: EventInput) => {
    const { error } = await supabase.from('events').update(input).eq('id', id);
    if (error) throw error;
    await loadRef.current();
  };

  const chipList = (
    <div className="agg-chips" role="group" aria-label="보기/숨기기 캘린더">
      {calendars.map((c) => {
        const on = !hidden.has(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={`cal-chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => toggle(c.id)}
            style={on ? { borderColor: c.group_color } : undefined}
          >
            <Dot color={on ? c.group_color : 'var(--fg-faint)'} size={10} />
            <span className="cal-chip-name">{c.name}</span>
          </button>
        );
      })}
    </div>
  );

  const grid = isMobile ? (
    <MobileMonth month={month} days={days} byDay={byDay} groupColor="#FF6B35" groupColorOf={colorOf} weekStart={prefs.weekStart} onOpenDay={setDaySheet} />
  ) : (
    <MonthGrid
      month={month}
      days={days}
      byDay={byDay}
      profiles={profiles}
      groupColor="#FF6B35"
      groupColorOf={colorOf}
      grayPersonal={prefs.grayPersonal}
      weekStart={prefs.weekStart}
      onOpenDay={setDaySheet}
      onOpenEvent={(e) => navigate(`/c/${e.calendar_id}?date=${e.start_date}`)}
    />
  );

  const bar = (
    <div className="agg-bar">
      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => setMonth((m) => addMonths(m, -1))}>
          <Icon name="chevron-left" />
        </button>
        <button type="button" className="ym" onClick={() => setPickerOpen(true)} aria-label="년·월 선택">
          <span className="ym-year">{month.getFullYear()}년</span>
          <span className="ym-month">{month.getMonth() + 1}월</span>
        </button>
        <button type="button" className="icon-btn" aria-label="다음 달" onClick={() => setMonth((m) => addMonths(m, 1))}>
          <Icon name="chevron-right" />
        </button>
      </div>
      <button type="button" className="btn btn-primary btn-add" onClick={() => setForm({ key: Date.now(), target: { date: addDate } })}>
        <Icon name="plus" size={18} /> 일정 추가
      </button>
    </div>
  );

  return (
    <section className="agg" aria-label="모음달력">
      {isMobile ? (
        <>
          {bar}
          <div className="agg-chips-scroll">{chipList}</div>
          {grid}
          {side}
        </>
      ) : (
        <div className="agg-layout">
          <aside className="agg-side">
            <h3 className="agg-side-title">내 캘린더</h3>
            {chipList}
            {side}
          </aside>
          <div className="agg-main">
            {bar}
            {grid}
          </div>
        </div>
      )}

      <DaySheet
        date={daySheet}
        events={daySheet ? (byDay.get(daySheet) ?? []) : []}
        profiles={profiles}
        groupColor="#FF6B35"
        groupColorOf={colorOf}
        grayPersonal={prefs.grayPersonal}
        isAdmin={false}
        onClose={() => setDaySheet(null)}
        onOpenEvent={(e) => navigate(`/c/${e.calendar_id}?date=${e.start_date}`)}
        onAdd={(date) => {
          setDaySheet(null);
          setForm({ key: Date.now(), target: { date } });
        }}
      />
      {form && (
        <EventFormSheet
          key={form.key}
          target={form.target}
          calendars={calOptions}
          defaultCalendarId={calendars[0].id}
          adminOf={adminOf}
          allowGroup={false}
          onClose={() => setForm(null)}
          onCreate={createEvent}
          onUpdate={updateEvent}
        />
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
    </section>
  );
}
