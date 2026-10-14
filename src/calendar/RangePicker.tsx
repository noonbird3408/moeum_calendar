// 날짜 두 번 누르기로 시작·종료 날짜를 고르는 작은 달력
import { useState } from 'react';
import { addMonths, diffDays, fmtMD, isSameMonth, monthGrid, parseYmd, startOfMonth, todayYmd, weekLabels, weekday } from '@/lib/dates';
import { usePrefs } from '@/lib/prefs';

type Props = {
  start: string;
  end: string;
  maxSpan: number; // 최대 기간(일)
  onChange: (start: string, end: string) => void;
};

export function RangePicker({ start, end, maxSpan, onChange }: Props) {
  const { weekStart } = usePrefs();
  const [month, setMonth] = useState(() => startOfMonth(parseYmd(start || todayYmd())));
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const days = monthGrid(month, weekStart);
  const today = todayYmd();

  const tap = (d: string) => {
    if (picking === 'start' || d < start) {
      onChange(d, d);
      setPicking('end');
      return;
    }
    // 종료 날짜: 기간이 너무 길면 종료만 바꾼다
    onChange(start, diffDays(start, d) > maxSpan ? start : d);
    setPicking('start');
  };

  const span = start && end ? diffDays(start, end) + 1 : 0;
  const inRange = (d: string) => !!start && !!end && d >= start && d <= end;

  return (
    <div className="range-picker">
      <div className="range-head">
        <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => setMonth((m) => addMonths(m, -1))}>
          ‹
        </button>
        <strong>
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </strong>
        <button type="button" className="icon-btn" aria-label="다음 달" onClick={() => setMonth((m) => addMonths(m, 1))}>
          ›
        </button>
      </div>
      <div className="range-grid" role="grid" aria-label="날짜 범위 선택">
        {weekLabels(weekStart).map((w, i) => (
          <div key={`${w}-${i}`} className={`range-wk ${i === 0 && weekStart === 0 ? 'sun' : ''}`} role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const dow = weekday(d);
          const cls = [
            isSameMonth(d, month) ? '' : 'out',
            d === today ? 'today' : '',
            d === start || d === end ? 'edge' : '',
            inRange(d) ? 'in' : '',
            dow === 0 ? 'sun' : dow === 6 ? 'sat' : '',
          ].join(' ');
          return (
            <button key={d} type="button" className={`range-day ${cls}`} onClick={() => tap(d)} aria-label={fmtMD(d)} aria-pressed={inRange(d)}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="range-summary small">
        {start ? (
          <>
            <b>{fmtMD(start)}</b>
            {end && end !== start ? (
              <>
                {' ~ '}
                <b>{fmtMD(end)}</b> <span className="muted">({span}일)</span>
              </>
            ) : null}
          </>
        ) : (
          '날짜를 고르세요'
        )}
      </p>
    </div>
  );
}
