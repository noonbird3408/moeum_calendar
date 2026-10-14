import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CalendarEvent, EventInput, Profile } from '@/types';
import { addDays, diffDays, minToTime, toMin, todayYmd, WEEKDAYS } from '@/lib/dates';
import { checkImageFile, MAX_IMAGES, removeEventImages, signedUrls, uploadEventImage } from '@/lib/eventImages';
import { errorMessage } from '@/lib/supabase';
import { findUrls, normalizeUrl } from '@/lib/links';
import { Sheet } from '@/ui/Sheet';
import { Segmented } from '@/ui/controls';
import { Icon } from '@/ui/Icon';
import { useFeedback } from '@/ui/Feedback';
import { DatePicker, runsText, toRuns } from './DatePicker';
import { findConflicts, loadParticipantIds, syncParticipants, type Conflict } from './groupAssign';

export type FormTarget = { date?: string; event?: CalendarEvent; group?: boolean };

export type CalOption = { id: string; name: string };

type Props = {
  target: FormTarget | null;
  calendars: CalOption[]; // 추가할 캘린더 후보 (한 개면 선택 칸을 숨긴다)
  defaultCalendarId: string;
  adminOf: (calendarId: string) => boolean;
  members?: Profile[]; // 전체 일정 참여 멤버 후보 (캘린더 화면에서만 넘긴다)
  allowGroup?: boolean; // 메인 화면에서는 개인 일정만 추가한다
  onClose: () => void;
  onCreate: (input: EventInput, calendarIds: string[]) => Promise<CalendarEvent[]>;
  onUpdate: (id: string, input: EventInput) => Promise<void>;
};

// 30분 단위 시간 목록
const STARTS = Array.from({ length: 48 }, (_, i) => minToTime(i * 30)); // 00:00 ~ 23:30
const ENDS = Array.from({ length: 48 }, (_, i) => minToTime((i + 1) * 30)); // 00:30 ~ 24:00
const MAX_DAYS = 62; // 한 번에 고를 수 있는 날짜 수
const MAX_REPEAT_SPAN = 400; // 요일 반복 기간 최대(일)
const REPEAT_DEFAULT_DAYS = 364; // 요일만 고르고 기간을 안 정하면 시작일부터 1년

const snap = (t: string | null, fallback: string) => {
  if (!t) return fallback;
  const m = Math.round(toMin(t) / 30) * 30;
  return minToTime(Math.min(m, 1440));
};

/** 수정할 일정의 날짜를 선택 집합으로: 반복 일정은 기간 양 끝, 아니면 기간의 모든 날 */
function initialDates(e: CalendarEvent | undefined, base: string): Set<string> {
  if (!e) return new Set([base]);
  if (e.repeat_weekdays && e.repeat_until) return new Set([e.start_date, e.repeat_until]);
  const out = new Set<string>();
  for (let d = e.start_date, n = diffDays(e.start_date, e.end_date); n >= 0 && out.size < MAX_DAYS; n--, d = addDays(d, 1)) out.add(d);
  return out;
}

type Slot = { start: string; end: string };
type NewImage = { file: File; url: string };

