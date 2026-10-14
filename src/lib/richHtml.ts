// 공지사항 서식 본문: 허용된 태그·스타일만 남기는 정리기 + 텍스트·링크 추출
// 저장할 때와 화면에 그릴 때 모두 거친다 (DB 에 무엇이 들어 있어도 이 목록 밖은 그려지지 않는다).
import { normalizeUrl } from './links';

export const FONT_SIZES = [
  { label: '작게', value: '0.85em' },
  { label: '보통', value: '1em' },
  { label: '크게', value: '1.3em' },
  { label: '아주 크게', value: '1.7em' },
] as const;

/** 글씨 크기는 1px 단위 (예전 em 값도 계속 허용) */
export const SIZE_MIN = 10;
export const SIZE_MAX = 40;

/** 고를 수 있는 글꼴 (index.html 에서 불러오는 글꼴 + 기본 글꼴 묶음) */
export const FONT_FAMILIES = [
  { key: 'pretendard', label: '프리텐다드', css: "'Pretendard Variable', Pretendard, sans-serif" },
  { key: 'nanum', label: '나눔고딕', css: "'Nanum Gothic', sans-serif" },
  { key: 'serif', label: '명조', css: "'Nanum Myeongjo', 'Noto Serif KR', serif" },
  { key: 'mono', label: '고정폭', css: "ui-monospace, Menlo, Consolas, monospace" },
] as const;
const fontKey = (v: string) => v.replace(/["'\s]/g, '').toLowerCase();
const FONT_OK = new Map<string, string>(FONT_FAMILIES.map((f) => [fontKey(f.css), f.css]));

export const TEXT_COLORS = ['#16181d', '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#6b7280'];
export const MARK_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa'];

const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'SPAN', 'A', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'FONT']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON', 'SELECT', 'FORM', 'IMG', 'VIDEO', 'AUDIO', 'LINK', 'META']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL']);
const SIZE_VALUES = new Set<string>(FONT_SIZES.map((s) => s.value));
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\))$/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;
const HAS_URL = /https?:\/\/[^\s<>"']+/;

/** 허용된 스타일만 'a: b; c: d' 로 돌려준다 */
function cleanStyle(el: HTMLElement): string {
  const s = el.style;
  const out: string[] = [];
  if (s.color && COLOR.test(s.color.trim())) out.push(`color: ${s.color.trim()}`);
  const bg = (s.backgroundColor || '').trim();
  if (bg === 'transparent') out.push('background-color: transparent');
  else if (bg && COLOR.test(bg)) out.push(`background-color: ${bg}`);
  const fs = (s.fontSize || '').trim();
  const px = /^(\d{1,2})px$/.exec(fs);
  if (px && +px[1] >= SIZE_MIN && +px[1] <= SIZE_MAX) out.push(`font-size: ${px[1]}px`);
  else if (SIZE_VALUES.has(fs)) out.push(`font-size: ${fs}`);
  const ff = s.fontFamily ? FONT_OK.get(fontKey(s.fontFamily)) : undefined;
  if (ff) out.push(`font-family: ${ff}`);
  if (/^(bold|[6-9]00)$/.test(s.fontWeight)) out.push('font-weight: 700');
  if (s.fontStyle === 'italic') out.push('font-style: italic');
  if (/underline/.test(s.textDecoration || s.textDecorationLine || '')) out.push('text-decoration: underline');
  return out.join('; ');
}

/** 링크가 아닌 글 속의 주소를 <a> 로 감싼다 */
function autolink(text: string, doc: Document, parent: Node, insideLink: boolean) {
  if (insideLink || !HAS_URL.test(text)) {
    parent.appendChild(doc.createTextNode(text));
    return;
  }
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const i = m.index ?? 0;
    if (i > last) parent.appendChild(doc.createTextNode(text.slice(last, i)));
    const href = normalizeUrl(m[0]);
    if (href) {
      const a = doc.createElement('a');
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
      a.textContent = m[0];
      parent.appendChild(a);
    } else parent.appendChild(doc.createTextNode(m[0]));
    last = i + m[0].length;
  }
  if (last < text.length) parent.appendChild(doc.createTextNode(text.slice(last)));
}

function copyChildren(from: Node, to: Node, doc: Document, insideLink: boolean) {
  from.childNodes.forEach((n) => copyNode(n, to, doc, insideLink));
}

function copyNode(node: Node, parent: Node, doc: Document, insideLink: boolean) {
  if (node.nodeType === Node.TEXT_NODE) {
    autolink(node.textContent ?? '', doc, parent, insideLink);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return;
  if (!KEEP.has(tag)) {
    copyChildren(el, parent, doc, insideLink); // 모르는 태그는 벗기고 글자만 남긴다
    return;
  }

  if (tag === 'A') {
    const href = normalizeUrl(el.getAttribute('href') ?? '');
    if (!href || insideLink) {
      copyChildren(el, parent, doc, insideLink);
      return;
    }
    const a = doc.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
    copyChildren(el, a, doc, true);
    parent.appendChild(a);
    return;
  }

  // <font color> (execCommand 결과) 는 span 으로 바꾼다
  const out = doc.createElement(tag === 'FONT' ? 'span' : tag.toLowerCase());
  let style = cleanStyle(el);
  if (tag === 'FONT') {
    const c = el.getAttribute('color');
    if (c && COLOR.test(c)) style = [style, `color: ${c}`].filter(Boolean).join('; ');
  }
  if (style) out.setAttribute('style', style);
  copyChildren(el, out, doc, insideLink);
  // 비어 있는 span 은 버린다
  if (out.tagName === 'SPAN' && !style) {
    while (out.firstChild) parent.appendChild(out.firstChild);
    return;
  }
  parent.appendChild(out);
}

/** 허용 목록만 남긴 HTML */
export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const src = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const doc = document.implementation.createHTMLDocument('');
  const root = doc.createElement('div');
  copyChildren(src.body, root, doc, false);
  return root.innerHTML;
}

/** 서식 본문 → 줄바꿈이 살아 있는 일반 텍스트 */
export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (n as Element).tagName.toUpperCase();
    if (tag === 'BR') {
      out += '\n';
      return;
    }
    n.childNodes.forEach(walk);
    if (BLOCK.has(tag) && !out.endsWith('\n')) out += '\n';
  };
  doc.body.childNodes.forEach(walk);
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** 본문 속 링크 주소 (a[href] + 글 속 주소), 중복 없이 순서대로 */
export function linksInHtml(html: string, max = 3): string[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${sanitizeHtml(html)}</body>`, 'text/html');
  const seen: string[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const u = normalizeUrl(a.getAttribute('href') ?? '');
    if (u && !seen.includes(u)) seen.push(u);
  });
  return seen.slice(0, max);
}

/** 일반 텍스트 → 안전한 HTML (예전 공지처럼 서식이 없는 글을 그릴 때) */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return sanitizeHtml(esc.replace(/\n/g, '<br>'));
}
