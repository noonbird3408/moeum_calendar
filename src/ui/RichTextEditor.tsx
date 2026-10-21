// 공지 본문 편집기: 글꼴 · 글씨 크기(1px 단위) · 굵게 · 기울임 · 밑줄 · 글자색 · 형광펜(팔레트·직접 선택·스포이트)
// contentEditable + execCommand 로 편집하고, 저장·표시할 때 richHtml.sanitizeHtml 로 정리한다.
// 본문에 적은 주소는 저장할 때 자동으로 링크가 되고, 아래에 미리보기가 붙는다.
import { useEffect, useRef, useState } from 'react';
import { FONT_FAMILIES, MARK_COLORS, TEXT_COLORS, SIZE_MIN, SIZE_MAX } from '@/lib/richHtml';

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
};

type Pop = 'color' | 'mark' | null;

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);
// 목록에서 바로 고르는 크기 (±1px 버튼으로 그 사이 크기도 고를 수 있다)
const SIZE_STEPS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40];

// ── 커서만 있을 때(글자를 고르지 않았을 때) 굵게·기울임·밑줄 켜고 끄기 ──
// 브라우저 기본 execCommand 는 '다음에 칠 글자' 서식을 잠깐만 기억해서, 한글 입력(조합) 중이거나
// 선택 영역을 다시 잡으면 쉽게 잊어버린다. 그래서 커서 자리에 서식 요소를 직접 만들어 그 안에서 이어 쓰게 한다.
type Fmt = 'bold' | 'italic' | 'underline';
const ZW = '\u200B'; // 커서를 넣어 둘 보이지 않는 글자 (저장할 때는 지운다)
const FMT_TAG: Record<Fmt, string> = { bold: 'b', italic: 'i', underline: 'u' };
const FMT_CMD: Record<Fmt, string> = { bold: 'bold', italic: 'italic', underline: 'underline' };

const elOf = (n: Node | null): HTMLElement | null => (!n ? null : n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement);

/** 이 요소가 직접 그 서식을 주는지 (태그나 인라인 스타일) */
function gives(el: HTMLElement, f: Fmt): boolean {
  const t = el.tagName;
  if (f === 'bold') return t === 'B' || t === 'STRONG' || /^(bold|bolder|[6-9]00)$/.test(el.style.fontWeight);
  if (f === 'italic') return t === 'I' || t === 'EM' || el.style.fontStyle === 'italic';
  return t === 'U' || /underline/.test(el.style.textDecorationLine || el.style.textDecoration);
}

/** 커서 위치에 서식이 걸려 있는지 (실제 화면에 보이는 모양 기준) */
function isOn(root: HTMLElement, node: Node | null, f: Fmt): boolean {
  const el = elOf(node);
  if (!el || !root.contains(el)) return false;
  if (f === 'bold') return Number(getComputedStyle(el).fontWeight) >= 600;
  if (f === 'italic') return getComputedStyle(el).fontStyle === 'italic';
  for (let e: HTMLElement | null = el; e && e !== root; e = e.parentElement) {
    if (/underline/.test(getComputedStyle(e).textDecorationLine)) return true;
  }
  return false;
}

const placeCaret = (node: Node, offset: number) => {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  return r;
};

