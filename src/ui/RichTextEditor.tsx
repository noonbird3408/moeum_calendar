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
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
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

  const emit = () => {
    const el = box.current;
    if (!el) return;
    setEmpty(!el.textContent?.trim());
    onChange(el.innerHTML);
  };

  const restore = () => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const r = saved.current;
    if (r) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  };

  const run = (fn: () => void) => {
    restore();
    exec('styleWithCSS', 'false');
    fn();
    emit();
  };

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
        {tool('B', '굵게', () => run(() => exec('bold')), active.bold, 'rt-b')}
        {tool('I', '기울임', () => run(() => exec('italic')), active.italic, 'rt-i')}
        {tool('U', '밑줄', () => run(() => exec('underline')), active.underline, 'rt-u')}
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
        onInput={emit}
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
