// 메인 화면 우측 탭: 내 일정 · 전체 일정 · 공지사항 (내가 속한 모든 캘린더 기준)
// 탭에는 개수만 보이고, '전체 보기'를 누르면 목록 시트가 열린다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement, CalendarEvent, EventInput } from '@/types';
import { fmtMD, fmtMDW, todayYmd } from '@/lib/dates';
import { hasOccurrences, nextOccurrence } from '@/lib/recurrence';
import { dday } from '@/calendar/UpcomingGroups';
import { textOn } from '@/lib/colors';
import { scheduleText } from '@/calendar/eventUtils';
import { useRouter } from '@/lib/router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { EventFormSheet, type FormTarget } from '@/calendar/EventFormSheet';
import { MyEventsSheet } from '@/calendar/MyEvents';
import { NoticeView } from '@/calendar/Announcements';
import { createEventsIn } from '@/calendar/useCalendarData';
import type { CalLite } from './AggregateCalendar';

const uniq = () => Math.random().toString(36).slice(2, 8);

/** 내가 등록한 개인 일정 (모든 캘린더, 오늘 이후) — 정기 일정 먼저, 나머지는 날짜순.
 *  메인에서 쓴 일정은 캘린더마다 복사되어 있으므로 sync_id 가 같은 것은 하나만 보여 준다. */
function useAllMyEvents(ids: string[], userId: string) {
  const [rows, setRows] = useState<CalendarEvent[] | null>(null);
  const key = ids.join(',');
  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(',') : [];
    const load = async () => {
      if (!list.length) return setRows([]);
      const { data } = await supabase
        .from('events')
        .select('*')
        .in('calendar_id', list)
        .eq('author_id', userId)
        .eq('is_group', false)
        .gte('end_date', todayYmd())
        .order('start_date')
        .limit(500);
      if (!alive) return;
      const seen = new Set<string>();
      const out = ((data ?? []) as CalendarEvent[]).filter((e) => {
        if (!e.sync_id) return true;
        if (seen.has(e.sync_id)) return false;
        seen.add(e.sync_id);
        return true;
      });
      out.sort(
        (a, b) =>
          Number(!!b.repeat_weekdays) - Number(!!a.repeat_weekdays) ||
          a.start_date.localeCompare(b.start_date) ||
          (a.start_time ?? '').localeCompare(b.start_time ?? ''),
      );
      setRows(out);
    };
    loadRef.current = load;
    load();
    const ch = supabase
      .channel(`home-mine:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [key, userId]);

  return { rows, reload: () => loadRef.current() };
}

/** 모든 캘린더의 공지 (최신순) */
function useAllNotices(ids: string[]) {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const key = ids.join(',');

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(',') : [];
    const load = async () => {
      if (!list.length) return setRows([]);
      const { data, error } = await supabase
        .from('announcements')
        .select('id, calendar_id, author_id, title, body, body_html, event_id, created_at, updated_at, author:profiles(id, nickname, color, avatar_url)')
        .in('calendar_id', list)
        .order('created_at', { ascending: false })
        .limit(200);
      if (alive && !error) setRows((data ?? []) as unknown as Announcement[]);
    };
    load();
    const ch = supabase
      .channel(`home-notice:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [key]);

  return rows;
}

