import { useEffect } from 'react';
import { AuthProvider, peekNext, saveNext, takeNext, useAuth } from '@/auth/AuthProvider';
import { LoginPage } from '@/auth/LoginPage';
import { OnboardingPage } from '@/auth/OnboardingPage';
import { CalendarPage } from '@/calendar/CalendarPage';
import { HomePage } from '@/calendars/HomePage';
import { JoinPage } from '@/calendars/JoinPage';
import { MembersPage } from '@/members/MembersPage';
import { SettingsPage } from '@/settings/SettingsPage';
import { supabaseConfigured } from '@/lib/supabase';
import { Navigate, RouterProvider, matchPath, useRouter } from '@/lib/router';
import { FeedbackProvider } from '@/ui/Feedback';
import { Splash } from '@/ui/controls';

/** 로그인·온보딩을 마친 뒤 원래 가려던 경로로 (렌더 중이 아니라 이펙트에서 소비해 StrictMode 이중 렌더에도 안전) */
function GoNext() {
  const { navigate } = useRouter();
  const to = peekNext() ?? '/';
  useEffect(() => {
    takeNext();
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}

function Routes() {
  const { status } = useAuth();
  const { path, pathname } = useRouter();

  if (status === 'loading') return <Splash />;

  // 1) 로그인 관문
  if (status === 'signedOut') {
    if (pathname !== '/login') {
      saveNext(path);
      return <Navigate to="/login" />;
    }
    return <LoginPage />;
  }

  // 2) 프로필 관문
  if (status === 'needsProfile') {
    if (pathname !== '/onboarding') {
      saveNext(path);
      return <Navigate to="/onboarding" />;
    }
    return <OnboardingPage />;
  }

  // 3) 통과 — 로그인/온보딩 화면에 머물러 있으면 원래 가려던 곳으로
  if (pathname === '/login' || pathname === '/onboarding') return <GoNext />;
  // OAuth 가 원래 경로로 바로 돌려보낸 경우 남은 값 정리
  if (peekNext() === path) takeNext();

  let m: Record<string, string> | null;
  if (pathname === '/') return <HomePage />;
  if (pathname === '/settings') return <SettingsPage />;
  // 주소의 값은 형식부터 확인한다 (캘린더 id 는 UUID, 초대코드는 영문·숫자 6자리)
  if ((m = matchPath('/join/:code', pathname)) && CODE.test(m.code)) return <JoinPage key={m.code} code={m.code.toUpperCase()} />;
  if ((m = matchPath('/c/:id/members', pathname)) && UUID.test(m.id)) return <MembersPage key={m.id} calendarId={m.id} />;
  if ((m = matchPath('/c/:id', pathname)) && UUID.test(m.id)) return <CalendarPage key={m.id} calendarId={m.id} />;
  return <Navigate to="/" />;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9]{6}$/;

function ConfigMissing() {
  return (
    <main className="center-page">
      <div className="login-card wide">
        <h1>Supabase 설정이 필요해요</h1>
        <p className="muted">
          프로젝트 루트에 <code>.env.local</code> 파일을 만들고 <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>를 넣은 뒤 개발 서버를 다시 시작하세요.
          (예시: <code>.env.example</code>)
        </p>
      </div>
    </main>
  );
}

export default function App() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return (
    <RouterProvider>
      <FeedbackProvider>
        <AuthProvider>
          <Routes />
        </AuthProvider>
      </FeedbackProvider>
    </RouterProvider>
  );
}
