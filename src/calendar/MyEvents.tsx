// 내 일정 (이 캘린더에서 내가 등록한 개인 일정, 오늘 이후) — 패널 요약 + '전체 보기' 시트(추가·수정·삭제·일괄 삭제)
import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '@/types';
import { todayYmd } from '@/lib/dates';
import { errorMessage, supabase } from '@/lib/supabase';
import { Sheet } from '@/ui/Sheet';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';
import { scheduleText } from './eventUtils';

const PREVIEW = 3; // 패널에는 3개까지 보이고, 4개 이상이면 '…' 로 펼친다

/** 내 개인 일정 목록: 정기 일정을 위에, 나머지는 날짜순. 지난 일정과 단체 일정은 빼고 읽는다. */
export function useMyEvents(calendarId: string, userId: string, refreshKey: unknown) {
  const [rows, setRows] = useState<CalendarEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from('events')
      .select('*')
      .eq('calendar_id', calendarId)
      .eq('author_id', userId)
      .eq('is_group', false)
      .gte('end_date', todayYmd())
      .order('start_date')
      .limit(300)
      .then(({ data }) => {
        if (!alive) return;
        const list = (data ?? []) as CalendarEvent[];
        list.sort((a, b) => Number(!!b.repeat_weekdays) - Number(!!a.repeat_weekdays) || a.start_date.localeCompare(b.start_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''));
        setRows(list);
      });
    return () => {
      alive = false;
    };
  }, [calendarId, userId, refreshKey]);

  return rows;
}

/* ------------------------------------------------------------------ */
/* 패널 요약                                                           */
/* ------------------------------------------------------------------ */
export function MyEventsPanel({
  rows,
  onOpen,
  onOpenAll,
}: {
  rows: CalendarEvent[] | null;
  onOpen: (e: CalendarEvent) => void;
  onOpenAll: () => void;
}) {
  const shown = rows && rows.length > PREVIEW ? rows.slice(0, PREVIEW) : rows ?? [];
  const more = rows ? rows.length - shown.length : 0;

  return (
    <section className="panel my-events" aria-label="내 일정">
      <header className="panel-head">
        <h2>내 일정</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onOpenAll}>
          전체 보기
        </button>
      </header>
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="empty small">예정된 일정이 없어요.</p>
      ) : (
        <ul className="my-list">
          {shown.map((e) => (
            <li key={e.id}>
              <button type="button" className={`my-item ${e.repeat_weekdays ? 'is-recurring' : ''}`} onClick={() => onOpen(e)}>
                <span className="my-title">
                  {e.repeat_weekdays && <span className="badge badge-recur">↻ 정기</span>} {e.title}
                </span>
                <span className="my-sub">{scheduleText(e)}</span>
              </button>
            </li>
          ))}
          {more > 0 && (
            <li>
              <button type="button" className="my-more" onClick={onOpenAll} aria-label={`일정 ${more}개 더 보기`}>
                …
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 전체 보기 시트: 추가 · 수정 · 삭제 · 일괄 선택                          */
/* ------------------------------------------------------------------ */
export function MyEventsSheet({
  open,
  rows,
  onClose,
  onOpen,
  onEdit,
  onAdd,
  calendarName,
  canManage = () => true,
}: {
  open: boolean;
  canManage?: (e: CalendarEvent) => boolean; // 수정·삭제 가능 여부 (전체 일정은 관리자만)
  rows: CalendarEvent[] | null;
  calendarName?: (e: CalendarEvent) => string; // 메인 화면처럼 여러 캘린더를 함께 보여줄 때
  onClose: () => void;
  onOpen: (e: CalendarEvent) => void;
  onEdit: (e: CalendarEvent) => void;
  onAdd: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const all = rows ?? [];
  const manageable = all.filter(canManage);
  const allOn = manageable.length > 0 && manageable.every((e) => picked.has(e.id));

  // 목록이 바뀌면 사라진 항목·권한 없는 항목은 선택에서 뺀다
  const liveIds = useMemo(() => new Set(manageable.map((e) => e.id)), [manageable]);
  const selected = [...picked].filter((id) => liveIds.has(id));

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () => setPicked(allOn ? new Set() : new Set(manageable.map((e) => e.id)));

  const removeSelected = async () => {
    if (!selected.length) return;
    const ok = await confirm({
      title: `${selected.length}개 일정을 삭제할까요?`,
      message: '삭제하면 되돌릴 수 없어요. 정기 일정은 반복 전체가 함께 지워져요. 전체 일정은 캘린더의 모든 멤버에게서 사라져요.',
      confirmText: '삭제',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from('events').delete().in('id', selected).select('id');
      if (error) throw error;
      toast(`${data?.length ?? 0}개 일정을 삭제했어요.`, 'success');
      setPicked(new Set());
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const groups = all.filter((e) => e.is_group);
  const recurring = all.filter((e) => !e.is_group && e.repeat_weekdays);
  const plain = all.filter((e) => !e.is_group && !e.repeat_weekdays);

  const row = (e: CalendarEvent) => {
    const ok = canManage(e);
    return (
    <li key={e.id} className={`mine-row ${picked.has(e.id) ? 'on' : ''} ${ok ? '' : 'locked'}`}>
      <input
        type="checkbox"
        className="mine-check"
        checked={ok && picked.has(e.id)}
        disabled={!ok}
        onChange={() => toggle(e.id)}
        aria-label={ok ? `${e.title} 선택` : `${e.title} (관리자만 삭제 가능)`}
        title={ok ? undefined : '관리자만 삭제할 수 있어요'}
      />
      <button type="button" className="mine-main" onClick={() => onOpen(e)}>
        <span className="my-title">
          {e.is_group && <span className="badge badge-group">전체</span>}
          {e.repeat_weekdays && <span className="badge badge-recur">↻ 정기</span>} {e.title}
        </span>
        <span className="my-sub">
          {calendarName && <span className="mine-cal">{calendarName(e)} · </span>}
          {scheduleText(e)}
        </span>
      </button>
      {ok && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onEdit(e)} aria-label={`${e.title} 수정`}>
          <Icon name="edit" size={16} /> 수정
        </button>
      )}
    </li>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="내 일정 전체"
      footer={
        <>
          <button type="button" className="btn btn-ghost danger-text" onClick={removeSelected} disabled={!selected.length || busy}>
            <Icon name="trash" size={18} /> 선택 삭제{selected.length ? ` (${selected.length})` : ''}
          </button>
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <Icon name="plus" size={18} /> 일정 추가
          </button>
        </>
      }
    >
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : all.length === 0 ? (
        <p className="empty">예정된 일정이 없어요.</p>
      ) : (
        <>
          <div className="mine-toolbar">
            <label className="mine-all">
              <input type="checkbox" checked={allOn} onChange={toggleAll} /> 전체 선택
            </label>
            <span className="muted small">{selected.length ? `${selected.length}개 선택` : `${all.length}개`}</span>
          </div>
          {groups.length > 0 && (
            <section className="day-section">
              <h3>전체 일정</h3>
              <ul className="mine-list">{groups.map(row)}</ul>
            </section>
          )}
          {recurring.length > 0 && (
            <section className="day-section">
              <h3>정기 일정</h3>
              <ul className="mine-list">{recurring.map(row)}</ul>
            </section>
          )}
          {plain.length > 0 && (
            <section className="day-section">
              <h3>예정 일정</h3>
              <ul className="mine-list">{plain.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}
