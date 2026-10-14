// 달력 아래 메모 두 칸: 왼쪽 공용 메모(모든 멤버가 읽고 고침, 실시간 반영) · 오른쪽 개인 메모(나만 보임)
// 입력을 멈추고 0.8초 뒤 자동 저장한다.
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@/types';
import { errorMessage, supabase } from '@/lib/supabase';
import { useFeedback } from '@/ui/Feedback';

const MAX = 5000;
const DELAY = 800;
const uniq = () => Math.random().toString(36).slice(2, 8);
const hm = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Status = { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; by?: string | null };

function MemoBox({
  title,
  hint,
  text,
  status,
  remoteChanged,
  onChange,
  onReload,
}: {
  title: string;
  hint: string;
  text: string | null;
  status: Status;
  remoteChanged?: boolean;
  onChange: (v: string) => void;
  onReload?: () => void;
}) {
  return (
    <section className="panel memo" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        <span className="memo-status">
          {status.state === 'saving' ? '저장 중…' : status.state === 'error' ? '저장 실패' : status.at ? `${hm(status.at)}${status.by ? ` · ${status.by}` : ''}` : hint}
        </span>
      </header>
      {remoteChanged && (
        <button type="button" className="memo-remote" onClick={onReload}>
          다른 멤버가 메모를 고쳤어요 · 불러오기
        </button>
      )}
      <textarea
        className="input memo-text"
        value={text ?? ''}
        disabled={text === null}
        maxLength={MAX}
        placeholder={text === null ? '불러오는 중…' : '메모를 적어 보세요'}
        aria-label={title}
        onChange={(e) => onChange(e.target.value)}
      />
    </section>
  );
}

/** 저장 예약: 마지막 입력 뒤 DELAY 만큼 기다렸다가 save 를 부른다 */
function useAutosave(save: (v: string) => Promise<void>) {
  const timer = useRef<number | null>(null);
  const latest = useRef<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (latest.current !== null) {
      const v = latest.current;
      latest.current = null;
      void saveRef.current(v);
    }
  };
  useEffect(() => () => flush(), []); // 화면을 떠날 때 남은 내용 저장
  return {
    schedule(v: string) {
      latest.current = v;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, DELAY);
    },
    pending: () => latest.current !== null,
  };
}

export function Memos({ calendarId, myId, profiles }: { calendarId: string; myId: string; profiles: Map<string, Profile> }) {
  const { toast } = useFeedback();
  const [shared, setShared] = useState<string | null>(null);
  const [sharedStatus, setSharedStatus] = useState<Status>({ state: 'idle' });
  const [remote, setRemote] = useState<{ body: string; at: string; by: string | null } | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [mineStatus, setMineStatus] = useState<Status>({ state: 'idle' });
  const editingShared = useRef(false);

  const nameOf = (id: string | null) => (id ? (profiles.get(id)?.nickname ?? null) : null);

  // 처음 불러오기 + 공용 메모 실시간 반영
  useEffect(() => {
    let alive = true;
    setShared(null);
    setMine(null);
    (async () => {
      const [s, m] = await Promise.all([
        supabase.from('calendar_notes').select('body, updated_by, updated_at').eq('calendar_id', calendarId).maybeSingle(),
        supabase.from('personal_notes').select('body, updated_at').eq('calendar_id', calendarId).eq('user_id', myId).maybeSingle(),
      ]);
      if (!alive) return;
      const sd = s.data as { body: string; updated_by: string | null; updated_at: string } | null;
      setShared(sd?.body ?? '');
      setSharedStatus(sd ? { state: 'saved', at: sd.updated_at, by: sd.updated_by } : { state: 'idle' });
      const md = m.data as { body: string; updated_at: string } | null;
      setMine(md?.body ?? '');
      setMineStatus(md ? { state: 'saved', at: md.updated_at } : { state: 'idle' });
    })();

    const ch = supabase
      .channel(`notes:${calendarId}:${uniq()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_notes', filter: `calendar_id=eq.${calendarId}` }, (p) => {
        const row = p.new as { body?: string; updated_by?: string | null; updated_at?: string } | null;
        if (!row || row.body === undefined || row.updated_by === myId) return;
        const next = { body: row.body, at: row.updated_at ?? new Date().toISOString(), by: row.updated_by ?? null };
        // 내가 고치는 중이 아니면 바로 바꾸고, 고치는 중이면 '불러오기' 버튼을 띄운다
        if (editingShared.current) setRemote(next);
        else {
          setShared(next.body);
          setSharedStatus({ state: 'saved', at: next.at, by: next.by });
        }
      })
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [calendarId, myId]);

  const sharedSave = useAutosave(async (body) => {
    setSharedStatus({ state: 'saving' });
    const { data, error } = await supabase
      .from('calendar_notes')
      .upsert({ calendar_id: calendarId, body, updated_by: myId }, { onConflict: 'calendar_id' })
      .select('updated_at')
      .single();
    editingShared.current = false;
    if (error) {
      setSharedStatus({ state: 'error' });
      toast(errorMessage(error), 'error');
      return;
    }
    setSharedStatus({ state: 'saved', at: (data as { updated_at: string }).updated_at, by: myId });
  });

  const mineSave = useAutosave(async (body) => {
    setMineStatus({ state: 'saving' });
    const { data, error } = await supabase
      .from('personal_notes')
      .upsert({ calendar_id: calendarId, user_id: myId, body }, { onConflict: 'calendar_id,user_id' })
      .select('updated_at')
      .single();
    if (error) {
      setMineStatus({ state: 'error' });
      toast(errorMessage(error), 'error');
      return;
    }
    setMineStatus({ state: 'saved', at: (data as { updated_at: string }).updated_at });
  });

  return (
    <div className="memos">
      <MemoBox
        title="공용 메모"
        hint="모든 멤버가 함께 고쳐요"
        text={shared}
        status={{ ...sharedStatus, by: nameOf(sharedStatus.by ?? null) }}
        remoteChanged={!!remote}
        onReload={() => {
          if (!remote) return;
          setShared(remote.body);
          setSharedStatus({ state: 'saved', at: remote.at, by: remote.by });
          setRemote(null);
          editingShared.current = false;
        }}
        onChange={(v) => {
          editingShared.current = true;
          setShared(v);
          sharedSave.schedule(v);
        }}
      />
      <MemoBox
        title="개인 메모"
        hint="나만 볼 수 있어요"
        text={mine}
        status={mineStatus}
        onChange={(v) => {
          setMine(v);
          mineSave.schedule(v);
        }}
      />
    </div>
  );
}
