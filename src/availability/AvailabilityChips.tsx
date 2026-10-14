import { useState } from 'react';
import { fmtMD, WEEKDAYS, weekday } from '@/lib/dates';
import type { Chip } from './computeAvailability';

type Filter = 'full' | 'partial';

/** 가능한 날: '하루종일' 날과 '특정 시간대' 날을 나눠 본다. 시간대는 '19시 이전 / 21시 이후'처럼 구간마다 칩으로 보여준다. */
export function AvailabilityPanel({ chips, onPick }: { chips: Chip[]; onPick: (c: Chip) => void }) {
  const [filter, setFilter] = useState<Filter>('full');
  const full = chips.filter((c) => c.kind === 'full');
  const partial = chips.filter((c) => c.kind === 'partial');
  const shown = filter === 'full' ? full : partial;

  const tab = (v: Filter, label: string, n: number) => (
    <button type="button" className={`chip-tab chip-tab-${v} ${filter === v ? 'on' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(v)}>
      {label} <span className="chip-count">{n}</span>
    </button>
  );

  return (
    <section className="panel avail-panel" aria-label="가능한 날">
      <header className="panel-head">
        <h2>가능한 날</h2>
      </header>
      <div className="chip-tabs" role="group" aria-label="가능 날짜 구분">
        {tab('full', '하루종일', full.length)}
        {tab('partial', '특정 시간대', partial.length)}
      </div>

      {chips.length === 0 ? (
        <p className="empty small">가능한 날이 없어요.</p>
      ) : shown.length === 0 ? (
        <p className="empty small">없어요.</p>
      ) : (
        <ul className="avail-list">
          {shown.map((c) => (
            <li key={c.date}>
              <button type="button" className={`avail-row ${c.kind === 'full' ? 'row-full' : 'row-partial'}`} onClick={() => onPick(c)}>
                <span className="avail-date">
                  {fmtMD(c.date)} <span className="muted small">({WEEKDAYS[weekday(c.date)]})</span>
                </span>
                {c.kind === 'full' ? (
                  <span className="avail-tag tag-full">하루종일</span>
                ) : (
                  <span className="avail-slots">
                    {c.labels.map((text) => (
                      <span key={text} className="avail-tag tag-partial">
                        {text}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 달력 우측 하단의 온/오프 칩: 하루종일·시간대 가능한 날을 달력에 강조할지 고른다 */
export function HighlightToggles({
  showFull,
  showPartial,
  onChange,
}: {
  showFull: boolean;
  showPartial: boolean;
  onChange: (next: { showFull: boolean; showPartial: boolean }) => void;
}) {
  return (
    <div className="toggle-chips" role="group" aria-label="달력 표시 설정">
      <button
        type="button"
        className={`tchip tchip-full ${showFull ? 'on' : ''}`}
        aria-pressed={showFull}
        onClick={() => onChange({ showFull: !showFull, showPartial })}
      >
        <span className="tchip-dot" aria-hidden="true" /> 하루종일 가능
      </button>
      <button
        type="button"
        className={`tchip tchip-partial ${showPartial ? 'on' : ''}`}
        aria-pressed={showPartial}
        onClick={() => onChange({ showFull, showPartial: !showPartial })}
      >
        <span className="tchip-dot" aria-hidden="true" /> 시간대 가능
      </button>
    </div>
  );
}
