// 모바일 목록 뷰: 일자별 아코디언
import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent, Profile } from '@/types';
import { fmtMDW, todayYmd } from '@/lib/dates';
import { GRAY } from '@/lib/colors';
import { Icon } from '@/ui/Icon';
import { Dot } from '@/ui/controls';
import { nicknameOf, timeRange } from './eventUtils';

type Props = {
  monthDays: string[];
  byDay: Map<string, CalendarEvent[]>;
  profiles: Map<string, Profile>;
  groupColor: string;
  grayPersonal: boolean;
  onOpenEvent: (e: CalendarEvent) => void;
  onAdd: (date: string) => void;
};

export function AgendaList({ monthDays, byDay, profiles, groupColor, grayPersonal, onOpenEvent, onAdd }: Props) {
  const today = todayYmd();
  const inMonth = monthDays.includes(today);
  // 오늘(이번 달이 아니면 첫 일정 있는 날)을 펼친 채 시작
  const firstOpen = inMonth ? today : monthDays.find((d) => (byDay.get(d)?.length ?? 0) > 0);
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstOpen ? [firstOpen] : []));
  const [showEmpty, setShowEmpty] = useState(false);
  const anchor = useRef<HTMLElement>(null);

  useEffect(() => {
    anchor.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const rows = monthDays.filter((d) => showEmpty || d === today || (byDay.get(d)?.length ?? 0) > 0);
  const toggle = (d: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });

  return (
    <div className="agenda">
      <label className="agenda-filter">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> 빈 날도 보기
      </label>
      {rows.length === 0 && <p className="empty">일정이 없어요.</p>}
      {rows.map((d) => {
        const list = byDay.get(d) ?? [];
        const g = list.filter((e) => e.is_group).length;
        const isOpen = open.has(d);
        return (
          <section key={d} ref={d === firstOpen ? anchor : undefined} className={`ag-day ${d === today ? 'today' : ''}`}>
            <button type="button" className="ag-head" aria-expanded={isOpen} onClick={() => toggle(d)}>
              <span className="ag-date">{fmtMDW(d)}</span>
              <span className="ag-count">
                {list.length ? (
                  <>
                    {g > 0 && <span className="badge badge-group" style={{ background: groupColor }}>단체 {g}</span>}
                    {list.length - g > 0 && <span>개인 {list.length - g}</span>}
                  </>
                ) : (
                  '일정 없음'
                )}
              </span>
              <Icon name="chevron-down" size={18} className={`chev ${isOpen ? 'up' : ''}`} />
            </button>
            {isOpen && (
              <ul className="ag-list">
                {list.map((e) => (
                  <li key={e.id}>
                    <button type="button" className="ag-item" onClick={() => onOpenEvent(e)}>
                      <Dot color={e.is_group ? groupColor : grayPersonal ? GRAY : (profiles.get(e.author_id)?.color ?? GRAY)} />
                      {e.is_group && <span className="badge badge-outline">단체</span>}
                      <span className="ag-title">{e.title}</span>
                      <span className="ag-name">{nicknameOf(profiles, e.author_id)}</span>
                      <span className="ag-time">{timeRange(e)}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className="ag-add" onClick={() => onAdd(d)}>
                    <Icon name="plus" size={16} /> 이 날 일정 추가
                  </button>
                </li>
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
