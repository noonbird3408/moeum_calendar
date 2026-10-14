import { ProfileForm } from './ProfileForm';
import { useAuth } from './AuthProvider';

export function OnboardingPage() {
  const { email, signOut } = useAuth();
  return (
    <main className="center-page">
      <div className="login-card wide">
        <h1>프로필 설정</h1>
        <p className="muted">닉네임과 퍼스널 컬러를 정해 주세요.</p>
        <ProfileForm submitText="시작하기" />
        <p className="fine">
          {email} 로 로그인됨 ·{' '}
          <button type="button" className="link-btn" onClick={signOut}>
            다른 계정으로
          </button>
        </p>
      </div>
    </main>
  );
}
