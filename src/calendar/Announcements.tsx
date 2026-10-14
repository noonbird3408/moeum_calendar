// 캘린더 공지사항: 모든 멤버가 읽고, 관리자만 작성·수정·삭제 (실시간 반영)
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Announcement, CalendarEvent, Profile } from '@/types';
import { fmtMD, WEEKDAYS, weekday } from '@/lib/dates';
import { htmlToText, linksInHtml, sanitizeHtml, textToHtml } from '@/lib/richHtml';
import { errorMessage, supabase } from '@/lib/supabase';
import { Avatar } from '@/ui/Avatar';
import { Sheet } from '@/ui/Sheet';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';
import { RichTextEditor } from '@/ui/RichTextEditor';
import { LinkPreview } from './LinkPreview';

const MAX_HTML = 20000;

const uniq = () => Math.random().toString(36).slice(2, 8);

export function useAnnouncements(calendarId: string) {
  const [rows, setRows] = useState<Announcement[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, calendar_id, author_id, title, body, body_html, event_id, created_at, updated_at, author:profiles(id, nickname, color, avatar_url)')
        .eq('calendar_id', calendarId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (alive && !error) setRows((data ?? []) as unknown as Announcement[]);
    };
    load();
    const ch = supabase
      .channel(`notice:${calendarId}:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `calendar_id=eq.${calendarId}` }, () => load())
      // 삭제 알림은 PK 만 오므로 한 번 더 불러온다
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'announcements' }, () => load())
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [calendarId]);

  return rows;
}

type GroupLite = Pick<CalendarEvent, 'id' | 'title' | 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'event_dates'>;

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const eventWhen = (e: GroupLite) =>
  e.event_dates && e.event_dates.length > 1
    ? `${fmtMD(e.start_date)} (${WEEKDAYS[weekday(e.start_date)]}) 외 ${e.event_dates.length - 1}일${e.start_time ? ` ${e.start_time.slice(0, 5)}` : ''}`
    : `${fmtMD(e.start_date)} (${WEEKDAYS[weekday(e.start_date)]})${e.end_date !== e.start_date ? ` ~ ${fmtMD(e.end_date)}` : ''}${e.start_time ? ` ${e.start_time.slice(0, 5)}` : ''}`;

/** 이 캘린더의 전체(단체) 일정 목록 (공지 태그용) */
function useGroupEvents(calendarId: string, enabled: boolean) {
  const [rows, setRows] = useState<GroupLite[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    supabase
      .from('events')
      .select('id, title, start_date, end_date, start_time, end_time, event_dates')
      .eq('calendar_id', calendarId)
      .eq('is_group', true)
      .order('start_date', { ascending: false })
      .limit(200)
      .then(({ data }: { data: GroupLite[] | null }) => alive && setRows(data ?? []));
    return () => {
      alive = false;
    };
  }, [calendarId, enabled]);
  return rows;
}

export function AnnouncementsPanel({
  calendarId,
  myId,
  isAdmin,
  profiles,
  onOpenEvent,
}: {
  calendarId: string;
  myId: string;
  isAdmin: boolean;
  profiles: Map<string, Profile>;
  onOpenEvent: (eventId: string) => void;
}) {
  const rows = useAnnouncements(calendarId);
  const { toast, confirm } = useFeedback();
  const [viewId, setViewId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item: Announcement | null } | null>(null);
  const viewing = rows?.find((a) => a.id === viewId) ?? null;

  const remove = async (a: Announcement) => {
    const ok = await confirm({ title: '공지를 삭제할까요?', message: `「${a.title}」`, confirmText: '삭제', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('announcements').delete().eq('id', a.id);
    if (error) return toast(errorMessage(error), 'error');
    toast('공지를 삭제했어요.', 'success');
    setViewId(null);
  };

  return (
    <section className="panel notice-panel" aria-label="공지사항">
      <header className="panel-head">
        <h2>공지사항</h2>
        {isAdmin && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditor({ item: null })}>
            <Icon name="plus" size={14} /> 작성
          </button>
        )}
      </header>
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="empty small">공지가 없어요.</p>
      ) : (
        <ul className="notice-list">
          {rows.map((a) => {
            const author = profiles.get(a.author_id)?.nickname ?? a.author?.nickname ?? '(알 수 없음)';
            return (
              <li key={a.id} className="notice-item">
                <button type="button" className="notice-head" onClick={() => setViewId(a.id)}>
                  <span className="notice-title">
                    {a.event_id && <span className="notice-tag-dot" aria-label="일정 태그" />}
                    {a.title}
                  </span>
                  <span className="notice-meta muted small">
                    {fmtMD(a.created_at.slice(0, 10))} · {author}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {viewing && (
        <NoticeView
          item={viewing}
          author={profiles.get(viewing.author_id) ?? viewing.author ?? null}
          isAdmin={isAdmin}
          onClose={() => setViewId(null)}
          onEdit={() => setEditor({ item: viewing })}
          onDelete={() => remove(viewing)}
          onOpenEvent={(id) => {
            setViewId(null);
            onOpenEvent(id);
          }}
        />
      )}
      {editor && isAdmin && (
        <NoticeEditor
          key={editor.item?.id ?? 'new'}
          calendarId={calendarId}
          myId={myId}
          item={editor.item}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}

/** 공지를 게시글처럼 보기: 제목 · 작성자 · 시각 · 본문 · 링크 미리보기 · 태그한 일정 */
export function NoticeView({
  item,
  author,
  isAdmin,
  onClose,
  onEdit,
  onDelete,
  onOpenEvent,
}: {
  item: Announcement;
  author: Profile | null;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenEvent: (id: string) => void;
}) {
  const [tagged, setTagged] = useState<GroupLite | null>(null);
  useEffect(() => {
    setTagged(null);
    if (!item.event_id) return;
    let alive = true;
    supabase
      .from('events')
      .select('id, title, start_date, end_date, start_time, end_time, event_dates')
      .eq('id', item.event_id)
      .maybeSingle()
      .then(({ data }: { data: GroupLite | null }) => alive && setTagged(data));
    return () => {
      alive = false;
    };
  }, [item.event_id]);

  return (
    <Sheet
      open
      onClose={onClose}
      size="md"
      title={
        <span className="detail-title">
          <span className="badge badge-notice">공지</span>
          {item.title}
        </span>
      }
      actions={
        isAdmin ? (
          <>
            <button type="button" className="mini-act" onClick={onEdit} aria-label="공지 수정">
              <Icon name="edit" size={15} /> 수정
            </button>
            <button type="button" className="mini-act danger-text" onClick={onDelete} aria-label="공지 삭제">
              <Icon name="trash" size={15} /> 삭제
            </button>
          </>
        ) : undefined
      }
    >
      <div className="detail-wrap notice-view">
        <div className="post-author">
          <Avatar profile={author} size={32} />
          <div>
            <b style={{ color: author?.color }}>{author?.nickname ?? '(알 수 없음)'}</b>
            <span className="post-time">
              {fmtWhen(item.created_at)}
              {item.updated_at && item.updated_at.slice(0, 16) !== item.created_at.slice(0, 16) && ' · 수정됨'}
            </span>
          </div>
        </div>
        {tagged && (
          <button type="button" className="tag-card" onClick={() => onOpenEvent(tagged.id)}>
            <Icon name="calendar" size={18} />
            <span className="tag-card-text">
              <b>{tagged.title}</b>
              <span>{eventWhen(tagged)}</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}
        <NoticeBody item={item} />
      </div>
    </Sheet>
  );
}

/** 공지 본문: 서식 HTML(정리 후) + 본문 속 링크 미리보기 */
function NoticeBody({ item }: { item: Announcement }) {
  const html = useMemo(() => (item.body_html ? sanitizeHtml(item.body_html) : item.body ? textToHtml(item.body) : ''), [item.body_html, item.body]);
  const links = useMemo(() => linksInHtml(html), [html]);
  if (!html) return null;
  return (
    <>
      <div className="rich-view notice-text" dangerouslySetInnerHTML={{ __html: html }} />
      {links.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </>
  );
}

function NoticeEditor({ calendarId, myId, item, onClose }: { calendarId: string; myId: string; item: Announcement | null; onClose: () => void }) {
  const { toast } = useFeedback();
  const [title, setTitle] = useState(item?.title ?? '');
  const initial = useMemo(() => (item?.body_html ? sanitizeHtml(item.body_html) : item?.body ? textToHtml(item.body) : ''), [item]);
  const [html, setHtml] = useState(initial);
  const [eventId, setEventId] = useState<string>(item?.event_id ?? '');
  const groups = useGroupEvents(calendarId, true);
  const [busy, setBusy] = useState(false);
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  // 미리보기는 입력이 멈춘 뒤에 갱신 (주소를 치는 도중마다 불러오지 않게)
  const [settled, setSettled] = useState(clean);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(clean), 700);
    return () => window.clearTimeout(t);
  }, [clean]);
  const links = useMemo(() => linksInHtml(settled), [settled]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    const text = htmlToText(clean);
    if (clean.length > MAX_HTML || text.length > 2000) return toast('내용이 너무 길어요.', 'error');
    setBusy(true);
    const payload = { title: title.trim(), body: text, body_html: text ? clean : null, event_id: eventId || null };
    const { error } = item
      ? await supabase.from('announcements').update(payload).eq('id', item.id)
      : await supabase.from('announcements').insert({ ...payload, calendar_id: calendarId, author_id: myId });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    toast(item ? '공지를 고쳤어요.' : '공지를 올렸어요.', 'success');
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={item ? '공지 수정' : '공지 작성'}
      size="lg"
      footer={
        <>
          <button type="submit" form="notice-form" className="btn btn-primary" disabled={!title.trim() || busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
        </>
      }
    >
      <form id="notice-form" className="stack" onSubmit={save}>
        <label className="field">
          <span className="field-label">제목</span>
          <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <div className="field">
          <span className="field-label">내용</span>
          <RichTextEditor initialHtml={initial} onChange={setHtml} placeholder="공지 내용" />
        </div>
        <label className="field">
          <span className="field-label">일정 태그 (선택)</span>
          <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="태그할 전체 일정">
            <option value="">태그 안 함</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {eventWhen(g)} · {g.title}
              </option>
            ))}
          </select>
        </label>
        {links.length > 0 && (
          <div className="field">
            <span className="field-label">링크 미리보기</span>
            {links.map((u) => (
              <LinkPreview key={u} url={u} />
            ))}
          </div>
        )}
      </form>
    </Sheet>
  );
}
