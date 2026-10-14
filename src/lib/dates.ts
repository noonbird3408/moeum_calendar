// 외부 라이브러리 없이 쓰는 날짜 유틸. 날짜는 모두 로컬(한국) 기준 'YYYY-MM-DD' 문자열로 다룬다.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const todayYmd = () => ymd(new Date());

export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export const diffDays = (from: string, to: string) =>
  Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const isSameMonth = (day: string, month: Date) => day.slice(0, 7) === monthKey(month);
export const weekday = (day: string) => parseYmd(day).getDay();

/** 주 시작 요일(0=일, 1=월)에 맞춘 요일 표기 순서 */
export const weekLabels = (ws: 0 | 1) => [...WEEKDAYS.slice(ws), ...WEEKDAYS.slice(0, ws)];

/** 주 시작 요일 기준, 달력 칸 안에서의 열 번호 */
const col = (dow: number, ws: 0 | 1) => (dow - ws + 7) % 7;

/** 주 시작 요일 기준으로 꽉 채운 달력 날짜 목록 (35 또는 42일) */
export function monthGrid(month: Date, ws: 0 | 1 = 0): string[] {
  const first = startOfMonth(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const cur = new Date(first);
  cur.setDate(1 - col(first.getDay(), ws));
  const end = new Date(last);
  end.setDate(last.getDate() + (6 - col(last.getDay(), ws)));
  const out: string[] = [];
  while (cur <= end) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export const daysOfMonth = (month: Date) => monthGrid(month).filter((d) => isSameMonth(d, month));

export const fmtMonthTitle = (d: Date) => `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
export const fmtMD = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
export const fmtMDW = (s: string) => `${fmtMD(s)} (${WEEKDAYS[weekday(s)]})`;
export const fmtDayTitle = (s: string) =>
  `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일 (${WEEKDAYS[weekday(s)]})`;

/** 'HH:MM[:SS]' → 'HH:MM' */
export const fmtTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** 'HH:MM[:SS]' → 분 */
export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** 분 → 'HH:MM' (1440 → '24:00') */
export const minToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

