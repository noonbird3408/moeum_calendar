import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({
  value,
  colors,
  onChange,
  allowCustom = true,
  label,
}: {
  value: string;
  colors: string[];
  onChange: (c: string) => void;
  allowCustom?: boolean;
  label: string;
}) {
  const custom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => {
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
      })}
      {allowCustom && (
        <label className={`swatch swatch-custom ${custom ? 'on' : ''}`} style={custom ? { background: value } : undefined} aria-label="직접 선택">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
          {custom ? <Icon name="check" size={16} /> : <Icon name="plus" size={16} />}
        </label>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <span className="toggle">
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" />
      </span>
    </label>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span className="dot" style={{ background: color, width: size, height: size }} aria-hidden="true" />;
}

export function Splash({ message = '불러오는 중…' }: { message?: string }) {
  return (
    <div className="splash">
      <div className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
