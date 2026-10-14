// 전원이 비어 있는 날짜·시간대 계산
//  - 일정이 없는 멤버는 바쁜 구간이 없으므로 자동으로 '종일 가능'
//  - 종일 일정 = 그날 00~24시 바쁨, 시간 일정 = 그 구간만 바쁨
//  - 여러 날 시간 일정: 첫날 시작~24시, 중간 종일, 마지막 날 0시~종료
//  - 단체 일정도 바쁨으로 계산 (이미 모임이 있는 날은 추천하지 않음)
import { addDays, toMin } from '@/lib/dates';

/** 1080 → '18시', 1110 → '18시 30분' */
const hm = (m: number) => (m % 60 ? `${Math.floor(m / 60)}시 ${m % 60}분` : `${m / 60}시`);
/** 구간 표기: 정시끼리는 '14~17시', 아니면 '14시 30분~17시' */
const span = (s: number, e: number) => (s % 60 === 0 && e % 60 === 0 ? `${s / 60}~${e / 60}시` : `${hm(s)}~${hm(e)}`);

export type EventLite = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
};

/** 한 날짜의 가능 칩. partial 이면 가능한 구간(slots)을 모두 담는다 (예: 19시 이전 / 21시 이후) */
export type Chip = { date: string; kind: 'full' | 'partial'; range: string; slots: Span[]; labels: string[] };
export type AvailabilityOptions = { dayStart: number; dayEnd: number; minFree: number }; // 분

export const DEFAULT_AVAILABILITY: AvailabilityOptions = { dayStart: 9 * 60, dayEnd: 24 * 60, minFree: 120 };

export type Span = [number, number];

export function freeSlots(busy: Span[], start: number, end: number): Span[] {
  const sorted = busy
    .map(([s, e]) => [Math.max(s, start), Math.min(e, end)] as Span)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  let cur = start;
  for (const [s, e] of sorted) {
    if (s > cur) out.push([cur, s]);
    cur = Math.max(cur, e);
  }
  if (cur < end) out.push([cur, end]);
  return out;
}

export function computeAvailability(
  events: EventLite[],
  days: string[],
  opt: AvailabilityOptions = DEFAULT_AVAILABILITY,
): Chip[] {
  const target = new Set(days);
  const busy = new Map<string, Span[]>();
  const add = (d: string, s: number, e: number) => {
    if (!target.has(d)) return;
    const list = busy.get(d);
    if (list) list.push([s, e]);
    else busy.set(d, [[s, e]]);
  };

  for (const ev of events) {
    for (let d = ev.start_date, guard = 0; d <= ev.end_date && guard < 400; d = addDays(d, 1), guard++) {
      if (!ev.start_time || !ev.end_time) {
        add(d, 0, 1440);
        continue;
      }
      add(d, d === ev.start_date ? toMin(ev.start_time) : 0, d === ev.end_date ? toMin(ev.end_time) : 1440);
    }
  }

  // 구간 표기: 활동 시작에 붙으면 'N시 이전', 활동 끝에 붙으면 'N시 이후'
  const slotLabel = ([s, e]: Span) =>
    s === opt.dayStart ? `${hm(e)} 이전` : e === opt.dayEnd ? `${hm(s)} 이후` : span(s, e);

  const chips: Chip[] = [];
  for (const d of days) {
    const list = busy.get(d);
    if (!list) {
      chips.push({ date: d, kind: 'full', range: '하루종일', slots: [], labels: ['하루종일'] });
      continue;
    }
    const slots = freeSlots(list, opt.dayStart, opt.dayEnd).filter(([s, e]) => e - s >= opt.minFree);
    if (!slots.length) continue;
    const labels = slots.map(slotLabel);
    chips.push({ date: d, kind: 'partial', range: labels.join(' / '), slots, labels });
  }
  return chips;
}
