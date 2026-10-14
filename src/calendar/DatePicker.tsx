// 일정 날짜 고르기: 날짜를 하나씩 눌러 켜고 끄기 · 누른 채로 끌어서 여러 날 한 번에 · 한 날짜를 누른 채(또는 방금 누른 뒤) 다른 날짜를 우클릭하면 그 사이 전체 선택
// (Shift+클릭도 사이 전체 선택). 모바일에서는 손가락으로 끌어서 고른다.
import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { addDays, addMonths, diffDays, fmtMD, isSameMonth, monthGrid, parseYmd, startOfMonth, todayYmd, weekLabels, weekday } from '@/lib/dates';
import { usePrefs } from '@/lib/prefs';

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  maxDays?: number; // 한 번에 고를 수 있는 최대 날짜 수
  highlightWeekdays?: number[]; // 요일 반복일 때 해당 요일 표시
};

const between = (a: string, b: string) => {
  const [s, e] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  for (let d = s, n = diffDays(s, e); n >= 0; n--, d = addDays(d, 1)) out.push(d);
  return out;
};

/** 고른 날짜를 이어진 구간으로 묶는다: ['10/13'], ['10/15'~'10/17'] */
export function toRuns(dates: Iterable<string>): [string, string][] {
  const list = [...dates].sort();
  const runs: [string, string][] = [];
  for (const d of list) {
    const last = runs[runs.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else runs.push([d, d]);
  }
  return runs;
}

export function runsText(dates: Set<string>): string {
  if (!dates.size) return '날짜를 고르세요';
  const runs = toRuns(dates);
  const parts = runs.map(([s, e]) => (s === e ? fmtMD(s) : `${fmtMD(s)} ~ ${fmtMD(e)}`));
  const shown = parts.length > 3 ? [...parts.slice(0, 3), `외 ${parts.length - 3}구간`] : parts;
  return `${shown.join(', ')} (${dates.size}일)`;
}

export function DatePicker({ selected, onChange, maxDays = 62, highlightWeekdays }: Props) {
  const { weekStart } = usePrefs();
  const first = [...selected].sort()[0];
  const [month, setMonth] = useState(() => startOfMonth(parseYmd(first ?? todayYmd())));
  const days = monthGrid(month, weekStart);
  const today = todayYmd();
  // 끌기 상태: 시작 날짜, 켜기/끄기, 시작 전 선택
  const drag = useRef<{ anchor: string; add: boolean; base: Set<string> } | null>(null);
  const anchor = useRef<string | null>(first ?? null); // 우클릭·Shift 범위의 기준
  const selRef = useRef(selected);
  selRef.current = selected;

  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const apply = (base: Set<string>, list: string[], add: boolean) => {
    const next = new Set(base);
    for (const d of list) {
      if (add) {
        if (next.size >= maxDays && !next.has(d)) break;
        next.add(d);
      } else next.delete(d);
    }
    onChange(next);
  };

  const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null;

  const onDown = (e: RPointerEvent<HTMLButtonElement>, d: string) => {
    if (e.button === 2) return; // 우클릭은 contextmenu 에서 처리
    if (e.button !== 0) return;
    if (e.shiftKey && anchor.current) {
      apply(selRef.current, between(anchor.current, d), true);
      return;
    }
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); // 다른 칸 위로 끌 수 있게
    const add = !selRef.current.has(d);
    drag.current = { anchor: d, add, base: new Set(selRef.current) };
    anchor.current = d;
    apply(selRef.current, [d], add);
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = drag.current;
    if (!g) return;
    const d = dayAt(e.clientX, e.clientY);
    if (d) apply(g.base, between(g.anchor, d), g.add);
  };

  const onContext = (e: RMouseEvent, d: string) => {
    e.preventDefault();
    const from = drag.current?.anchor ?? anchor.current;
    if (!from) return;
    drag.current = null;
    apply(selRef.current, between(from, d), true);
  };

  return (
    <div className="date-picker">
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
      <div className="range-grid dp-grid" role="grid" aria-label="날짜 선택" onPointerMove={onMove}>
        {weekLabels(weekStart).map((w, i) => (
          <div key={`${w}-${i}`} className="range-wk" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const on = selected.has(d);
          const dow = weekday(d);
          const cls = [
            'range-day',
            isSameMonth(d, month) ? '' : 'out',
            d === today ? 'today' : '',
            on ? 'picked' : '',
            on && selected.has(addDays(d, -1)) ? 'join-l' : '',
            on && selected.has(addDays(d, 1)) ? 'join-r' : '',
            highlightWeekdays?.includes(dow) ? 'wd-hl' : '',
            dow === 0 ? 'sun' : dow === 6 ? 'sat' : '',
          ].join(' ');
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              className={cls}
              aria-label={fmtMD(d)}
              aria-pressed={on}
              onPointerDown={(e) => onDown(e, d)}
              onContextMenu={(e) => onContext(e, d)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (e.shiftKey && anchor.current) apply(selRef.current, between(anchor.current, d), true);
                  else {
                    anchor.current = d;
                    apply(selRef.current, [d], !selRef.current.has(d));
                  }
                }
              }}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="dp-foot">
        <span className="dp-summary">{runsText(selected)}</span>
        {selected.size > 0 && (
          <button type="button" className="mini-act" onClick={() => onChange(new Set())}>
            모두 해제
          </button>
        )}
      </div>
    </div>
  );
}