export function EventFormSheet({ target, calendars, defaultCalendarId, adminOf, members, allowGroup = true, onClose, onCreate, onUpdate }: Props) {
  const { toast } = useFeedback();
  const editing = target?.event;
  const baseDate = editing?.start_date ?? target?.date ?? todayYmd();

  const [pickedCals, setPickedCals] = useState<string[]>(() => [editing?.calendar_id ?? defaultCalendarId]);
  const groupOk = (ids: string[]) => ids.length > 0 && ids.every((id) => adminOf(id));
  const [kind, setKind] = useState<'personal' | 'group'>(editing ? (editing.is_group ? 'group' : 'personal') : target?.group && allowGroup ? 'group' : 'personal');

  const [title, setTitle] = useState(editing?.title ?? '');
  const [text, setText] = useState(editing?.memo ?? ''); // 개인: 메모 · 전체: 설명(본문)
  const [dates, setDates] = useState<Set<string>>(() => initialDates(editing, baseDate));
  const [dateOpen, setDateOpen] = useState(false); // '날짜' 버튼을 누르면 요일·달력이 펼쳐진다
  const [weekdays, setWeekdays] = useState<number[]>(editing?.repeat_weekdays ?? []);
  const [allDay, setAllDay] = useState(editing ? !editing.start_time : true);
  const [startTime, setStartTime] = useState(snap(editing?.start_time ?? null, '19:00'));
  const [endTime, setEndTime] = useState(snap(editing?.end_time ?? null, '21:00'));
  // 전체 일정: 참여 멤버 · 정원 · 사진
  const [participants, setParticipants] = useState<string[]>([]);
  const [initialParticipants, setInitialParticipants] = useState<string[]>([]);
  const [maxPeople, setMaxPeople] = useState(editing?.max_participants ? String(editing.max_participants) : '');
  const [keptImages, setKeptImages] = useState<string[]>(editing?.image_paths ?? []);
  const [keptUrls, setKeptUrls] = useState<Record<string, string>>({});
  const [newImages, setNewImages] = useState<NewImage[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const isGroup = kind === 'group';
  const weekly = !isGroup && weekdays.length > 0;
  const groupOkNow = groupOk(pickedCals);
  const single = pickedCals.length === 1 ? pickedCals[0] : null;
  const isAdminHere = !!single && adminOf(single);
  const canAssign = isGroup && isAdminHere && !!members?.length;
  const canImages = isGroup && isAdminHere;
  const url = useMemo(() => (isGroup && text.trim() ? normalizeUrl(findUrls(text)[0] ?? '') : null), [isGroup, text]);
  const nameOf = (id: string) => members?.find((m) => m.id === id)?.nickname ?? '(알 수 없음)';
  const sorted = useMemo(() => [...dates].sort(), [dates]);
  const runs = useMemo(() => toRuns(dates), [dates]);

  // 저장할 일정들의 날짜 구간
  //  · 요일 반복: 고른 날짜의 처음~끝 (하루만 골랐거나 없으면 그날부터 1년) 동안 매주
  //  · 하루종일: 이어진 날짜마다 한 일정 (10/15~10/17 → 하나)
  //  · 시간 일정: 고른 날마다 한 일정 (매일 19:00~21:00)
  //  · 전체 일정: 이어진 날짜 한 구간만
  const slots: Slot[] = useMemo(() => {
    if (weekly) {
      const s = sorted[0] ?? baseDate;
      const last = sorted[sorted.length - 1];
      return [{ start: s, end: last && last !== s ? last : addDays(s, REPEAT_DEFAULT_DAYS) }];
    }
    if (isGroup || allDay) return runs.map(([s, e]) => ({ start: s, end: e }));
    return sorted.map((d) => ({ start: d, end: d }));
  }, [weekly, sorted, baseDate, isGroup, allDay, runs]);

  // 수정 중인 전체 일정이면 지금 지정된 참여 멤버와 사진을 불러온다
  useEffect(() => {
    if (!editing?.is_group) return;
    loadParticipantIds(editing.id)
      .then((ids) => {
        setParticipants(ids);
        setInitialParticipants(ids);
      })
      .catch(() => undefined);
    const paths = editing.image_paths ?? [];
    if (paths.length) signedUrls(paths).then(setKeptUrls).catch(() => undefined);
  }, [editing?.id, editing?.is_group]); // eslint-disable-line react-hooks/exhaustive-deps

  // 새로 고른 사진의 미리보기 URL 은 닫을 때 정리
  useEffect(() => () => newImages.forEach((n) => URL.revokeObjectURL(n.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const errors = useMemo(() => {
    const e: string[] = [];
    if (!title.trim()) e.push('제목을 입력해 주세요.');
    if (!pickedCals.length) e.push('캘린더를 하나 이상 고르세요.');
    if (isGroup && !groupOkNow) e.push('전체 일정은 선택한 캘린더의 관리자만 만들 수 있어요.');
    if (!weekly && !dates.size) e.push('날짜를 골라 주세요.');
    if (isGroup && runs.length > 1) e.push('전체 일정은 이어진 날짜 한 구간만 고를 수 있어요.');
    if (weekly && slots[0] && diffDays(slots[0].start, slots[0].end) > MAX_REPEAT_SPAN) e.push(`반복 기간은 최대 ${MAX_REPEAT_SPAN + 1}일이에요.`);
    if (!weekly && slots.length > MAX_DAYS) e.push(`한 번에 ${MAX_DAYS}개까지 만들 수 있어요.`);
    const sameDay = weekly || !isGroup || slots.every((s) => s.start === s.end);
    if (!allDay && sameDay && toMin(endTime) <= toMin(startTime)) e.push('종료 시간이 시작 시간보다 늦어야 해요.');
    const mp = maxPeople.trim();
    if (isGroup && mp && !(/^\d+$/.test(mp) && +mp >= 1 && +mp <= 1000)) e.push('참여 정원은 1~1000 사이 숫자로 적어 주세요.');
    if (isGroup && mp && participants.length > +mp) e.push('지정한 참여 멤버가 정원보다 많아요.');
    return e;
  }, [title, pickedCals, isGroup, groupOkNow, weekly, dates, runs, slots, allDay, startTime, endTime, maxPeople, participants]);

  const toggleCal = (id: string) =>
    setPickedCals((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      if (!groupOk(next) && kind === 'group') setKind('personal');
      return next;
    });

  const toggleWeekday = (d: number) => setWeekdays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b)));

  const chooseKind = (k: 'personal' | 'group') => {
    setKind(k);
    if (k === 'group') setWeekdays([]);
    if (k === 'personal') setParticipants([]);
  };

  const toggleParticipant = (id: string) => {
    setConflicts([]);
    setParticipants((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_IMAGES - keptImages.length - newImages.length;
    const picked: NewImage[] = [];
    for (const f of Array.from(files)) {
      const bad = checkImageFile(f);
      if (bad) {
        toast(bad, 'error');
        continue;
      }
      if (picked.length >= room) {
        toast(`사진은 ${MAX_IMAGES}장까지 올릴 수 있어요.`, 'error');
        break;
      }
      picked.push({ file: f, url: URL.createObjectURL(f) });
    }
    setNewImages((l) => [...l, ...picked]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTried(true);
    if (errors.length || busy) return;

    const base = {
      title: title.trim(),
      memo: (isGroup ? text.trim() : text.trim().slice(0, 500)) || null,
      is_group: isGroup,
      is_recurring: weekly,
      start_time: allDay ? null : startTime,
      end_time: allDay ? null : endTime,
      repeat_weekdays: weekly ? [...weekdays].sort((a, b) => a - b) : null,
      link_url: url,
      max_participants: isGroup && maxPeople.trim() ? Number(maxPeople) : null,
    };
    const inputs: EventInput[] = slots.map((s) => ({ ...base, start_date: s.start, end_date: s.end, repeat_until: weekly ? s.end : null }));

    setBusy(true);
    const uploaded: string[] = [];
    try {
      // 참여 멤버를 고른 전체 일정은 저장 전에 개인 일정과 겹치는지 확인한다
      if (canAssign && participants.length && single) {
        const found: Conflict[] = [];
        for (const inp of inputs) {
          found.push(...(await findConflicts(single, participants, { start_date: inp.start_date, end_date: inp.end_date, start_time: inp.start_time, end_time: inp.end_time }, nameOf)));
        }
        if (found.length) {
          setConflicts(found);
          return;
        }
      }

      // 사진 먼저 올리고 경로를 일정에 붙인다
      if (canImages && single) {
        for (const n of newImages) uploaded.push(await uploadEventImage(single, n.file));
      }
      const images = canImages ? [...keptImages, ...uploaded] : [];
      const withImages = inputs.map((inp) => (isGroup ? { ...inp, image_paths: images } : { ...inp, image_paths: [] }));

      const saved: string[] = [];
      let rest = withImages;
      if (editing) {
        await onUpdate(editing.id, withImages[0]);
        saved.push(editing.id);
        rest = withImages.slice(1);
        // 빠진 사진 파일은 지운다
        const dropped = (editing.image_paths ?? []).filter((p) => !keptImages.includes(p));
        if (dropped.length) await removeEventImages(dropped).catch(() => undefined);
      }
      for (const inp of rest) {
        const rows = await onCreate(inp, pickedCals);
        if (rows[0]) saved.push(rows[0].id);
      }
      if (canAssign) {
        for (const id of saved) await syncParticipants(id, participants, id === editing?.id ? initialParticipants : []);
      }
      toast(editing ? '일정을 수정했어요.' : saved.length > 1 ? `일정 ${saved.length}개를 추가했어요.` : '일정을 추가했어요.', 'success');
      onClose();
    } catch (err) {
      if (uploaded.length) await removeEventImages(uploaded).catch(() => undefined);
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const dateSummary = weekly
    ? `${slots[0].start.slice(5).replace('-', '/')} ~ ${slots[0].end.slice(5).replace('-', '/')} · 매주 ${weekdays.map((d) => WEEKDAYS[d]).join('·')}`
    : runsText(dates);
  const imageCount = keptImages.length + newImages.length;

  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={editing ? '일정 수정' : '일정 추가'}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => submit()} disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {allowGroup && (
          <div className="field">
            <span className="field-label">종류</span>
            <Segmented
              ariaLabel="일정 종류"
              value={kind}
              onChange={chooseKind}
              options={[
                { value: 'personal', label: '개인 일정' },
                { value: 'group', label: `전체 일정${groupOkNow ? '' : ' (관리자)'}` },
              ]}
            />
          </div>
        )}

        {calendars.length > 1 && !editing && (
          <div className="field">
            <span className="field-label">추가할 캘린더</span>
            <div className="chip-wrap">
              {calendars.map((c) => {
                const on = pickedCals.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`chip-pick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleCal(c.id)}>
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">제목</span>
          <input className="input" value={title} maxLength={40} placeholder="예: 스터디, 알바, 여행" onChange={(e) => setTitle(e.target.value)} autoFocus={!editing} />
        </label>

        <div className="field">
          <span className="field-label">날짜</span>
          <button type="button" className={`date-toggle ${dateOpen ? 'open' : ''}`} aria-expanded={dateOpen} onClick={() => setDateOpen((v) => !v)}>
            <Icon name="calendar" size={18} />
            <span className="date-toggle-text">{dateSummary}</span>
            <span className="date-toggle-caret" aria-hidden="true">
              {dateOpen ? '▲' : '▼'}
            </span>
          </button>
          {dateOpen && (
            <div className="date-panel">
              {!isGroup && (
                <div className="weekday-row" role="group" aria-label="반복 요일">
                  {WEEKDAYS.map((w, i) => {
                    const on = weekdays.includes(i);
                    return (
                      <button key={w} type="button" className={`wd-btn ${on ? 'on' : ''} ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`} aria-pressed={on} onClick={() => toggleWeekday(i)}>
                        {w}
                      </button>
                    );
                  })}
                </div>
              )}
              <DatePicker
                selected={dates}
                maxDays={weekly ? MAX_REPEAT_SPAN : MAX_DAYS}
                highlightWeekdays={weekly ? weekdays : undefined}
                onChange={(next) => {
                  setDates(next);
                  setConflicts([]);
                }}
              />
              <p className="dp-tip">누르면 선택 · 끌면 여러 날 · 누른 채 다른 날짜 우클릭(또는 Shift+클릭)하면 사이 전체</p>
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">시간</span>
          <div className="time-row">
            <select className="input" value={startTime} disabled={allDay} aria-label="시작 시간" onChange={(e) => setStartTime(e.target.value)}>
              {STARTS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <span className="muted">~</span>
            <select className="input" value={endTime} disabled={allDay} aria-label="종료 시간" onChange={(e) => setEndTime(e.target.value)}>
              {ENDS.map((t) => (
                <option key={t} disabled={toMin(t) <= toMin(startTime) && (weekly || !isGroup || runs.every(([s, e]) => s === e))}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" className={`chip-pick allday-chip ${allDay ? 'on' : ''}`} aria-pressed={allDay} onClick={() => setAllDay((v) => !v)}>
              하루종일
            </button>
          </div>
        </div>

        {isGroup ? (
          <>
            <label className="field">
              <span className="field-label">설명 (선택)</span>
              <textarea className="input" rows={6} maxLength={2000} value={text} placeholder="내용 (링크를 넣으면 미리보기가 붙어요)" onChange={(e) => setText(e.target.value)} />
            </label>

            {canImages && (
              <div className="field">
                <span className="field-label">
                  사진 <span className="muted">({imageCount}/{MAX_IMAGES})</span>
                </span>
                <div className="img-picks">
                  {keptImages.map((p) => (
                    <span key={p} className="img-pick">
                      {keptUrls[p] ? <img src={keptUrls[p]} alt="" /> : <span className="img-ph" />}
                      <button type="button" className="img-x" aria-label="사진 빼기" onClick={() => setKeptImages((l) => l.filter((x) => x !== p))}>
                        ×
                      </button>
                    </span>
                  ))}
                  {newImages.map((n) => (
                    <span key={n.url} className="img-pick">
                      <img src={n.url} alt="" />
                      <button
                        type="button"
                        className="img-x"
                        aria-label="사진 빼기"
                        onClick={() => {
                          URL.revokeObjectURL(n.url);
                          setNewImages((l) => l.filter((x) => x !== n));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {imageCount < MAX_IMAGES && (
                    <button type="button" className="img-add" onClick={() => fileRef.current?.click()} aria-label="사진 추가">
                      <Icon name="plus" size={20} />
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              </div>
            )}

            {isAdminHere && (
              <label className="field">
                <span className="field-label">참여 정원 (선택)</span>
                <input
                  className="input input-narrow"
                  inputMode="numeric"
                  value={maxPeople}
                  placeholder="제한 없음"
                  aria-label="참여 정원"
                  onChange={(e) => setMaxPeople(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                />
              </label>
            )}

            {canAssign && (
              <div className="field">
                <span className="field-label">
                  참여 멤버 {maxPeople && <span className="muted">({participants.length}/{maxPeople})</span>}
                </span>
                <div className="chip-wrap" role="group" aria-label="참여 멤버">
                  {members!.map((m) => {
                    const on = participants.includes(m.id);
                    return (
                      <button key={m.id} type="button" className={`chip-pick ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleParticipant(m.id)}>
                        {m.nickname ?? '(알 수 없음)'}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <label className="field">
            <span className="field-label">메모 (선택)</span>
            <textarea className="input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        )}

        {conflicts.length > 0 && (
          <div className="form-errors conflict-box" role="alert">
            <b>개인 일정과 겹치는 멤버가 있어 저장할 수 없어요.</b>
            <ul>
              {conflicts.map((c, i) => (
                <li key={`${c.userId}-${c.date}-${i}`}>
                  {c.title} · {c.date.slice(5).replace('-', '/')} {c.time}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tried && errors.length > 0 && (
          <ul className="form-errors" role="alert">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
