// 프로필 사진 또는 이름 첫 글자(퍼스널 컬러 배경)
import type { Profile } from '@/types';
import { GRAY, textOn } from '@/lib/colors';

// 프로필 사진은 우리 Supabase 저장소나 구글 계정 사진만 그린다 (다른 주소로 바꿔서 보는 사람을 추적하지 못하게)
const SUPA = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL ?? '').host;
  } catch {
    return '';
  }
})();
export function safeAvatarUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    if ((SUPA && url.host === SUPA && url.pathname.startsWith('/storage/v1/object/public/avatars/')) || url.host.endsWith('.googleusercontent.com')) return url.toString();
  } catch {
    /* noop */
  }
  return null;
}

export function Avatar({ profile, size = 28, title }: { profile: Pick<Profile, 'nickname' | 'color' | 'avatar_url'> | null | undefined; size?: number; title?: string }) {
  const color = profile?.color ?? GRAY;
  const name = profile?.nickname ?? '?';
  const src = safeAvatarUrl(profile?.avatar_url);
  if (src) {
    return <img className="avatar-img" src={src} referrerPolicy="no-referrer" alt={title ?? name} style={{ width: size, height: size }} loading="lazy" />;
  }
  return (
    <span className="avatar-fallback" title={title ?? name} style={{ background: color, color: textOn(color), width: size, height: size, fontSize: Math.round(size * 0.45) }}>
      {[...name][0]}
    </span>
  );
}
