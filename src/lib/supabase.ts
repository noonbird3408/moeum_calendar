import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: {
    persistSession: true, // 브라우저를 닫아도 로그인 유지 (localStorage)
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

/** 구글 로그인. 로그인 후 `next` 경로(예: /join/AB12CD)로 바로 돌아온다. */
export function signInWithGoogle(next: string) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}${next}`,
      queryParams: { prompt: 'select_account' },
    },
  });
}

const KNOWN: Record<string, string> = {
  AUTH_REQUIRED: '로그인이 필요해요.',
  PROFILE_REQUIRED: '프로필을 먼저 설정해 주세요.',
  INVALID_CODE: '유효하지 않은 초대코드예요.',
  FORBIDDEN: '권한이 없어요.',
  LAST_ADMIN: '마지막 관리자는 나가거나 강등될 수 없어요. 다른 멤버를 관리자로 지정해 주세요.',
  NO_ROWS: '권한이 없거나 이미 삭제된 항목이에요.',
  EVENT_FULL: '참여 인원이 다 찼어요.',
  TOO_MANY_ATTEMPTS: '초대코드를 너무 여러 번 틀렸어요. 15분 뒤에 다시 시도해 주세요.',
  BAD_PARENT: '답글은 원 댓글에만 달 수 있어요.',
  BAD_EVENT_TAG: '이 캘린더의 전체 일정만 태그할 수 있어요.',
  TOO_FAST: '너무 빨리 여러 번 저장했어요. 잠시 뒤 다시 시도해 주세요.',
};

/** Supabase/Postgres 오류를 사용자용 한국어 문장으로 */
export function errorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string; hint?: string } | null;
  const msg = err?.message ?? String(e);
  if (msg.includes('QUOTA_EXCEEDED')) return err?.hint || '사용 한도를 넘었어요.';
  for (const k of Object.keys(KNOWN)) if (msg.includes(k)) return KNOWN[k];
  if (err?.code === '42501' || msg.includes('row-level security') || msg.includes('permission denied'))
    return '권한이 없어요.';
  if (err?.code === 'PGRST116') return KNOWN.NO_ROWS;
  if (msg.includes('events_time_order')) return '종료 시간이 시작 시간보다 늦어야 해요.';
  if (msg.includes('events_date_order')) return '종료 날짜가 시작 날짜보다 빠를 수 없어요.';
  if (msg.includes('events_max_span')) return '일정 기간이 너무 길어요.';
  if (msg.includes('events_images_ok')) return '사진은 4장까지 올릴 수 있어요.';
  if (msg.includes('payload too large') || msg.includes('exceeded the maximum allowed size')) return '사진 용량이 너무 커요.';
  if (msg.includes('mime type')) return 'JPG·PNG·WEBP 사진만 올릴 수 있어요.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return '네트워크 연결을 확인해 주세요.';
  return '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
}
