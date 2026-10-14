import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearLocalAppState } from '@/lib/account';
import type { Profile } from '@/types';

type Status = 'loading' | 'signedOut' | 'needsProfile' | 'ready';

export type ProfilePatch = { nickname?: string; color?: string; avatar_url?: string | null; recent_colors?: string[] };

const PROFILE_COLUMNS = 'id, nickname, color, avatar_url, recent_colors';

type AuthValue = {
  status: Status;
  session: Session | null;
  userId: string;
  email: string;
  profile: Profile | null;
  updateProfile: (patch: ProfilePatch) => Promise<void>;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // 어떤 사용자의 프로필인지 함께 저장해, 사용자 전환 직후의 오래된 값으로 판단하지 않게 한다
  const [loaded, setLoaded] = useState<{ uid: string; profile: Profile | null } | null>(null);
  const userId = session?.user.id ?? '';
  const profile = loaded && loaded.uid === userId ? loaded.profile : undefined;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    // 콜백 안에서 다른 supabase 호출을 await 하지 않는다 (SDK 교착 방지)
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // OAuth(PKCE) 복귀 후 주소창에 남은 ?code= 정리
  useEffect(() => {
    if (!session) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  }, [session]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setLoaded({ uid: userId, profile: (data as Profile | null) ?? null });
      });
    return () => {
      alive = false;
    };
  }, [userId]); // 토큰 갱신(세션 객체 교체) 때마다 다시 불러오지 않도록 userId 에만 의존

  const reloadProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
    setLoaded({ uid: userId, profile: (data as Profile | null) ?? null });
  }, [userId]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      const body: ProfilePatch = { ...patch };
      if (typeof body.nickname === 'string') body.nickname = body.nickname.trim();
      const { data, error } = await supabase.from('profiles').update(body).eq('id', userId).select(PROFILE_COLUMNS).single();
      if (error) throw error;
      setLoaded({ uid: userId, profile: data as Profile });
    },
    [userId],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    clearLocalAppState(); // 같은 기기를 다른 사람이 쓸 때 마지막 캘린더 등이 남지 않게
    setSession(null);
  }, []);

  let status: Status = 'loading';
  if (session === null) status = 'signedOut';
  else if (session && profile !== undefined) status = profile?.nickname ? 'ready' : 'needsProfile';

  return (
    <AuthContext.Provider
      value={{
        status,
        session: session ?? null,
        userId,
        email: session?.user.email ?? '',
        profile: profile ?? null,
        updateProfile,
        reloadProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider 가 필요합니다');
  return ctx;
}

// 로그인/온보딩 후 돌아갈 경로 (OAuth 왕복 동안 유지되도록 sessionStorage)
// 이 사이트 안의 경로만 허용한다 ('//다른사이트', '/\다른사이트', 'https://…' 같은 값은 버림)
const safePath = (v: string | null): string | null =>
  v && /^\/(?![\/\\])[^\s]*$/.test(v) && v.length <= 300 ? v : null;

export function saveNext(path: string) {
  if (!safePath(path)) return;
  if (path.startsWith('/login') || path.startsWith('/onboarding')) return;
  try {
    sessionStorage.setItem('next', path);
  } catch {
    /* noop */
  }
}

export function takeNext(): string | null {
  try {
    const v = sessionStorage.getItem('next');
    sessionStorage.removeItem('next');
    return safePath(v);
  } catch {
    return null;
  }
}

export function peekNext(): string | null {
  try {
    return safePath(sessionStorage.getItem('next'));
  } catch {
    return null;
  }
}
