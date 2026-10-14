// 곧 진행될 단체 일정 (D-day 와 날짜). 누르면 해당 캘린더의 해당 날짜로 이동한다.
import { useEffect, useState } from 'react';
import type { CalendarEvent } from '@/types';
import { diffDays, fmtMD, todayYmd, WEEKDAYS, weekday } from '@/lib/dates';
import { supabase } from '@/lib/supabase';
import { useRouter } from '@/lib/router';
import { textOn } from '@/lib/colors';

export type CalLite = { id: string; name: string; group_color: string };

const uniq = () => Math.random().toString(36).slice(2, 8);

export function dday(start: string) {
  const n = diffDays(todayYmd(), start);
  if (n === 0) return 'D-day';
  if (n > 0) return `D-${n}`;
  return '진행 중';
}

export function UpcomingGroups({
  calendars,
  title = '다가오는 단체 일정',
  limit = 12,
  showCalendar = true,
}: {
  calendars: CalLite[];
  title?: string;
  limit?: number;
  showCalendar?: boolean;
}) {
  const { navigate } = useRouter();
  const [rows, setRows] = useState<CalendarEvent[] | null>(null);
  const idsKey = calendars.map((c) => c.id).join(',');
  const byId = new Map(calendars.map((c) => [c.id, c]));

  useEffect(() => {
    let alive = true;
    const ids = idsKey ? idsKey.split(',') : [];
    const load = async () => {
      if (!ids.length) return setRows([]);
      const { data } = await supabase
        .from('events')
        .select('*')
        .in('calendar_id', ids)
        .eq('is_group', true)
        .gte('end_date', todayYmd())
        .order('start_date')
        .limit(limit);
      if (alive) setRows((data ?? []) as CalendarEvent[]);
    };
    load();
    const ch = supabase
      .channel(`upcoming:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [idsKey, limit]);

  return (
    <section className="upcoming" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
      </header>
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="empty">예정된 단체 일정이 없어요.</p>
      ) : (
        <ul className="up-grid">
          {rows.map((e) => {
            const cal = byId.get(e.calendar_id);
            const color = cal?.group_color ?? '#FF6B35';
            const multi = e.end_date !== e.start_date;
            return (
              <li key={e.id}>
                <button type="button" className="up-card" onClick={() => navigate(`/c/${e.calendar_id}?date=${e.start_date}`)}>
                  <span className="up-top">
                    <span className="up-dday" style={{ background: color, color: textOn(color) }}>
                      {dday(e.start_date)}
                    </span>
                    <span className="up-date">
                      {fmtMD(e.start_date)} ({WEEKDAYS[weekday(e.start_date)]})
                      {multi && ` ~ ${fmtMD(e.end_date)}`}
                      {e.start_time && ` ${e.start_time.slice(0, 5)}`}
                    </span>
                  </span>
                  <span className="up-title">{e.title}</span>
                  {showCalendar && cal && <span className="up-cal muted small">{cal.name}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
