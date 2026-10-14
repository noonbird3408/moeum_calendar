// 날짜를 눌렀을 때 뜨는 그날의 일정 목록 (작성자 · 기간 · 시간)
import type { CalendarEvent, Profile } from '@/types';
import { fmtDayTitle } from '@/lib/dates';
import { GRAY } from '@/lib/colors';
import { Sheet } from '@/ui/Sheet';
import { Avatar } from '@/ui/Avatar';
import { Dot } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { nicknameOf, scheduleText } from './eventUtils';

type Props = {
  date: string | null;
  hint?: string | null; // 가능 날짜 칩에서 열었을 때 안내 문구
  events: CalendarEvent[];
  profiles: Map<string, Profile>;
  groupColor: string;
  groupColorOf?: (e: CalendarEvent) => string;
  grayPersonal: boolean;
  isAdmin: boolean;
  readOnly?: boolean; // 모음달력(여러 캘린더)에서는 항목 클릭 시 해당 캘린더로 이동
  onClose: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onAdd?: (date: string, group?: boolean) => void;
};

export function DaySheet({ date, hint, events, profiles, groupColor, groupColorOf, grayPersonal, isAdmin, readOnly, onClose, onOpenEvent, onAdd }: Props) {
  const groups = events.filter((e) => e.is_group);
  const personal = events.filter((e) => !e.is_group);

  const item = (e: CalendarEvent) => {
    const author = profiles.get(e.author_id);
    return (
      <li key={`${e.id}-${e.occ ?? ''}`}>
        <button type="button" className={`day-item ${e.repeat_weekdays ? 'is-recurring' : ''}`} onClick={() => onOpenEvent(e)}>
          <Dot color={e.is_group ? (groupColorOf?.(e) ?? groupColor) : grayPersonal ? GRAY : (author?.color ?? GRAY)} size={12} />
          <span className="day-main">
            <span className="day-title">
              {e.repeat_weekdays && <span className="badge badge-recur">↻ 정기</span>} {e.title}
            </span>
            <span className="day-sub">
              {scheduleText(e)} · <Avatar profile={author} size={16} /> {nicknameOf(profiles, e.author_id)}
            </span>
          </span>
          <Icon name="chevron-right" size={18} />
        </button>
      </li>
    );
  };

  return (
    <Sheet
      open={date !== null}
      onClose={onClose}
      title={date ? fmtDayTitle(date) : ''}
      footer={
        date && onAdd && !readOnly ? (
          <>
            {isAdmin && (
              <button type="button" className="btn btn-ghost" onClick={() => onAdd(date, true)}>
                전체 일정 만들기
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => onAdd(date)}>
              <Icon name="plus" size={18} /> 일정 추가
            </button>
          </>
        ) : undefined
      }
    >
      {hint && <p className="notice small">{hint}</p>}
      {events.length === 0 && <p className="empty">일정이 비어있습니다.</p>}
      {groups.length > 0 && (
        <section className="day-section">
          <h3>단체</h3>
          <ul>{groups.map(item)}</ul>
        </section>
      )}
      {personal.length > 0 && (
        <section className="day-section">
          <h3>개인</h3>
          <ul>{personal.map(item)}</ul>
        </section>
      )}
    </Sheet>
  );
}
