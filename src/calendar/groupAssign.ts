// 단체 일정 참여 멤버 지정: 충돌 검사 · 참여 명단 동기화
import { addDays, diffDays, toMin } from '@/lib/dates';
import { expandEvents } from '@/lib/recurrence';
import { supabase } from '@/lib/supabase';
import type { CalendarEvent } from '@/types';

export type Slot = { start_date: string; end_date: string; start_time: string | null; end_time: string | null };
export type Conflict = { userId: string; title: string; date: string; time: string };

/** 하루 안에서 일정이 차지하는 구간(분). 여러 날 시간 일정은 첫날 시작~24시, 마지막 날 0시~종료 (availability 와 같은 규칙) */
const dayWindow = (day: string, e: Slot): [number, number] => {
  if (!e.start_time || !e.end_time) return [0, 1440];
  return [day === e.start_date ? toMin(e.start_time) : 0, day === e.end_date ? toMin(e.end_time) : 1440];
};

/** 후보 일정과 시간이 겹치는 '개인 일정'을 가진 멤버를 찾는다. 반복 일정은 회차로 펼쳐서 본다. */
export async function findConflicts(calendarId: string, userIds: string[], cand: Slot, nameOf: (id: string) => string): Promise<Conflict[]> {
  if (!userIds.length) return [];
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('calendar_id', calendarId)
    .eq('is_group', false)
    .in('author_id', userIds)
    .lte('start_date', cand.end_date)
    .gte('end_date', cand.start_date);
  if (error) throw error;
  const rows = expandEvents((data ?? []) as CalendarEvent[], cand.start_date, cand.end_date);
  const out: Conflict[] = [];
  for (const e of rows) {
    const from = e.start_date > cand.start_date ? e.start_date : cand.start_date;
    const to = e.end_date < cand.end_date ? e.end_date : cand.end_date;
    if (from > to) continue;
    for (let d = from, n = diffDays(from, to); n >= 0; n--, d = addDays(d, 1)) {
      const [cs, ce] = dayWindow(d, cand);
      const [es, ee] = dayWindow(d, e);
      if (Math.max(cs, es) < Math.min(ce, ee)) {
        out.push({ userId: e.author_id, title: e.title, date: d, time: e.start_time ? `${e.start_time.slice(0, 5)}~${(e.end_time ?? '').slice(0, 5)}` : '하루종일' });
        break; // 같은 일정에서는 첫 겹침만 알려 준다
      }
    }
  }
  // 같은 사람에게 여러 개가 겹치면 모두 보여 준다 (이름은 호출 쪽에서 붙인다)
  return out.map((c) => ({ ...c, title: `${nameOf(c.userId)} · ${c.title}` }));
}

export async function loadParticipantIds(eventId: string): Promise<string[]> {
  const { data, error } = await supabase.from('event_participants').select('user_id').eq('event_id', eventId);
  if (error) throw error;
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

/** 참여 명단을 원하는 목록에 맞춘다 (빠진 사람은 지우고, 새 사람은 추가) */
export async function syncParticipants(eventId: string, desired: string[], current: string[]) {
  const add = desired.filter((u) => !current.includes(u));
  const remove = current.filter((u) => !desired.includes(u));
  if (remove.length) {
    const { error } = await supabase.from('event_participants').delete().eq('event_id', eventId).in('user_id', remove);
    if (error) throw error;
  }
  if (add.length) {
    const { error } = await supabase.from('event_participants').insert(add.map((user_id) => ({ event_id: eventId, user_id })));
    if (error) throw error;
  }
}
