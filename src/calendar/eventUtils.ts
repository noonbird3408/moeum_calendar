import type { CalendarEvent, Profile } from '@/types';
import { fmtMD, fmtMDFrom, fmtTime } from '@/lib/dates';
import { weekdaysText } from '@/lib/recurrence';

/** 셀 안 정렬: ① 단체 → 개인 ② 종일 → 시간 일정 ③ 시작 시간 ④ 등록 순 */
export const compareEvents = (a: CalendarEvent, b: CalendarEvent) =>
  Number(b.is_group) - Number(a.is_group) ||
  Number(!!a.start_time) - Number(!!b.start_time) ||
  (a.start_time ?? '').localeCompare(b.start_time ?? '') ||
  a.created_at.localeCompare(b.created_at);

/** 날짜별 일정 묶음 (여러 날 일정은 걸친 날마다 포함) */
export function groupByDay(events: CalendarEvent[], days: string[]) {
  const map = new Map<string, CalendarEvent[]>(days.map((d) => [d, []]));
  if (!days.length) return map;
  const first = days[0];
  const last = days[days.length - 1];
  for (const e of events) {
    if (e.end_date < first || e.start_date > last) continue;
    for (const d of days) if (e.start_date <= d && d <= e.end_date) map.get(d)!.push(e);
  }
  map.forEach((list) => list.sort(compareEvents));
  return map;
}

/** 수정/삭제 가능 여부 (최종 판단은 DB RLS) */
export const canEditEvent = (e: CalendarEvent, myId: string, isAdmin: boolean) =>
  isAdmin || (e.author_id === myId && !e.is_group);

/** '18:00~22:00' / '하루종일' */
export const timeRange = (e: CalendarEvent) =>
  e.start_time ? `${fmtTime(e.start_time)}~${fmtTime(e.end_time)}` : '하루종일';

/** 언제부터 언제까지: '10/12 18:00~22:00', '10/12 ~ 10/14 (하루종일)', '10/12 18:00 ~ 10/14 09:00' */
export function periodText(e: CalendarEvent) {
  if (e.start_date === e.end_date) return `${fmtMD(e.start_date)} ${timeRange(e)}`;
  if (!e.start_time) return `${fmtMD(e.start_date)} ~ ${fmtMD(e.end_date)} (하루종일)`;
  return `${fmtMD(e.start_date)} ${fmtTime(e.start_time)} ~ ${fmtMD(e.end_date)} ${fmtTime(e.end_time)}`;
}

export const nicknameOf = (profiles: Map<string, Profile>, id: string) => profiles.get(id)?.nickname ?? '(알 수 없음)';

/** 목록·상세용 일시: 반복 일정은 '매주 월·수 19:00~21:00 · 12/01 ~ 01/31' */
export function scheduleText(e: CalendarEvent) {
  if (e.repeat_weekdays && e.repeat_until) {
    const time = e.start_time ? ` ${fmtTime(e.start_time)}~${fmtTime(e.end_time)}` : ' 하루종일';
    const first = e.series_start_date ?? e.start_date;
    return `매주 ${weekdaysText(e.repeat_weekdays)}${time} · ${fmtMD(first)} ~ ${fmtMDFrom(e.repeat_until, first)}`;
  }
  return periodText(e);
}
