// 현재 이 캘린더에 접속 중인 멤버 (Supabase Realtime Presence, 서버 없이 채널로만 동작)
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function usePresence(calendarId: string, userId: string) {
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    // 비공개 채널 'presence:<캘린더 id>': DB 정책(011)이 같은 캘린더 멤버만 듣고 보내게 한다
    // key 를 user id 로 두면 presenceState() 의 키가 곧 접속 중인 사용자 id 가 된다
    let alive = true;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      await supabase.realtime?.setAuth?.(); // 로그인 토큰으로 채널 권한을 확인받는다
      if (!alive) return;
      const c = supabase.channel(`presence:${calendarId}`, { config: { private: true, presence: { key: userId } } });
      ch = c;
      c.on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(c.presenceState())));
      }).subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') await c.track({ at: Date.now() });
      });
    })();

    return () => {
      alive = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, [calendarId, userId]);

  return online;
}
