// 외부 링크 미리보기. 서버가 없으므로 CORS 를 허용하는 공식 oEmbed 엔드포인트만 쓴다.
//  · YouTube: 제목·채널명·썸네일 (youtube.com/oembed)
//  · X(트위터): 작성자·본문 (publish.twitter.com/oembed)
//  · 그 밖의 사이트: 주소와 도메인만 카드로 표시
export type LinkInfo =
  | { kind: 'youtube'; url: string; title: string; author: string; thumb: string }
  | { kind: 'x'; url: string; title: string; author: string }
  | { kind: 'site'; url: string; host: string };

export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

const cache = new Map<string, LinkInfo>();
// 미리보기 요청에 우리 주소(캘린더 id 가 들어 있음)나 쿠키를 보내지 않는다
const NO_LEAK: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' };

export async function previewLink(url: string): Promise<LinkInfo> {
  const hit = cache.get(url);
  if (hit) return hit;
  const host = new URL(url).hostname.replace(/^www\./, '');
  let info: LinkInfo = { kind: 'site', url, host };

  try {
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
      const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, NO_LEAK);
      if (r.ok) {
        const j = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        info = { kind: 'youtube', url, title: j.title ?? url, author: j.author_name ?? '', thumb: j.thumbnail_url ?? '' };
      }
    } else if (/(^|\.)(twitter|x)\.com$/.test(host)) {
      const r = await fetch(`https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`, NO_LEAK);
      if (r.ok) {
        const j = (await r.json()) as { html?: string; author_name?: string };
        // 응답 HTML 은 innerHTML 로 넣지 않고 텍스트만 꺼낸다
        const doc = new DOMParser().parseFromString(j.html ?? '', 'text/html');
        const text = doc.querySelector('p')?.textContent?.trim() ?? '';
        info = { kind: 'x', url, title: text || url, author: j.author_name ?? '' };
      }
    }
  } catch {
    /* 네트워크 실패 시 기본 카드 */
  }
  cache.set(url, info);
  return info;
}

/** 본문 안의 http(s) 주소를 순서대로 찾는다 (단체 일정 설명의 링크 미리보기용) */
export function findUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
}
