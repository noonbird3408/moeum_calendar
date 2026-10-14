// 년·월 선택 시트: 년도 화살표로 해를 바꾸고, 달을 누르면 그 달로 이동
import { useState, useEffect } from 'react';
import { Sheet } from '@/ui/Sheet';
import { Icon } from '@/ui/Icon';

type Props = {
  open: boolean;
  value: Date; // 현재 보고 있는 달
  onPick: (d: Date) => void;
  onClose: () => void;
};

export function MonthPicker({ open, value, onPick, onClose }: Props) {
  const [year, setYear] = useState(value.getFullYear());

  // 열릴 때마다 현재 달의 연도로 맞춘다
  useEffect(() => {
    if (open) setYear(value.getFullYear());
  }, [open, value]);

  return (
    <Sheet open={open} onClose={onClose} title="년·월 선택" size="sm">
      <div className="picker">
        <div className="picker-year">
          <button type="button" className="icon-btn" aria-label="이전 해" onClick={() => setYear((y) => y - 1)}>
            <Icon name="chevron-left" />
          </button>
          <strong aria-live="polite">{year}년</strong>
          <button type="button" className="icon-btn" aria-label="다음 해" onClick={() => setYear((y) => y + 1)}>
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="picker-months">
          {Array.from({ length: 12 }, (_, i) => {
            const on = year === value.getFullYear() && i === value.getMonth();
            return (
              <button
                key={i}
                type="button"
                className={`picker-month ${on ? 'on' : ''}`}
                aria-pressed={on}
                onClick={() => onPick(new Date(year, i, 1))}
              >
                {i + 1}월
              </button>
            );
          })}
        </div>
      </div>
    </Sheet>
  );
}
