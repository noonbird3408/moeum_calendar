// 기기별 화면 설정 (localStorage). 계정 간 공유가 필요 없는 값만 둔다.
import { useSyncExternalStore } from 'react';

export type Prefs = {
  theme: 'system' | 'light' | 'dark';
  fontSize: 'sm' | 'md' | 'lg';
  font: 'pretendard' | 'nanum' | 'system';
  grayPersonal: boolean; // 개인 일정을 회색으로 표시
  mobileView: 'month' | 'list';
  dayStart: number; // 빈 시간 계산 활동 시작 (분)
  dayEnd: number; // 활동 종료 (분)
  minFree: number; // 최소 빈 시간 (분) — 필터 UI 는 없고 기본값으로만 계산
  showFull: boolean; // 달력에 '모두 가능한 날' 표시
  showPartial: boolean; // 달력에 '시간대 가능한 날' 표시
  weekStart: 0 | 1; // 주 시작 요일 (0=일, 1=월)
  fullColor: string; // '하루종일 가능' 강조색
  partialColor: string; // '시간대 가능' 강조색
};

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  fontSize: 'md',
  font: 'pretendard',
  grayPersonal: false,
  mobileView: 'month',
  dayStart: 9 * 60,
  dayEnd: 24 * 60,
  minFree: 120,
  showFull: true,
  showPartial: true,
  weekStart: 0,
  fullColor: '#16a34a',
  partialColor: '#2f6fed',
};

const FONT_SIZE = { sm: '14px', md: '16px', lg: '18px' } as const;
const FONT = {
  pretendard: "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  nanum: "'Nanum Gothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  system: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
} as const;

function load(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('prefs') || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

let prefs = load();
const listeners = new Set<() => void>();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function applyPrefs(p: Prefs = prefs) {
  const root = document.documentElement;
  const dark = p.theme === 'dark' || (p.theme === 'system' && darkQuery.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.fontSize = FONT_SIZE[p.fontSize];
  root.style.setProperty('--font-sans', FONT[p.font]);
  root.style.setProperty('--hl-full', p.fullColor);
  root.style.setProperty('--hl-partial', p.partialColor);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16181d' : '#ffffff');
}

darkQuery.addEventListener?.('change', () => applyPrefs());

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem('prefs', JSON.stringify(prefs));
  } catch {
    /* 사생활 보호 모드 등에서는 저장 생략 */
  }
  applyPrefs();
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
  );
}
