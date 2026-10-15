// 달력 아래 메모 탭: 캘린더 멤버 모두가 보는 메모 목록 (실시간 반영)
//  · + 버튼으로 새 메모 작성 — 멤버 누구나
//  · 메모마다 작성자 · 작성 시간 표시 (고친 메모는 '수정됨')
//  · 수정은 작성자 본인, 삭제는 작성자 본인 또는 관리자
import { useEffect, useState } from 'react';
import type { Memo, Profile } from '@/types';
import { GRAY } from '@/lib/colors';
import { errorMessage, supabase } from '@/lib/supabase';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';

const MAX = 5000;
const PAGE = 5;
const COLS = 'id, calendar_id, author_id, body, created_at, updated_at';
const uniq = () => Math.random().toString(36).slice(2, 8);
const pad = (n: number) => String(n).padStart(2, '0');

/** '10/15 21:30' — 올해가 아니면 '25년 10/15 21:30' */
function when(iso: string) {
  const d = new Date(iso);
  const s = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === new Date().getFullYear() ? s : `${String(d.getFullYear()).slice(2)}년 ${s}`;
}

function useMemoList(calendarId: string) {
  const [rows, setRows] = useState<Memo[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from('memos')
      .select(COLS)
      .eq('calendar_id', calendarId)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) {
      setFailed(true);
      setRows((r) => r ?? []);
      return;
    }
    setFailed(false);
    setRows((data ?? []) as Memo[]);
  };

  useEffect(() => {
    let alive = true;
    setRows(null);
    const reload = () => {
      if (alive) void load();
    };
    reload();
    const ch = supabase
      .channel(`memos:${calendarId}:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memos', filter: `calendar_id=eq.${calendarId}` }, reload)
      // 삭제 알림은 PK 만 오므로 한 번 더 불러온다
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'memos' }, reload)
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarId]);

  return { rows, setRows, failed, reload: load };
}

function MemoEditor({
  initial = '',
  submitText,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitText: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const body = text.trim();
  const send = async () => {
    if (!body || busy) return;
    setBusy(true);
    const ok = await onSubmit(body);
    setBusy(false);
    if (ok) setText('');
  };
  return (
    <div className="memo-editor">
      <textarea
        className="input memo-text"
        value={text}
        maxLength={MAX}
        autoFocus
        placeholder="모두가 볼 수 있는 메모를 적어 보세요"
        aria-label="메모 내용"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="memo-editor-foot">
        <span className="memo-count">
          {text.length}/{MAX}
        </span>
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel} disabled={busy}>
          취소
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={send} disabled={!body || busy}>
          {busy ? '저장 중…' : submitText}
        </button>
      </div>
    </div>
  );
}

export function Memos({
  calendarId,
  myId,
  isAdmin,
  profiles,
}: {
  calendarId: string;
  myId: string;
  isAdmin: boolean;
  profiles: Map<string, Profile>;
}) {
  const { toast, confirm } = useFeedback();
  const { rows, setRows, failed, reload } = useMemoList(calendarId);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setComposing(false);
    setEditing(null);
    setShowAll(false);
  }, [calendarId]);

  const add = async (body: string) => {
    const { data, error } = await supabase
      .from('memos')
      .insert({ calendar_id: calendarId, author_id: myId, body })
      .select(COLS)
      .single();
    if (error) {
      toast(errorMessage(error), 'error');
      return false;
    }
    const row = data as Memo;
    setRows((r) => [row, ...(r ?? []).filter((m) => m.id !== row.id)]);
    setComposing(false);
    return true;
  };

  const save = async (id: string, body: string) => {
    const { data, error } = await supabase.from('memos').update({ body }).eq('id', id).select(COLS).single();
    if (error) {
      toast(errorMessage(error), 'error');
      return false;
    }
    const row = data as Memo;
    setRows((r) => (r ?? []).map((m) => (m.id === id ? row : m)));
    setEditing(null);
    return true;
  };

  const remove = async (m: Memo) => {
    const ok = await confirm({ title: '메모를 삭제할까요?', confirmText: '삭제', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('memos').delete().eq('id', m.id);
    if (error) return toast(errorMessage(error), 'error');
    setRows((r) => (r ?? []).filter((x) => x.id !== m.id));
  };

  const list = rows ?? [];
  const visible = showAll ? list : list.slice(0, PAGE);

  return (
    <section className="panel memo-panel" aria-label="메모">
      <header className="panel-head memo-head">
        <h2>
          메모{list.length > 0 && <span className="memo-total">{list.length}</span>}
        </h2>
        <button
          type="button"
          className="icon-btn memo-add"
          aria-label="새 메모"
          title="새 메모"
          aria-pressed={composing}
          onClick={() => {
            setEditing(null);
            setComposing((v) => !v);
          }}
        >
          <Icon name={composing ? 'close' : 'plus'} size={20} />
        </button>
      </header>

      {composing && <MemoEditor submitText="등록" onSubmit={add} onCancel={() => setComposing(false)} />}

      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : failed ? (
        <p className="empty small">
          메모를 불러오지 못했어요.{' '}
          <button type="button" className="link-btn" onClick={() => void reload()}>
            다시 시도
          </button>
        </p>
      ) : list.length === 0 ? (
        !composing && <p className="empty small">아직 메모가 없어요. + 를 눌러 첫 메모를 남겨 보세요.</p>
      ) : (
        <ul className="memo-list">
          {visible.map((m) => {
            const author = profiles.get(m.author_id) ?? null;
            const mine = m.author_id === myId;
            return (
              <li key={m.id} className="memo-item">
                <Avatar profile={author} size={30} />
                <div className="memo-main">
                  <div className="memo-meta">
                    <b className="memo-name" style={{ color: author?.color ?? GRAY }}>
                      {author?.nickname ?? '(알 수 없음)'}
                    </b>
                    {mine && <span className="cm-me">나</span>}
                    <time className="memo-time" dateTime={m.created_at} title={new Date(m.created_at).toLocaleString('ko-KR')}>
                      {when(m.created_at)}
                      {m.updated_at && ' · 수정됨'}
                    </time>
                  </div>
                  {editing === m.id ? (
                    <MemoEditor initial={m.body} submitText="저장" onSubmit={(b) => save(m.id, b)} onCancel={() => setEditing(null)} />
                  ) : (
                    <p className="memo-body">{m.body}</p>
                  )}
                  {editing !== m.id && (mine || isAdmin) && (
                    <div className="cm-actions">
                      {mine && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            setComposing(false);
                            setEditing(m.id);
                          }}
                        >
                          수정
                        </button>
                      )}
                      <button type="button" className="link-btn danger-text" onClick={() => remove(m)}>
                        삭제
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {list.length > PAGE && (
        <button type="button" className="link-btn memo-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? '접기' : `메모 ${list.length - PAGE}개 더 보기`}
        </button>
      )}
    </section>
  );
}
