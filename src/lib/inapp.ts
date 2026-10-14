// 카카오톡·인스타그램 등 인앱 브라우저는 구글 OAuth 를 차단한다(disallowed_useragent).
// 감지해서 외부 브라우저로 여는 방법을 안내한다.

const UA = navigator.userAgent;

export const isKakao = /KAKAOTALK/i.test(UA);
export const isInApp = isKakao || /Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|everytimeApp|DaumApps|Snapchat|; wv\)/i.test(UA);
export const isAndroid = /Android/i.test(UA);
export const isIOS = /iPhone|iPad|iPod/i.test(UA);

/** 외부 브라우저로 여는 URL (가능한 경우) */
export function externalOpenUrl(href = window.location.href): string | null {
  if (isKakao) return `kakaotalk://web/openExternal?url=${encodeURIComponent(href)}`;
  if (isAndroid) {
    const u = new URL(href);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
  }
  return null; // iOS 기타 인앱: 공유 메뉴의 'Safari로 열기' 안내
}