/** 커서 자리에서 서식을 켜거나 끈다. 처리했으면 true */
function toggleAtCaret(root: HTMLElement, f: Fmt): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed || !root.contains(r.startContainer)) return false;

  if (!isOn(root, r.startContainer, f)) {
    // 켜기: <b>​</b> 를 넣고 그 안으로 커서를 옮긴다
    const w = document.createElement(FMT_TAG[f]);
    const t = document.createTextNode(ZW);
    w.appendChild(t);
    r.insertNode(w);
    placeCaret(t, 1);
    return true;
  }

  // 끄기: 서식을 주는 가장 가까운 요소를 찾는다
  let a: HTMLElement | null = elOf(r.startContainer);
  while (a && a !== root && !gives(a, f)) a = a.parentElement;
  if (!a || a === root) return false; // 제목 등 바깥에서 온 서식 → 브라우저 기본 처리

  // 커서와 a 사이에 있는 다른 서식 요소들 (예: <b><i>글|</i></b> 에서 굵게만 끌 때 기울임은 유지)
  const inner: HTMLElement[] = [];
  for (let e = elOf(r.startContainer); e && e !== a; e = e.parentElement) inner.push(e);

  // a 를 커서 기준으로 둘로 나눈다
  const tail = document.createRange();
  tail.setStart(r.startContainer, r.startOffset);
  tail.setEnd(a, a.childNodes.length);
  const rest = tail.extractContents();

  // 가운데: a 의 다른 스타일(글자색 등)은 살리고 이 서식만 뺀 껍데기 + 안쪽 서식들
  const shells: HTMLElement[] = [];
  if (a.tagName === 'SPAN') {
    const shell = a.cloneNode(false) as HTMLElement;
    if (f === 'bold') shell.style.removeProperty('font-weight');
    if (f === 'italic') shell.style.removeProperty('font-style');
    if (f === 'underline') {
      shell.style.removeProperty('text-decoration');
      shell.style.removeProperty('text-decoration-line');
    }
    if (shell.getAttribute('style')?.trim()) shells.push(shell);
  }
  for (const e of inner.reverse()) if (!gives(e, f)) shells.push(e.cloneNode(false) as HTMLElement);
  const caretText = document.createTextNode(ZW);
  shells.forEach((el, i) => el.appendChild(i + 1 < shells.length ? shells[i + 1] : caretText));
  const middle: Node = shells[0] ?? caretText;

  const after = a.nextSibling;
  const parent = a.parentNode!;
  parent.insertBefore(middle, after);
  if ((rest.textContent ?? '').replace(new RegExp(ZW, 'g'), '')) {
    const a2 = a.cloneNode(false) as HTMLElement;
    a2.appendChild(rest);
    parent.insertBefore(a2, middle.nextSibling);
  }
  if (!(a.textContent ?? '').replace(new RegExp(ZW, 'g'), '')) a.remove();
  placeCaret(caretText, 1);
  return true;
}

/** 다른 글자와 같이 있는 보이지 않는 글자는 지운다 (커서 위치는 그대로) — 한글 조합 중에는 건드리지 않는다 */
function sweepZw(root: HTMLElement) {
  const sel = window.getSelection();
  const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (t.data.includes(ZW) && t.data.length > 1) nodes.push(t);
  }
  for (const t of nodes) {
    const caretHere = r && r.collapsed && r.startContainer === t;
    const before = caretHere ? t.data.slice(0, r!.startOffset).split(ZW).length - 1 : 0;
    const newOffset = caretHere ? r!.startOffset - before : 0;
    t.data = t.data.split(ZW).join('');
    if (caretHere) placeCaret(t, Math.min(newOffset, t.data.length));
  }
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | null => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null;

