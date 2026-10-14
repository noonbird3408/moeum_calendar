import { useRef, useState, type FormEvent } from 'react';
import { PERSONAL_COLORS, textOn, withAlpha } from '@/lib/colors';
import { errorMessage } from '@/lib/supabase';
import { uploadAvatar, removeMyAvatars } from '@/lib/avatar';
import { ColorChooser } from '@/ui/ColorChooser';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';
import { useAuth } from './AuthProvider';

const RECENT_MAX = 10;

/** 닉네임 · 사진 · 퍼스널 컬러. 온보딩과 설정/프로필 시트에서 함께 쓴다 */
export function ProfileForm({ submitText, onDone }: { submitText: string; onDone?: () => void }) {
  const { profile, updateProfile, userId } = useAuth();
  const { toast, confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [color, setColor] = useState(
    profile?.nickname ? profile.color : PERSONAL_COLORS[Math.floor(Math.random() * PERSONAL_COLORS.length)],
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);

  const trimmed = nickname.trim();
  const valid = trimmed.length >= 1 && [...trimmed].length <= 12;
  const shownPhoto = removePhoto ? null : (preview ?? profile?.avatar_url ?? null);
  const unchanged =
    profile?.nickname === trimmed && profile?.color === color && !photo && !removePhoto;

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('이미지 파일만 올릴 수 있어요.', 'error');
    if (f.size > 15 * 1024 * 1024) return toast('15MB 이하의 사진을 골라 주세요.', 'error');
    setPhoto(f);
    setRemovePhoto(false);
    setPreview(URL.createObjectURL(f));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      let avatar: string | null | undefined;
      if (photo) {
        avatar = await uploadAvatar(userId, photo);
      } else if (removePhoto) {
        await removeMyAvatars(userId);
        avatar = null;
      }
      // 최근 색: 저장한 색을 맨 앞에 두고 중복 제거
      const recent = [color, ...(profile?.recent_colors ?? []).filter((c) => c.toUpperCase() !== color.toUpperCase())].slice(0, RECENT_MAX);
      await updateProfile({ nickname: trimmed, color, recent_colors: recent, ...(avatar !== undefined ? { avatar_url: avatar } : {}) });
      setPhoto(null);
      setRemovePhoto(false);
      toast('프로필을 저장했어요.', 'success');
      onDone?.();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onRemovePhoto = async () => {
    if (!(await confirm({ title: '프로필 사진을 지울까요?', confirmText: '지우기', danger: true }))) return;
    setPhoto(null);
    setPreview(null);
    setRemovePhoto(true);
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="avatar-edit">
        <button type="button" className="avatar-btn" onClick={() => fileRef.current?.click()} aria-label="프로필 사진 바꾸기">
          {shownPhoto ? (
            <img src={shownPhoto} alt="" className="avatar-img" />
          ) : (
            <span className="avatar-fallback" style={{ background: color, color: textOn(color) }}>
              {[...(trimmed || '?')][0]}
            </span>
          )}
          <span className="avatar-badge" aria-hidden="true">
            <Icon name="edit" size={14} />
          </span>
        </button>
        <div className="avatar-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => fileRef.current?.click()}>
            사진 올리기
          </button>
          {shownPhoto && (
            <button type="button" className="btn btn-ghost btn-small danger-text" onClick={onRemovePhoto}>
              사진 지우기
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      <label className="field">
        <span className="field-label">닉네임</span>
        <input
          className="input"
          value={nickname}
          maxLength={12}
          placeholder="캘린더에 표시될 이름 (최대 12자)"
          onChange={(e) => setNickname(e.target.value)}
          autoComplete="nickname"
        />
      </label>

      <div className="field">
        <span className="field-label">퍼스널 컬러</span>
        <ColorChooser label="퍼스널 컬러" value={color} presets={PERSONAL_COLORS} recent={profile?.recent_colors ?? []} onChange={setColor} />
      </div>

      <div className="field">
        <span className="field-label">미리보기</span>
        <div className="preview-row">
          <span className="chip-preview" style={{ borderLeftColor: color, background: withAlpha(color, 0.14) }}>
            <b>{trimmed || '닉네임'}</b> · 스터디 19:00
          </span>
        </div>
      </div>

      <button className="btn btn-primary btn-block" disabled={!valid || busy || unchanged}>
        {busy ? '저장 중…' : submitText}
      </button>
    </form>
  );
}
