// 반복(요일) 일정 · 떨어진 날짜 일정을 화면 기간 안의 실제 회차로 펼친다.
// DB 에는 일정 하나(첫 날 ~ 마지막 날)로 저장하고, 화면에서만 회차마다 하루짜리로 만든다.
//  · 요일 반복: repeat_weekdays + repeat_until
//  · 떨어진 날짜(전체 일정): event_dates 에 고른 날짜 목록
import type { CalendarEvent } from '@/types';
import { addDays, diffDays, weekday, WEEKDAYS } from './dates';

export function expandEvents(events: CalendarEvent[], from: string, to: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of events) {
    if (e.event_dates?.length) {
      for (const d of e.event_dates) {
        if (d >= from && d <= to) out.push({ ...e, occ: d, series_start_date: e.start_date, start_date: d, end_date: d });
      }
      continue;
    }
    if (!e.repeat_weekdays || !e.repeat_until) {
      out.push(e);
      continue;
    }
    const start = e.start_date > from ? e.start_date : from;
    const end = e.repeat_until < to ? e.repeat_until : to;
    if (start > end) continue;
    const days = e.repeat_weekdays;
    const excluded = new Set(e.excluded_dates ?? []);
    for (let d = start, n = diffDays(start, end); n >= 0; n--, d = addDays(d, 1)) {
      if (days.includes(weekday(d)) && !excluded.has(d)) {
        out.push({ ...e, occ: d, series_start_date: e.start_date, start_date: d, end_date: d });
      }
    }
  }
  return out;
}

/** 요일 목록 → '월·수' */
export const weekdaysText = (days: number[]) => [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join('·');

type RepeatLike = {
  start_date: string;
  repeat_weekdays: number[] | null;
  repeat_until: string | null;
  excluded_dates?: string[];
  event_dates?: string[] | null;
};

/** 회차로 나뉘는 일정인지 (요일 반복 또는 떨어진 날짜) */
export const hasOccurrences = (e: Pick<RepeatLike, 'repeat_weekdays' | 'repeat_until' | 'event_dates'>) =>
  !!e.event_dates?.length || (!!e.repeat_weekdays && !!e.repeat_until);

/** d 날짜가 실제 회차인지 (제외한 날짜는 아님) */
export const isOccurrence = (e: RepeatLike, d: string) =>
  e.event_dates?.length
    ? e.event_dates.includes(d)
    : !!e.repeat_weekdays && !!e.repeat_until && e.start_date <= d && d <= e.repeat_until && e.repeat_weekdays.includes(weekday(d)) && !(e.excluded_dates ?? []).includes(d);

/** from 이후(포함) 첫 회차. 없으면 null */
export function nextOccurrence(e: RepeatLike, from: string): string | null {
  if (e.event_dates?.length) return [...e.event_dates].sort().find((d) => d >= from) ?? null;
  if (!e.repeat_weekdays || !e.repeat_until) return null;
  let d = e.start_date > from ? e.start_date : from;
  for (let n = 0; d <= e.repeat_until && n < 800; n++, d = addDays(d, 1)) if (isOccurrence(e, d)) return d;
  return null;
}
