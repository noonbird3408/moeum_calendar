// 데스크톱 월간 뷰: 하루 최대 3줄, 넘치면 우측 하단 +N. 날짜를 누르면 그날 일정 목록이 열린다.
import type { CSSProperties, KeyboardEvent } from 'react';
import type { CalendarEvent, Profile } from '@/types';
import { isSameMonth, todayYmd, weekday, weekLabels } from '@/lib/dates';
import { EventChip } from './EventChip';

export const MAX_LINES = 3;

export type Highlight = {
  full: Set<string>; // 모두 종일 가능한 날
  partial: Set<string>; // 시간대만 가능한 날
  showFull: boolean;
  showPartial: boolean;
};

type Props = {
  month: Date;
  days: string[];
  byDay: Map<string, CalendarEvent[]>;
  profiles: Map<string, Profile>;
  groupColor: string;
  groupColorOf?: (e: CalendarEvent) => string; // 모음달력처럼 캘린더마다 강조색이 다를 때
  grayPersonal: boolean;
  highlight?: Highlight;
  weekStart?: 0 | 1;
  onOpenDay: (date: string) => void;
  onOpenEvent: (e: CalendarEvent) => void;
};

export function MonthGrid({ month, days, byDay, profiles, groupColor, groupColorOf, grayPersonal, highlight, weekStart = 0, onOpenDay, onOpenEvent }: Props) {
  const today = todayYmd();
  return (
    <div className="month-grid" role="grid" aria-label="월간 캘린더">
      {weekLabels(weekStart).map((w) => (
        <div key={w} role="columnheader" className={`wk ${w === '일' ? 'sun' : w === '토' ? 'sat' : ''}`}>
          {w}
        </div>
      ))}
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        // 4개 이상일 때만 접는다: 3줄 노출 + "+N"
        const visible = list.length > MAX_LINES ? list.slice(0, MAX_LINES) : list;
        const hidden = list.length - visible.length;
        // 전체(단체) 일정이 있는 날은 그 캘린더 색으로 강조
        const firstGroup = list.find((e) => e.is_group);
        const grp = firstGroup ? (groupColorOf ? groupColorOf(firstGroup) : groupColor) : null;
        const dow = weekday(d);
        const isToday = d === today;
        const hl =
          highlight && ((highlight.showFull && highlight.full.has(d)) ? 'hl-full' : highlight.showPartial && highlight.partial.has(d) ? 'hl-partial' : '');
        const onKey = (e: KeyboardEvent) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onOpenDay(d);
          }
        };
        return (
          <div
            key={d}
            role="gridcell"
            tabIndex={0}
            aria-label={`${d}${list.length ? `, 일정 ${list.length}개` : ', 일정 없음'}`}
            className={`cell ${isSameMonth(d, month) ? '' : 'out'} ${isToday ? 'today' : ''} ${hl ?? ''} ${grp ? 'has-group' : ''}`}
            style={grp ? ({ '--grp': grp } as unknown as CSSProperties) : undefined}
            onClick={() => onOpenDay(d)}
            onKeyDown={onKey}
          >
            <span className={`daynum ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`}>{Number(d.slice(8))}</span>
            <div className="cell-events">
              {visible.map((e) => (
                <EventChip
                  key={e.id}
                  event={e}
                  date={d}
                  author={profiles.get(e.author_id)}
                  groupColor={groupColorOf ? groupColorOf(e) : groupColor}
                  grayPersonal={grayPersonal}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onOpenEvent(e);
                  }}
                />
              ))}
            </div>
            {hidden > 0 && (
              <button
                type="button"
                className="more-btn"
                aria-label={`일정 ${hidden}개 더 보기`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onOpenDay(d);
                }}
              >
                +{hidden}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
