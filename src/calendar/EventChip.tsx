import type { MouseEvent } from 'react';
import type { CalendarEvent, Profile } from '@/types';
import { fmtTime } from '@/lib/dates';
import { GRAY, textOn, withAlpha } from '@/lib/colors';

type Props = {
  event: CalendarEvent;
  date: string;
  author?: Profile;
  groupColor: string;
  grayPersonal: boolean;
  onClick: (e: MouseEvent) => void;
};

/** 월간 셀 한 줄: [일정명 · 닉네임 · 시간] */
export function EventChip({ event, date, author, groupColor, grayPersonal, onClick }: Props) {
  const continued = date !== event.start_date;
  const time = event.start_time && !continued ? fmtTime(event.start_time) : '';
  const tint = grayPersonal ? GRAY : (author?.color ?? GRAY);
  const style = event.is_group
    ? { background: groupColor, color: textOn(groupColor) }
    : { borderLeftColor: tint, background: withAlpha(tint, 0.14) };
  const name = author?.nickname ?? '?';

  return (
    <button
      type="button"
      className={`ev-chip ${event.is_group ? 'is-group' : 'is-personal'} ${event.is_recurring ? 'is-recurring' : ''}`}
      style={style}
      onClick={onClick}
      title={`${event.title} · ${name}${time ? ` ${time}` : ''}${event.is_recurring ? ' (정기)' : ''}`}
    >
      {continued && <span aria-hidden="true">←</span>}
      {event.is_recurring && <span className="ev-recur" aria-label="정기 일정">↻</span>}
      <span className="ev-title">{event.title}</span>
      <span className="ev-name">{name}</span>
      {time && <time className="ev-time">{time}</time>}
    </button>
  );
}
