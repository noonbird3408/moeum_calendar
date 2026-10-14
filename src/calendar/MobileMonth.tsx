// 모바일 간략 달력: 단체 일정(최대 2개)과 +N 만 표시, 탭하면 하루 목록 시트
import type { CSSProperties } from 'react';
import type { CalendarEvent } from '@/types';
import { isSameMonth, todayYmd, weekday, weekLabels } from '@/lib/dates';
import { textOn } from '@/lib/colors';
import type { Highlight } from './MonthGrid';

type Props = {
  month: Date;
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  groupColor: string;
  groupColorOf?: (e: CalendarEvent) => string;
  highlight?: Highlight;
  weekStart?: 0 | 1;
  onOpenDay: (date: string) => void;
};

export function MobileMonth({ month, days, byDay, groupColor, groupColorOf, highlight, weekStart = 0, onOpenDay }: Props) {
  const today = todayYmd();
  return (
    <div className="m-grid" role="grid" aria-label="월간 캘린더 (간략)">
      {weekLabels(weekStart).map((w) => (
        <div key={w} role="columnheader" className={`wk ${w === '일' ? 'sun' : w === '토' ? 'sat' : ''}`}>
          {w}
        </div>
      ))}
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        const groups = list.filter((e) => e.is_group).slice(0, 2);
        const rest = list.length - groups.length;
        const grp = groups[0] ? (groupColorOf ? groupColorOf(groups[0]) : groupColor) : null;
        const dow = weekday(d);
        const hl =
          highlight && (highlight.showFull && highlight.full.has(d) ? 'hl-full' : highlight.showPartial && highlight.partial.has(d) ? 'hl-partial' : '');
        return (
          <button
            key={d}
            type="button"
            role="gridcell"
            className={`m-cell ${isSameMonth(d, month) ? '' : 'out'} ${d === today ? 'today' : ''} ${hl ?? ''} ${grp ? 'has-group' : ''}`}
            style={grp ? ({ '--grp': grp } as unknown as CSSProperties) : undefined}
            onClick={() => onOpenDay(d)}
            aria-label={`${d}${list.length ? `, 일정 ${list.length}개` : ', 일정 없음'}`}
          >
            <span className={`daynum ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`}>{Number(d.slice(8))}</span>
            {groups.map((e) => {
              const c = groupColorOf ? groupColorOf(e) : groupColor;
              return (
                <span key={e.id} className="m-group" style={{ background: c, color: textOn(c) }}>
                  {e.title}
                </span>
              );
            })}
            {rest > 0 && <span className="m-more">+{rest}</span>}
          </button>
        );
      })}
    </div>
  );
}
