// 기기별 화면 설정 (localStorage). 계정 간 공유가 필요 없는 값만 둔다.
import { useSyncExternalStore } from 'react';
import { textOn } from './colors';

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
  // 예전 기본값(#2f6fed)은 '오늘'·토요일·강조 버튼과 같은 파랑이라 구분이 안 돼 보라로 바꿈
  partialColor: '#8b5cf6',
};

const OLD_PARTIAL_DEFAULT = '#2f6fed';

const FONT_SIZE = { sm: '14px', md: '16px', lg: '18px' } as const;
const FONT = {
  pretendard: "'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  nanum: "'Nanum Gothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
  system: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
} as const;

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem('prefs') || '{}');
    // 직접 고른 적 없이 예전 기본 파랑이 저장돼 있던 경우만 새 기본값으로 옮긴다
    if (typeof saved.partialColor === 'string' && saved.partialColor.toLowerCase() === OLD_PARTIAL_DEFAULT) delete saved.partialColor;
    return { ...DEFAULT_PREFS, ...saved };
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
  // 강조색 위 글자색(대비가 큰 쪽)
  root.style.setProperty('--hl-full-fg', textOn(p.fullColor));
  root.style.setProperty('--hl-partial-fg', textOn(p.partialColor));
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