export function RichTextEditor({ initialHtml, onChange, placeholder }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const saved = useRef<Range | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [size, setSize] = useState(16);
  const [font, setFont] = useState('');
  const [active, setActive] = useState({ bold: false, italic: false, underline: false });
  const [empty, setEmpty] = useState(!initialHtml);
  const composing = useRef(false); // 한글 등 조합 입력 중

  // 처음 한 번만 내용을 넣는다 (이후에는 브라우저가 직접 편집)
  useEffect(() => {
    if (box.current) box.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 커서가 편집기 안에 있을 때 선택 영역과 현재 서식을 기억한다
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !box.current) return;
      const r = sel.getRangeAt(0);
      if (!box.current.contains(r.commonAncestorContainer)) return;
      saved.current = r.cloneRange();
      refreshActive();
      // 선택이 시작되는 글자의 실제 크기를 읽는다 (요소 경계에서 시작하면 그 안 첫 글자로 내려간다)
      let n: Node | null = r.startContainer;
      if (n.nodeType === Node.ELEMENT_NODE && n.childNodes[r.startOffset]) n = n.childNodes[r.startOffset];
      while (n && n.nodeType === Node.ELEMENT_NODE && n.firstChild) n = n.firstChild;
      const node = n ? (n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as HTMLElement)) : null;
      if (node && box.current.contains(node)) {
        const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
        if (px >= SIZE_MIN && px <= SIZE_MAX) setSize(px);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  // 커서 위치의 서식으로 B·I·U 버튼 켜짐 표시를 맞춘다
  function refreshActive() {
    const el = box.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return;
    // 글자를 골랐으면 브라우저 판단, 커서만 있으면 커서 자리의 실제 모양
    const pick = (f: Fmt) => (r.collapsed ? isOn(el, r.startContainer, f) : document.queryCommandState(FMT_CMD[f]));
    const next = { bold: pick('bold'), italic: pick('italic'), underline: pick('underline') };
    setActive((p) => (p.bold === next.bold && p.italic === next.italic && p.underline === next.underline ? p : next));
  }

  const emit = () => {
    const el = box.current;
    if (!el) return;
    const text = (el.textContent ?? '').split(ZW).join('');
    setEmpty(!text.trim());
    onChange(el.innerHTML.split(ZW).join(''));
  };

  // 편집기 안에 커서가 이미 있으면 그대로 두고, 밖에 있을 때만 기억해 둔 자리로 되돌린다
  // (같은 자리라도 다시 잡으면 브라우저가 '다음 글자 서식'을 잊어버린다)
  const restore = () => {
    const el = box.current;
    if (!el) return;
    const sel = window.getSelection();
    const inside = !!sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer);
    if (document.activeElement !== el) el.focus();
    if (!inside && saved.current) {
      sel?.removeAllRanges();
      sel?.addRange(saved.current);
    }
  };

  const run = (fn: () => void) => {
    const go = () => {
      restore();
      exec('styleWithCSS', 'false');
      fn();
      const sel = window.getSelection();
      if (sel && sel.rangeCount) saved.current = sel.getRangeAt(0).cloneRange();
      refreshActive();
      emit();
    };
    // 한글을 조합하는 도중에 버튼을 누르면 먼저 조합을 끝낸 뒤 적용한다 (안 그러면 버튼이 씹힌다)
    if (composing.current && box.current) {
      box.current.blur();
      window.setTimeout(go, 0);
    } else go();
  };

  // 굵게·기울임·밑줄: 글자를 골랐으면 그 글자에, 커서만 있으면 이어서 쓸 글자에 적용
  const toggle = (f: Fmt) =>
    run(() => {
      if (!box.current || !toggleAtCaret(box.current, f)) exec(FMT_CMD[f]);
    });

  // 선택한 글자를 원하는 px 크기의 span 으로 감싼다 (브라우저 기본 크기 7로 감싼 뒤 바꿔 치기)
  const applySize = (px: number) => {
    const v = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(px)));
    setSize(v);
    run(() => {
      exec('fontSize', '7');
      const made: HTMLElement[] = [];
      box.current?.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = `${v}px`;
        // 안쪽에 이미 있던 글씨 크기는 지워서 새 크기가 보이게 한다
        f.querySelectorAll<HTMLElement>('[style]').forEach((el) => el.style.removeProperty('font-size'));
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
        made.push(span);
      });
      // 바꿔 친 span 을 다시 선택해 두어야 +/− 를 이어서 누를 수 있다
      if (made.length) {
        const r = document.createRange();
        r.setStartBefore(made[0]);
        r.setEndAfter(made[made.length - 1]);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        saved.current = r.cloneRange();
      }
    });
  };

  const applyFont = (key: string) => {
    setFont(key);
    const f = FONT_FAMILIES.find((x) => x.key === key);
    if (!f) return;
    run(() => {
      exec('styleWithCSS', 'true');
      exec('fontName', f.css);
      exec('styleWithCSS', 'false');
    });
  };

  const applyColor = (c: string, kind: 'fore' | 'mark') => {
    run(() => {
      exec('styleWithCSS', 'true');
      exec(kind === 'fore' ? 'foreColor' : 'hiliteColor', c);
      exec('styleWithCSS', 'false');
    });
    setPop(null);
  };

  const pickFromScreen = async (kind: 'fore' | 'mark') => {
    const Ctor = eyeDropper();
    if (!Ctor) return;
    try {
      const { sRGBHex } = await new Ctor().open();
      applyColor(sRGBHex, kind);
    } catch {
      /* 사용자가 취소 */
    }
  };

  const keep = (e: { preventDefault: () => void }) => e.preventDefault(); // 버튼을 눌러도 선택 영역 유지

  const tool = (label: string, title: string, onClick: () => void, on = false, cls = '') => (
    <button type="button" className={`rt-btn ${on ? 'on' : ''} ${cls}`} title={title} aria-label={title} aria-pressed={on} onMouseDown={keep} onClick={onClick}>
      {label}
    </button>
  );

  const palette = (kind: 'fore' | 'mark') => (
    <div className="rt-pop" role="group" aria-label={kind === 'fore' ? '글자색' : '형광펜 색'}>
      {(kind === 'fore' ? TEXT_COLORS : MARK_COLORS).map((c) => (
        <button key={c} type="button" className="rt-swatch" style={{ background: c }} aria-label={c} onMouseDown={keep} onClick={() => applyColor(c, kind)} />
      ))}
      <label className="rt-swatch rt-custom" title="직접 고르기" aria-label="직접 고르기" onMouseDown={() => restore()}>
        <input type="color" onChange={(e) => applyColor(e.target.value, kind)} />+
      </label>
      {eyeDropper() && (
        <button type="button" className="rt-btn rt-eye" title="스포이트" aria-label="스포이트로 색 고르기" onMouseDown={keep} onClick={() => pickFromScreen(kind)}>
          스포이트
        </button>
      )}
      {kind === 'mark' && (
        <button type="button" className="rt-btn" onMouseDown={keep} onClick={() => applyColor('transparent', 'mark')}>
          없음
        </button>
      )}
    </div>
  );

  return (
    <div className="rt">
      <div className="rt-bar" role="toolbar" aria-label="글 서식">
        <select className="rt-font" aria-label="글꼴" value={font} onChange={(e) => applyFont(e.target.value)}>
          <option value="">글꼴</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="rt-size" role="group" aria-label="글씨 크기">
          <button type="button" className="rt-btn rt-step" aria-label="글씨 1px 작게" title="1px 작게" onMouseDown={keep} onClick={() => applySize(size - 1)} disabled={size <= SIZE_MIN}>
            <span aria-hidden="true">A</span>−
          </button>
          <select
            className="rt-size-select"
            aria-label="글씨 크기(px)"
            value={size}
            onChange={(e) => applySize(Number(e.target.value))}
          >
            {(SIZE_STEPS.includes(size) ? SIZE_STEPS : [...SIZE_STEPS, size].sort((a, b) => a - b)).map((v) => (
              <option key={v} value={v}>
                {v}px{v === 16 ? ' (기본)' : ''}
              </option>
            ))}
          </select>
          <button type="button" className="rt-btn rt-step" aria-label="글씨 1px 크게" title="1px 크게" onMouseDown={keep} onClick={() => applySize(size + 1)} disabled={size >= SIZE_MAX}>
            <span aria-hidden="true">A</span>+
          </button>
        </div>
        {tool('B', '굵게', () => toggle('bold'), active.bold, 'rt-b')}
        {tool('I', '기울임', () => toggle('italic'), active.italic, 'rt-i')}
        {tool('U', '밑줄', () => toggle('underline'), active.underline, 'rt-u')}
        {tool('A', '글자색', () => setPop(pop === 'color' ? null : 'color'), pop === 'color', 'rt-color')}
        {tool('형광펜', '형광펜', () => setPop(pop === 'mark' ? null : 'mark'), pop === 'mark', 'rt-mark')}
      </div>
      {pop && palette(pop === 'color' ? 'fore' : 'mark')}

      <div
        ref={box}
        className={`rt-area rich-view ${empty ? 'is-empty' : ''}`}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="내용"
        data-placeholder={placeholder ?? ''}
        onInput={(e) => {
          if (!(e.nativeEvent as InputEvent).isComposing && !composing.current && box.current) sweepZw(box.current);
          emit();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          const sel = window.getSelection();
          if (box.current && sel && sel.rangeCount && box.current.contains(sel.getRangeAt(0).startContainer)) {
            saved.current = sel.getRangeAt(0).cloneRange();
          }
          if (box.current) sweepZw(box.current);
          emit();
        }}
        onKeyDown={(e) => {
          // 단축키도 같은 방식으로 (Ctrl/⌘ + B · I · U)
          if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.nativeEvent.isComposing) return;
          const f: Fmt | null = e.key === 'b' || e.key === 'B' ? 'bold' : e.key === 'i' || e.key === 'I' ? 'italic' : e.key === 'u' || e.key === 'U' ? 'underline' : null;
          if (!f) return;
          e.preventDefault();
          toggle(f);
        }}
        onBlur={emit}
        onPaste={(e) => {
          // 다른 곳의 서식은 가져오지 않고 글자만 붙인다
          e.preventDefault();
          exec('insertText', e.clipboardData.getData('text/plain'));
          emit();
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}
