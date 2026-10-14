// 내 일정 내보내기 (.ics). 반복 일정은 RRULE(요일 반복)로 적는다.
import type { CalendarEvent } from '@/types';
import { addDays } from './dates';

const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ymdCompact = (s: string) => s.replace(/-/g, '');
const hmsCompact = (t: string) => t.slice(0, 8).replace(/:/g, '');
// RFC 5545 글자 이스케이프 (줄바꿈으로 다른 항목을 끼워 넣지 못하게 CR 도 처리)
const esc = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

export function buildIcs(events: CalendarEvent[], calNameOf: (id: string) => string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//모음달력//KO', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@moeum-calendar`, `DTSTAMP:${stamp}`);
    const timed = !!e.start_time && !!e.end_time;
    const startDate = e.start_date;
    // 종일 일정의 DTEND 는 마지막 날 다음 날
    const endDate = e.repeat_weekdays || e.event_dates?.length ? e.start_date : e.end_date;
    if (timed) {
      lines.push(`DTSTART;TZID=Asia/Seoul:${ymdCompact(startDate)}T${hmsCompact(e.start_time!)}`);
      lines.push(`DTEND;TZID=Asia/Seoul:${ymdCompact(endDate)}T${hmsCompact(e.end_time!).replace(/^240000$/, '235959')}`);
    } else {
      const endExcl = addDays(endDate, 1); // 시간대와 상관없이 날짜만 하루 더한다
      lines.push(`DTSTART;VALUE=DATE:${ymdCompact(startDate)}`, `DTEND;VALUE=DATE:${ymdCompact(endExcl)}`);
    }
    if (e.repeat_weekdays && e.repeat_until) {
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${e.repeat_weekdays.map((d) => DAY[d]).join(',')};UNTIL=${ymdCompact(e.repeat_until)}`);
    }
    if (e.event_dates?.length) {
      // 떨어진 날짜 일정: 첫 날 말고 나머지 날짜를 RDATE 로
      const rest = [...e.event_dates].sort().filter((d) => d !== e.start_date);
      if (rest.length) {
        lines.push(
          timed
            ? `RDATE;TZID=Asia/Seoul:${rest.map((d) => `${ymdCompact(d)}T${hmsCompact(e.start_time!)}`).join(',')}`
            : `RDATE;VALUE=DATE:${rest.map(ymdCompact).join(',')}`,
        );
      }
    }
    lines.push(`SUMMARY:${esc(`${e.is_group ? '[전체] ' : ''}${e.title}`)}`);
    const desc = [e.memo, e.link_url, `캘린더: ${calNameOf(e.calendar_id)}`].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadText(name: string, text: string, type = 'text/calendar') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
