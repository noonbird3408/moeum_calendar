// 반복(요일) 일정을 화면 기간 안의 실제 회차로 펼친다.
// DB 에는 일정 하나(첫 날 ~ 반복 종료일)로 저장하고, 화면에서만 요일마다 하루짜리 회차를 만든다.
import type { CalendarEvent } from '@/types';
import { addDays, diffDays, weekday, WEEKDAYS } from './dates';

export function expandEvents(events: CalendarEvent[], from: string, to: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of events) {
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
