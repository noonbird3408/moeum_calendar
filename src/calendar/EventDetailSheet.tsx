import { useEffect, useState } from 'react';
import type { CalendarEvent, Profile } from '@/types';
import { errorMessage } from '@/lib/supabase';
import { textOn } from '@/lib/colors';
import { signedUrls } from '@/lib/eventImages';
import { fmtMD, WEEKDAYS, weekday } from '@/lib/dates';
import { findUrls, normalizeUrl } from '@/lib/links';
import { Sheet } from '@/ui/Sheet';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';
import { Comments } from './Comments';
import { LinkPreview } from './LinkPreview';
import { scheduleText } from './eventUtils';
import { useGroupExtras } from './useGroupExtras';

type Props = {
  event: CalendarEvent | null;
  profiles: Map<string, Profile>;
  groupColor: string;
  myId: string;
  canEdit: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: (e: CalendarEvent) => void;
  onDelete: (id: string) => Promise<void>;
};

/** 본문 텍스트: http(s) 주소는 누를 수 있는 링크로 바꾼다 (HTML 로 넣지 않으므로 안전) */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function EventDetailSheet({ event, profiles, groupColor, myId, canEdit, isAdmin, onClose, onEdit, onDelete }: Props) {
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);
  const extras = useGroupExtras(event?.is_group ? event.id : null, myId);
  const author = event ? profiles.get(event.author_id) : undefined;
  const isGroup = !!event?.is_group;
  // 설명에 적힌 첫 번째 외부 링크는 본문 아래에 미리보기로 보여 준다
  const previewUrl = isGroup && event?.memo ? normalizeUrl(findUrls(event.memo)[0] ?? '') : null;
  const images = isGroup ? (event?.image_paths ?? []) : [];
  const imagesKey = images.join('|');
  const max = isGroup ? (event?.max_participants ?? null) : null;
  const full = max !== null && extras.participants.length >= max;

  // 비공개 사진은 서명 URL 로 받아서 보여 준다
  useEffect(() => {
    if (!imagesKey) {
      setUrls({});
      return;
    }
    let alive = true;
    signedUrls(imagesKey.split('|')).then((u) => alive && setUrls(u));
    return () => {
      alive = false;
    };
  }, [imagesKey]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const del = async () => {
    if (!event) return;
    const ok = await confirm({ title: '일정을 삭제할까요?', message: `「${event.title}」을(를) 삭제하면 되돌릴 수 없어요.`, confirmText: '삭제', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await onDelete(event.id);
      toast('일정을 삭제했어요.', 'success');
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const occDate = event?.occ;

  return (
    <Sheet
      open={event !== null}
      onClose={onClose}
      size={isGroup ? 'md' : 'sm'}
      title={
        <span className="detail-title">
          {event?.is_group && (
            <span className="badge badge-group" style={{ background: groupColor, color: textOn(groupColor) }}>
              전체
            </span>
          )}
          {event?.repeat_weekdays && <span className="badge badge-recur">↻ 정기</span>}
          {event?.title}
        </span>
      }
      actions={
        canEdit && event ? (
          <>
            <button type="button" className="mini-act" onClick={() => onEdit(event)} aria-label="수정">
              <Icon name="edit" size={15} /> 수정
            </button>
            <button type="button" className="mini-act danger-text" onClick={del} disabled={busy} aria-label="삭제">
              <Icon name="trash" size={15} /> 삭제
            </button>
          </>
        ) : undefined
      }
    >
      {event && (
        <div className="detail-wrap">
          <dl className="detail">
            <dt>작성자</dt>
            <dd>
              <Avatar profile={author} size={22} />
              {author?.nickname ?? '(알 수 없음)'}
            </dd>
            <dt>일시</dt>
            <dd>
              {scheduleText(event)}
              {occDate && event.repeat_weekdays && (
                <span className="muted small"> · 이 회차 {fmtMD(occDate)} ({WEEKDAYS[weekday(occDate)]})</span>
              )}
            </dd>
            {!isGroup && event.memo && (
              <>
                <dt>메모</dt>
                <dd className="pre">{event.memo}</dd>
              </>
            )}
          </dl>

          {isGroup && event.memo && (
            <div className="post-body" aria-label="본문">
              <Linkified text={event.memo} />
            </div>
          )}
          {isGroup && previewUrl && <LinkPreview url={previewUrl} />}
          {images.length > 0 && (
            <div className={`post-images n${images.length}`}>
              {images.map((p) =>
                urls[p] ? (
                  <button key={p} type="button" className="post-img" onClick={() => setZoom(urls[p])} aria-label="사진 크게 보기">
                    <img src={urls[p]} alt="" loading="lazy" />
                  </button>
                ) : (
                  <span key={p} className="post-img is-loading" />
                ),
              )}
            </div>
          )}

          {isGroup && (
            <section className="group-section" aria-label="참여 멤버">
              <header className="group-head">
                <h3>
                  참여 {extras.participants.length}
                  {max !== null ? ` / ${max}명` : '명'}
                  {full && <span className="badge badge-full">마감</span>}
                </h3>
                <button
                  type="button"
                  className={`btn btn-small ${extras.joined ? 'btn-ghost' : 'btn-primary'}`}
                  disabled={!extras.joined && full && !isAdmin}
                  onClick={() => run(extras.toggleJoin, extras.joined ? '참여를 취소했어요.' : '참여해요!')}
                >
                  {extras.joined ? '참여 취소' : full && !isAdmin ? '정원 마감' : '참여하기'}
                </button>
              </header>
              {extras.participants.length === 0 ? (
                <p className="muted small">아직 참여한 멤버가 없어요.</p>
              ) : (
                <ul className="participants">
                  {extras.participants.map((p) => (
                    <li key={p.user_id} className="participant">
                      <Avatar profile={p.profile} size={26} />
                      <span>{p.profile?.nickname ?? '(알 수 없음)'}</span>
                      {p.user_id === myId && <span className="muted small">(나)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {isGroup && (
            <Comments
              comments={extras.comments}
              myId={myId}
              isAdmin={isAdmin}
              onAdd={extras.addComment}
              onEdit={extras.editComment}
              onRemove={extras.removeComment}
            />
          )}
        </div>
      )}
      {zoom && (
        <div className="img-zoom" role="dialog" aria-label="사진" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </Sheet>
  );
}
