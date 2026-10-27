// 퍼스널 컬러는 기본 6색 + '+' 로 직접 고르기(최근 사용 색 표시)
export const PERSONAL_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#F59E0B', '#14B8A6'];

export const GROUP_COLORS = ['#FF6B35', '#E11D48', '#2563EB', '#059669', '#7C3AED', '#D97706'];

export const GRAY = '#8E8E93';

/** '#abc' · '#AABBCC' · 'rgb(…)' 를 '#RRGGBB' 로 맞춘다. 알 수 없는 값이면 회색 */
export function normHex(c: string | null | undefined): string {
  if (!c) return GRAY;
  const s = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ('#' + Array.from(s.slice(1)).map((x) => x + x).join('')).toUpperCase();
  return toHex(s) ?? GRAY;
}

const luminance = (hex: string) => {
  const h = normHex(hex).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** 배경색 위에서 읽기 좋은 글자색 */
export function textOn(hex: string) {
  return luminance(hex) > 0.45 ? '#111827' : '#ffffff';
}

/** '#RRGGBB' + 투명도(0~1) */
export const withAlpha = (hex: string, a: number) =>
  `${normHex(hex)}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

/** rgb(r, g, b) 또는 #hex 를 '#RRGGBB' 로 */
export function toHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toUpperCase();
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}
