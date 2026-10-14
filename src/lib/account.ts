// 계정 삭제 · 내 일정 내보내기 (설정 탭에서 사용)
import { todayYmd } from './dates';
import { buildIcs, downloadText } from './ics';
import { removeMyAvatars } from './avatar';
import { supabase } from './supabase';
import type { CalendarEvent } from '@/types';

/** 이 기기에 남겨 둔 앱 상태를 지운다 (계정 삭제·로그아웃 뒤) */
export function clearLocalAppState() {
  try {
    localStorage.removeItem('lastCalendar');
  } catch {
    /* noop */
  }
  try {
    sessionStorage.removeItem('next');
  } catch {
    /* noop */
  }
}

/**
 * 계정 삭제:
 * 1) 내 프로필 사진 파일을 Storage 에서 먼저 지운다 (DB 함수로는 Storage 객체를 지울 수 없다)
 * 2) delete_my_account() 가 들어간 캘린더에서 나가고(관리자 승계·빈 캘린더 삭제), 내 일정을 지운 뒤 auth 사용자를 삭제한다
 * 3) 이 기기의 세션을 끊는다 (서버 사용자는 이미 없어서 실패해도 무시)
 */
export async function deleteMyAccount(uid: string) {
  await removeMyAvatars(uid).catch(() => undefined);
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  clearLocalAppState();
}

/** 내가 작성한 모든 일정을 .ics 로 내려받는다 (반복 일정은 RRULE 로 저장) */
export async function exportMyEventsIcs(uid: string) {
  const [evRes, calRes] = await Promise.all([
    supabase.from('events').select('*').eq('author_id', uid).order('start_date'),
    supabase.from('calendars').select('id, name'),
  ]);
  if (evRes.error) throw evRes.error;
  if (calRes.error) throw calRes.error;
  const names = new Map<string, string>((calRes.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const events = (evRes.data ?? []) as CalendarEvent[];
  const text = buildIcs(events, (id) => names.get(id) ?? '모음달력');
  downloadText(`모음달력-내일정-${todayYmd()}.ics`, text);
  return events.length;
}