function CountCard({ title, icon, count, onOpen }: { title: string; icon: string; count: number | null; onOpen: () => void }) {
  return (
    <section className="card count-card" aria-label={title}>
      <span className="count-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="count-text">
        <span className="count-title">{title}</span>
        <span className="count-num">{count === null ? '…' : `${count}개`}</span>
      </span>
      <button type="button" className="btn btn-ghost btn-small" onClick={onOpen} disabled={count === null}>
        전체 보기
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 내 일정                                                             */
/* ------------------------------------------------------------------ */
export function HomeMyEvents({ calendars }: { calendars: CalLite[] }) {
  const { userId } = useAuth();
  const { navigate } = useRouter();
  const ids = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const { rows, reload } = useAllMyEvents(ids, userId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ key: number; target: FormTarget } | null>(null);
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const adminOf = (id: string) => byId.get(id)?.admin ?? false;

  if (!calendars.length) return null;

  const editing = form?.target.event;
  const formCals = editing
    ? [{ id: editing.calendar_id, name: byId.get(editing.calendar_id)?.name ?? '' }]
    : calendars.map((c) => ({ id: c.id, name: c.name }));

  const onCreate = async (input: EventInput, calIds: string[]) => {
    const created = await createEventsIn(calIds, input, userId, true);
    reload();
    return created;
  };
  const onUpdate = async (id: string, input: EventInput) => {
    const { error } = await supabase.from('events').update(input).eq('id', id);
    if (error) throw error;
    reload();
  };

  return (
    <>
      <CountCard title="내 일정" icon="list" count={rows ? rows.length : null} onOpen={() => setOpen(true)} />
      <MyEventsSheet
        open={open && !form}
        rows={rows}
        // 메인에서 쓴(동기화) 일정은 캘린더 하나가 아니라 전체에 있다
        calendarName={(e) => (e.sync_id ? '모든 캘린더' : (byId.get(e.calendar_id)?.name ?? ''))}
        onClose={() => setOpen(false)}
        onOpen={(e) => navigate(`/c/${e.calendar_id}?event=${e.id}`)}
        onEdit={(e) => setForm({ key: Date.now(), target: { event: e } })}
        onAdd={() => setForm({ key: Date.now(), target: {} })}
      />
      {form && (
        <EventFormSheet
          key={form.key}
          target={form.target}
          calendars={formCals}
          defaultCalendarId={editing?.calendar_id ?? calendars[0].id}
          adminOf={adminOf}
          allowGroup={false}
          toAllCalendars
          onClose={() => setForm(null)}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 전체 일정: 내가 참여 멤버로 들어간 단체 일정 (내가 쓴 것 제외, 오늘 이후) */
/* ------------------------------------------------------------------ */
type GroupRow = CalendarEvent & { when: string }; // when: 다가오는 진행 날짜 (반복이면 다음 회차)

function useMyGroupEvents(ids: string[], userId: string) {
  const [rows, setRows] = useState<GroupRow[] | null>(null);
  const key = ids.join(',');

  useEffect(() => {
    let alive = true;
    const list = new Set(key ? key.split(',') : []);
    const load = async () => {
      if (!list.size) return setRows([]);
      const { data } = await supabase.from('event_participants').select('event:events(*)').eq('user_id', userId).limit(500);
      if (!alive) return;
      const today = todayYmd();
      const out: GroupRow[] = [];
      for (const r of (data ?? []) as unknown as { event: CalendarEvent | null }[]) {
        const e = r.event;
        if (!e || !e.is_group || e.author_id === userId || !list.has(e.calendar_id) || e.end_date < today) continue;
        const when = hasOccurrences(e) ? nextOccurrence(e, today) : e.start_date < today ? today : e.start_date;
        if (when) out.push({ ...e, when });
      }
      out.sort((a, b) => a.when.localeCompare(b.when) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
      setRows(out);
    };
    load();
    const ch = supabase
      .channel(`home-group:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_participants' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [key, userId]);

  return rows;
}

export function HomeGroupEvents({ calendars }: { calendars: CalLite[] }) {
  const { userId } = useAuth();
  const { navigate } = useRouter();
  const ids = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const rows = useMyGroupEvents(ids, userId);
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  if (!calendars.length) return null;

  return (
    <>
      <CountCard title="전체 일정" icon="users" count={rows ? rows.length : null} onOpen={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="참여하는 전체 일정" size="md">
        {rows === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="empty">참여 멤버로 들어간 전체 일정이 없어요.</p>
        ) : (
          <ul className="mine-list group-list">
            {rows.map((e) => {
              const cal = byId.get(e.calendar_id);
              const ongoing = !hasOccurrences(e) && e.start_date < e.when;
              return (
                <li key={e.id} className="mine-row">
                  <span className="up-dday group-dday" style={{ background: cal?.group_color ?? '#FF6B35', color: textOn(cal?.group_color ?? '#FF6B35') }}>
                    {ongoing ? '진행 중' : dday(e.when)}
                  </span>
                  <button type="button" className="mine-main" onClick={() => navigate(`/c/${e.calendar_id}?event=${e.id}`)}>
                    <span className="my-title">
                      {e.repeat_weekdays && <span className="badge badge-recur">↻ 정기</span>} {e.title}
                    </span>
                    <span className="my-sub">
                      <b>{hasOccurrences(e) ? `다음 ${fmtMDW(e.when)}` : fmtMDW(e.start_date)}</b>
                      {' · '}
                      {scheduleText(e)}
                      {cal && <span className="mine-cal"> · {cal.name}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 공지사항                                                            */
/* ------------------------------------------------------------------ */
export function HomeNotices({ calendars }: { calendars: CalLite[] }) {
  const { navigate } = useRouter();
  const ids = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const rows = useAllNotices(ids);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const viewing = rows?.find((a) => a.id === viewId) ?? null;

  if (!calendars.length) return null;

  return (
    <>
      <CountCard title="공지사항" icon="mail" count={rows ? rows.length : null} onOpen={() => setOpen(true)} />
      <Sheet open={open && !viewing} onClose={() => setOpen(false)} title="공지사항 전체" size="md">
        {rows === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="empty">공지가 없어요.</p>
        ) : (
          <ul className="notice-list home-notice-list">
            {rows.map((a) => {
              const cal = byId.get(a.calendar_id);
              return (
                <li key={a.id} className="notice-item">
                  <button type="button" className="notice-head" onClick={() => setViewId(a.id)}>
                    <span className="notice-title">
                      {a.event_id && <span className="notice-tag-dot" aria-label="일정 태그" />}
                      {a.title}
                    </span>
                    <span className="notice-meta muted small">
                      {cal && (
                        <span className="notice-cal">
                          <span className="swatch-mini" style={{ background: cal.group_color }} aria-hidden="true" /> {cal.name}
                        </span>
                      )}
                      {fmtMD(a.created_at.slice(0, 10))} · {a.author?.nickname ?? '(알 수 없음)'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
      {viewing && (
        <NoticeView
          item={viewing}
          author={viewing.author ?? null}
          isAdmin={false}
          onClose={() => setViewId(null)}
          onEdit={() => undefined}
          onDelete={() => undefined}
          onOpenEvent={(id) => navigate(`/c/${viewing.calendar_id}?event=${id}`)}
        />
      )}
    </>
  );
}
