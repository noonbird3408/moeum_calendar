// 메인 화면 우측 탭: 내 일정 · 공지사항 (내가 속한 모든 캘린더 기준)
// 탭에는 개수만 보이고, '전체 보기'를 누르면 목록 시트가 열린다.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement, CalendarEvent, EventInput } from '@/types';
import { fmtMD, todayYmd } from '@/lib/dates';
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

/** 내가 등록한 개인 일정 + 내 캘린더들의 진행 중·예정 전체 일정 (오늘 이후) — 정기 일정 먼저, 나머지는 날짜순 */
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
        .or(`is_group.eq.true,and(is_group.eq.false,author_id.eq.${userId})`)
        .gte('end_date', todayYmd())
        .order('start_date')
        .limit(500);
      if (!alive) return;
      const out = (data ?? []) as CalendarEvent[];
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
    const created = await createEventsIn(calIds, input, userId);
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
        calendarName={(id) => byId.get(id)?.name ?? ''}
        canManage={(e) => !e.is_group || adminOf(e.calendar_id)}
        onClose={() => setOpen(false)}
        onOpen={(e) => navigate(`/c/${e.calendar_id}?event=${e.id}`)}
        // 전체 일정은 참여 멤버·사진까지 다루는 캘린더 화면에서 고친다
        onEdit={(e) => (e.is_group ? navigate(`/c/${e.calendar_id}?event=${e.id}`) : setForm({ key: Date.now(), target: { event: e } }))}
        onAdd={() => setForm({ key: Date.now(), target: { date: todayYmd() } })}
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
