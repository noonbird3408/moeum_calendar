// 전체 일정 댓글: 작성 · 수정(본인) · 삭제(본인·관리자) · 답글(한 단계)
import { useState, type FormEvent } from 'react';
import type { Comment } from '@/types';
import { GRAY } from '@/lib/colors';
import { fmtMD } from '@/lib/dates';
import { errorMessage } from '@/lib/supabase';
import { Avatar } from '@/ui/Avatar';
import { useFeedback } from '@/ui/Feedback';

type Props = {
  comments: Comment[];
  myId: string;
  isAdmin: boolean;
  onAdd: (body: string, parentId: string | null) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

const MAX = 500;
const when = (iso: string) => `${fmtMD(iso.slice(0, 10))} ${iso.slice(11, 16)}`;

function Composer({ placeholder, initial = '', submitText, onSubmit, onCancel, autoFocus }: {
  placeholder: string;
  initial?: string;
  submitText: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useFeedback();
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setText('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="cm-form" onSubmit={send}>
      <textarea
        className="input"
        rows={1}
        value={text}
        maxLength={MAX}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e as unknown as FormEvent);
          if (e.key === 'Escape' && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <button className="btn btn-primary btn-small" disabled={!text.trim() || busy}>
        {submitText}
      </button>
      {onCancel && (
        <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
          취소
        </button>
      )}
    </form>
  );
}

export function Comments({ comments, myId, isAdmin, onAdd, onEdit, onRemove }: Props) {
  const { confirm, toast } = useFeedback();
  const [editing, setEditing] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const remove = async (c: Comment) => {
    const hasReplies = !c.parent_id && repliesOf(c.id).length > 0;
    const ok = await confirm({
      title: '댓글을 삭제할까요?',
      message: hasReplies ? '달린 답글도 함께 지워져요.' : undefined,
      confirmText: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      await onRemove(c.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const item = (c: Comment, reply = false) => {
    const mine = c.author_id === myId;
    return (
      <li key={c.id} className={`cm ${reply ? 'cm-reply' : ''}`}>
        <Avatar profile={c.author} size={reply ? 26 : 32} />
        <div className="cm-main">
          <div className="cm-meta">
            <b className="cm-name" style={{ color: c.author?.color ?? GRAY }}>
              {c.author?.nickname ?? '(알 수 없음)'}
            </b>
            {mine && <span className="cm-me">나</span>}
            <span className="cm-time">
              {when(c.created_at)}
              {c.updated_at && ' · 수정됨'}
            </span>
          </div>
          {editing === c.id ? (
            <Composer
              placeholder="댓글 수정"
              initial={c.body}
              submitText="저장"
              autoFocus
              onSubmit={async (b) => {
                await onEdit(c.id, b);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <p className="cm-body">{c.body}</p>
          )}
          {editing !== c.id && (
            <div className="cm-actions">
              {!reply && (
                <button type="button" className="link-btn" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>
                  답글
                </button>
              )}
              {mine && (
                <button type="button" className="link-btn" onClick={() => setEditing(c.id)}>
                  수정
                </button>
              )}
              {(mine || isAdmin) && (
                <button type="button" className="link-btn danger-text" onClick={() => remove(c)}>
                  삭제
                </button>
              )}
            </div>
          )}
          {!reply && (repliesOf(c.id).length > 0 || replyTo === c.id) && (
            <ul className="cm-replies">
              {repliesOf(c.id).map((r) => item(r, true))}
              {replyTo === c.id && (
                <li className="cm-reply-form">
                  <Composer
                    placeholder={`${c.author?.nickname ?? ''}님에게 답글`}
                    submitText="등록"
                    autoFocus
                    onSubmit={async (b) => {
                      await onAdd(b, c.id);
                      setReplyTo(null);
                    }}
                    onCancel={() => setReplyTo(null)}
                  />
                </li>
              )}
            </ul>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="group-section" aria-label="댓글">
      <h3>댓글 {comments.length}</h3>
      {roots.length > 0 && <ul className="cm-list">{roots.map((c) => item(c))}</ul>}
      <Composer placeholder="댓글을 남겨 보세요" submitText="등록" onSubmit={(b) => onAdd(b, null)} />
    </section>
  );
}
