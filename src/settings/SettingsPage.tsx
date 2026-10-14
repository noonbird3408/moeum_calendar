import { useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { ProfileForm } from '@/auth/ProfileForm';
import { deleteMyAccount, exportMyEventsIcs } from '@/lib/account';
import { DEFAULT_PREFS, setPrefs, usePrefs, type Prefs } from '@/lib/prefs';
import { useRouter } from '@/lib/router';
import { errorMessage } from '@/lib/supabase';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { ColorPicker, Segmented, Toggle } from '@/ui/controls';
import { useFeedback } from '@/ui/Feedback';
import { Sheet } from '@/ui/Sheet';

const BUG_EMAIL = 'deleu1134@gmail.com';
const HIGHLIGHT_COLORS = ['#16a34a', '#059669', '#0ea5e9', '#2f6fed', '#7c3aed', '#f59e0b', '#e11d48'];

/** 색 이름 (목록에 없으면 HEX 만) */
const COLOR_NAMES: Record<string, string> = {
  '#16a34a': '초록',
  '#059669': '청록',
  '#0ea5e9': '하늘',
  '#2f6fed': '파랑',
  '#7c3aed': '보라',
  '#f59e0b': '주황',
  '#e11d48': '빨강',
};
const colorName = (c: string) => COLOR_NAMES[c.toLowerCase()] ?? '직접 선택';

/** 설정 한 줄: 왼쪽 이름(+설명), 오른쪽 조절기 */
function Row({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {sub && <span className="set-sub">{sub}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

/** 색 설정 한 줄: 현재 색 견본 + 이름·HEX + 팔레트 + 기본값 */
function ColorRow({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (c: string) => void }) {
  return (
    <div className="set-color">
      <div className="set-color-head">
        <span className="set-color-chip" style={{ background: value }} aria-hidden="true" />
        <span className="set-color-text">
          <b>{label}</b>
          <span className="set-sub">
            {colorName(value)} · {value.toUpperCase()}
          </span>
        </span>
        {value.toLowerCase() !== fallback.toLowerCase() && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange(fallback)}>
            기본값
          </button>
        )}
      </div>
      <ColorPicker label={label} value={value} colors={HIGHLIGHT_COLORS} onChange={onChange} />
    </div>
  );
}
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'dev';

export function reportBug() {
  const body = [
    '[버그 증상 또는 의견]',
    '',
    '',
    '[재현 방법]',
    '1. ',
    '',
    '---',
    `화면: ${window.location.pathname}`,
    `브라우저: ${navigator.userAgent}`,
    `앱 버전: ${APP_VERSION}`,
    `시각: ${new Date().toLocaleString('ko-KR')}`,
  ].join('\n');
  window.location.href = `mailto:${BUG_EMAIL}?subject=${encodeURIComponent('[모음달력] 버그 신고 & 피드백')}&body=${encodeURIComponent(body)}`;
}

export function SettingsPage() {
  const { email, signOut, userId, profile } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const { back, navigate } = useRouter();
  const { confirm, toast } = useFeedback();
  const prefs = usePrefs();
  const [exporting, setExporting] = useState(false);
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs({ [k]: v } as Partial<Prefs>);

  const logout = async () => {
    if (!(await confirm({ title: '로그아웃할까요?', confirmText: '로그아웃' }))) return;
    await signOut();
    navigate('/login', { replace: true });
  };

  const exportIcs = async () => {
    setExporting(true);
    try {
      const n = await exportMyEventsIcs(userId);
      toast(n ? `일정 ${n}개를 내보냈어요.` : '내보낼 일정이 없어요.', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  const removeAccount = async () => {
    const ok = await confirm({
      title: '계정을 삭제할까요?',
      message: (
        <>
          <p>삭제하면 되돌릴 수 없어요.</p>
          <ul className="plain-list small">
            <li>참여한 모든 캘린더에서 자동으로 나가요.</li>
            <li>내가 작성한 일정은 모두 삭제돼요.</li>
            <li>내가 관리자였던 캘린더는 다른 멤버가 관리자를 이어받아요. 멤버가 나뿐이었다면 캘린더도 삭제돼요.</li>
            <li>프로필 사진과 계정 정보가 지워지고, 다음 접속 때는 로그인 화면부터 시작해요.</li>
          </ul>
          <p>계속하려면 아래 칸에 <b>삭제</b>를 입력하세요.</p>
        </>
      ),
      confirmText: '계정 삭제',
      danger: true,
      requireText: '삭제',
    });
    if (!ok) return;
    try {
      await deleteMyAccount(userId);
      toast('계정을 삭제했어요.', 'info');
      navigate('/login', { replace: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <div className="page narrow settings-page">
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="뒤로" onClick={() => back('/')}>
          <Icon name="chevron-left" />
        </button>
        <div className="cal-name">
          <span>설정</span>
        </div>
        <div className="top-actions" />
      </header>

      <section className="card set-card">
        <h2 className="card-title">프로필</h2>
        <div className="set-profile">
          <Avatar profile={profile} size={52} />
          <div className="set-profile-text">
            <b style={{ color: profile?.color }}>{profile?.nickname}</b>
            <span className="set-sub">
              <span className="swatch-mini" style={{ background: profile?.color }} aria-hidden="true" /> 퍼스널 컬러 {profile?.color?.toUpperCase()}
            </span>
            <span className="set-sub">{email}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setProfileOpen(true)}>
            프로필 수정
          </button>
        </div>
      </section>

      <section className="card set-card">
        <h2 className="card-title">화면</h2>
        <Row label="테마">
          <Segmented
            ariaLabel="테마"
            value={prefs.theme}
            onChange={set('theme')}
            options={[
              { value: 'system', label: '시스템' },
              { value: 'light', label: '라이트' },
              { value: 'dark', label: '다크' },
            ]}
          />
        </Row>
        <Row label="글자 크기">
          <Segmented
            ariaLabel="글자 크기"
            value={prefs.fontSize}
            onChange={set('fontSize')}
            options={[
              { value: 'sm', label: '작게' },
              { value: 'md', label: '보통' },
              { value: 'lg', label: '크게' },
            ]}
          />
        </Row>
        <Row label="글꼴">
          <Segmented
            ariaLabel="글꼴"
            value={prefs.font}
            onChange={set('font')}
            options={[
              { value: 'pretendard', label: '프리텐다드' },
              { value: 'nanum', label: '나눔고딕' },
              { value: 'system', label: '기본' },
            ]}
          />
        </Row>
      </section>

      <section className="card set-card">
        <h2 className="card-title">달력</h2>
        <Row label="주 시작 요일">
          <Segmented
            ariaLabel="주 시작 요일"
            value={prefs.weekStart === 1 ? 'mon' : 'sun'}
            onChange={(v) => setPrefs({ weekStart: v === 'mon' ? 1 : 0 })}
            options={[
              { value: 'sun', label: '일요일' },
              { value: 'mon', label: '월요일' },
            ]}
          />
        </Row>
        <Row label="모바일 기본 보기">
          <Segmented
            ariaLabel="모바일 기본 보기"
            value={prefs.mobileView}
            onChange={set('mobileView')}
            options={[
              { value: 'month', label: '달력' },
              { value: 'list', label: '목록' },
            ]}
          />
        </Row>
        <Toggle label="개인 일정을 회색으로 표시" checked={prefs.grayPersonal} onChange={set('grayPersonal')} />
      </section>

      <section className="card set-card">
        <h2 className="card-title">가능한 날 표시 색</h2>
        <div className="hl-preview" aria-hidden="true">
          <span className="hl-cell hl-full">
            <b>12</b>
            <span>하루종일</span>
          </span>
          <span className="hl-cell hl-partial">
            <b>13</b>
            <span>시간대</span>
          </span>
          <span className="hl-cell">
            <b>14</b>
          </span>
        </div>
        <ColorRow label="하루종일 가능" value={prefs.fullColor} fallback={DEFAULT_PREFS.fullColor} onChange={set('fullColor')} />
        <ColorRow label="시간대 가능" value={prefs.partialColor} fallback={DEFAULT_PREFS.partialColor} onChange={set('partialColor')} />
      </section>

      <section className="card set-card">
        <h2 className="card-title">데이터 · 지원</h2>
        <button type="button" className="row-btn" onClick={exportIcs} disabled={exporting}>
          <Icon name="calendar" size={18} /> {exporting ? '내보내는 중…' : '내 일정 내보내기 (.ics)'}
        </button>
        <button type="button" className="row-btn" onClick={reportBug}>
          <Icon name="mail" size={18} /> 버그 신고 &amp; 피드백
        </button>
        <button type="button" className="row-btn danger-text" onClick={logout}>
          <Icon name="logout" size={18} /> 로그아웃
        </button>
        <button type="button" className="row-btn danger-text account-delete" onClick={removeAccount}>
          <Icon name="trash" size={18} /> 계정 삭제
        </button>
      </section>

      <p className="fine center">모음달력 v{APP_VERSION}</p>

      <Sheet open={profileOpen} onClose={() => setProfileOpen(false)} title="프로필 수정">
        <ProfileForm submitText="저장" onDone={() => setProfileOpen(false)} />
      </Sheet>
    </div>
  );
}
