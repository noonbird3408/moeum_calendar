// 퍼스널 컬러: 기본 6색 + '+' 를 누르면 최근에 쓴 색과 직접 고르기 칸이 열린다
import { useState } from 'react';
import { Icon } from './Icon';

export function ColorChooser({
  label,
  value,
  presets,
  recent = [],
  onChange,
}: {
  label: string;
  value: string;
  presets: string[];
  recent?: string[];
  onChange: (c: string) => void;
}) {
  const [more, setMore] = useState(false);
  const isPreset = presets.some((c) => c.toLowerCase() === value.toLowerCase());
  const extra = [...new Set(recent.map((c) => c.toUpperCase()))].filter((c) => !presets.includes(c));

  const swatch = (c: string) => {
    const on = c.toLowerCase() === value.toLowerCase();
    return (
      <button
        key={c}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={c}
        className={`swatch ${on ? 'on' : ''}`}
        style={{ background: c }}
        onClick={() => onChange(c)}
      >
        {on && <Icon name="check" size={16} />}
      </button>
    );
  };

  return (
    <div className="color-chooser">
      <div className="swatches" role="radiogroup" aria-label={label}>
        {presets.map(swatch)}
        <button
          type="button"
          className={`swatch swatch-plus ${more || (!isPreset && !extra.includes(value.toUpperCase())) ? 'on' : ''}`}
          aria-expanded={more}
          aria-label="더 많은 색 보기"
          onClick={() => setMore((v) => !v)}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>
      {more && (
        <div className="color-more">
          {extra.length > 0 && (
            <>
              <span className="field-label small">최근에 쓴 색</span>
              <div className="swatches" role="radiogroup" aria-label="최근 색">
                {extra.map(swatch)}
              </div>
            </>
          )}
          <label className="color-custom">
            <span className="small">직접 고르기</span>
            <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label="직접 고르기" />
          </label>
        </div>
      )}
    </div>
  );
}
