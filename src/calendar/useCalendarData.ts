// 캘린더 정보·멤버·월별 일정 로딩 + Supabase Realtime 동기화
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { removeCalendarImages, removeEventImages } from '@/lib/eventImages';
import type { Calendar, CalendarEvent, EventInput, Member, Profile, Role } from '@/types';

const uniq = () => Math.random().toString(36).slice(2, 8);

const MEMBER_SELECT = 'calendar_id, user_id, role, joined_at, profile:profiles(id, nickname, color, avatar_url)';
const CALENDAR_SELECT = 'id, name, invite_code, group_color, owner_id, created_at';

type MetaStatus = 'loading' | 'ready' | 'missing' | 'error';

/** 캘린더 + 멤버 (+ 내가 내보내졌는지 감지) */
export function useCalendarMeta(calendarId: string, myId: string, onRemoved: () => void) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [status, setStatus] = useState<MetaStatus>('loading');
  const removedRef = useRef(onRemoved);
  removedRef.current = onRemoved;

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from('calendar_members')
      .select(MEMBER_SELECT)
      .eq('calendar_id', calendarId)
      .order('joined_at');
    if (!error) setMembers((data ?? []) as unknown as Member[]);
  }, [calendarId]);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([
      supabase.from('calendars').select(CALENDAR_SELECT).eq('id', calendarId).maybeSingle(),
      supabase.from('calendar_members').select(MEMBER_SELECT).eq('calendar_id', calendarId).order('joined_at'),
    ]);
    if (c.error || m.error) {
      setStatus((s) => (s === 'ready' ? s : 'error'));
      return;
    }
    if (!c.data) {
      setStatus('missing'); // 존재하지 않거나 멤버가 아님 (RLS)
      return;
    }
    setCalendar(c.data as Calendar);
    setMembers((m.data ?? []) as unknown as Member[]);
    setStatus('ready');
  }, [calendarId]);

  useEffect(() => {
    setStatus('loading');
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`meta:${calendarId}:${uniq()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calendars', filter: `id=eq.${calendarId}` },
        (p) => setCalendar((c) => (c ? { ...c, ...(p.new as Partial<Calendar>) } : c)),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_members' }, (p) => {
        const row = (p.eventType === 'DELETE' ? p.old : p.new) as Partial<Member>;
        if (row.calendar_id !== calendarId) return;
        if (p.eventType === 'DELETE' && row.user_id === myId) {
          removedRef.current();
          return;
        }
        loadMembers();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (p) => {
        const row = p.new as Profile;
        setMembers((ms) => ms.map((m) => (m.user_id === row.id ? { ...m, profile: { ...(m.profile ?? row), ...row } } : m)));
      })
      .subscribe();

    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [calendarId, myId, load, loadMembers]);

  const isAdmin = members.some((m) => m.user_id === myId && m.role === 'admin');
  const profiles = useMemo(
    () => new Map(members.filter((m) => m.profile).map((m) => [m.user_id, m.profile as Profile])),
    [members],
  );

  // ---- 관리 기능 (권한은 DB 가 최종 확인) ----
  const actions = useMemo(
    () => ({
      async setRole(userId: string, role: Role) {
        const { data, error } = await supabase
          .from('calendar_members')
          .update({ role })
          .eq('calendar_id', calendarId)
          .eq('user_id', userId)
          .select('user_id');
        if (error) throw error;
        if (!data?.length) throw new Error('NO_ROWS');
        setMembers((ms) => ms.map((m) => (m.user_id === userId ? { ...m, role } : m)));
      },
      async removeMember(userId: string) {
        const { data, error } = await supabase
          .from('calendar_members')
          .delete()
          .eq('calendar_id', calendarId)
          .eq('user_id', userId)
          .select('user_id');
        if (error) throw error;
        if (!data?.length) throw new Error('NO_ROWS');
        setMembers((ms) => ms.filter((m) => m.user_id !== userId));
      },
      async updateCalendar(patch: { name?: string; group_color?: string }) {
        const { data, error } = await supabase
          .from('calendars')
          .update(patch)
          .eq('id', calendarId)
          .select(CALENDAR_SELECT)
          .single();
        if (error) throw error;
        setCalendar(data as Calendar);
      },
      async regenerateCode() {
        const { data, error } = await supabase.rpc('regenerate_invite_code', { p_calendar: calendarId });
        if (error) throw error;
        setCalendar((c) => (c ? { ...c, invite_code: data as string } : c));
        return data as string;
      },
      async deleteCalendar() {
        // 비공개 사진 파일은 DB 와 따로 지워야 한다 (실패해도 캘린더 삭제는 계속)
        await removeCalendarImages(calendarId).catch(() => undefined);
        const { data, error } = await supabase.from('calendars').delete().eq('id', calendarId).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('NO_ROWS');
      },
      async countEventsBy(userId: string) {
        const { count } = await supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('calendar_id', calendarId)
          .eq('author_id', userId);
        return count ?? 0;
      },
    }),
    [calendarId],
  );

  return { calendar, members, status, isAdmin, profiles, reload: load, ...actions };
}

/** 여러 캘린더에 같은 일정을 한 번에 추가한다 (캘린더마다 한 행씩, RLS 가 권한을 최종 확인) */
export async function createEventsIn(calendarIds: string[], input: EventInput, myId: string): Promise<CalendarEvent[]> {
  const rows = calendarIds.map((calendar_id) => ({ ...input, calendar_id, author_id: myId }));
  const { data, error } = await supabase.from('events').insert(rows).select();
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

/** 화면에 보이는 기간(from~to)과 겹치는 일정 + 실시간 반영 + CRUD */
export function useEvents(calendarId: string, myId: string, from: string, to: string) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('calendar_id', calendarId)
      .lte('start_date', to)
      .gte('end_date', from); // 기간이 겹치는 모든 일정
    if (id !== reqId.current) return; // 더 최신 요청이 있으면 버림
    if (!error) setEvents((data ?? []) as CalendarEvent[]);
    setLoading(false);
  }, [calendarId, from, to]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const upsert = useCallback((row: CalendarEvent) => {
    setEvents((list) => [...list.filter((e) => e.id !== row.id), row]);
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`events:${calendarId}:${uniq()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `calendar_id=eq.${calendarId}` },
        (p) => upsert(p.new as CalendarEvent),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'events', filter: `calendar_id=eq.${calendarId}` },
        (p) => upsert(p.new as CalendarEvent),
      )
      // DELETE 는 Supabase 제약상 필터·RLS 가 적용되지 않고 PK(id)만 온다 → 내 목록에 있는 id 만 제거
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'events' }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) setEvents((list) => list.filter((e) => e.id !== id));
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') loadRef.current(); // (재)연결 시 놓친 변경 따라잡기
      });

    const onVisible = () => document.visibilityState === 'visible' && loadRef.current();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [calendarId, upsert]);

  const create = useCallback(
    async (input: EventInput, calendarIds: string[] = [calendarId]) => {
      const rows = await createEventsIn(calendarIds, input, myId);
      rows.filter((r) => r.calendar_id === calendarId).forEach(upsert);
      return rows;
    },
    [calendarId, myId, upsert],
  );

  const update = useCallback(
    async (id: string, input: EventInput) => {
      const { data, error } = await supabase.from('events').update(input).eq('id', id).select().single();
      if (error) throw error;
      upsert(data as CalendarEvent);
    },
    [upsert],
  );

  const remove = useCallback(async (id: string) => {
    const { data, error } = await supabase.from('events').delete().eq('id', id).select('id, image_paths');
    if (error) throw error;
    if (!data?.length) throw new Error('NO_ROWS');
    const paths = ((data[0] as { image_paths?: string[] }).image_paths ?? []) as string[];
    if (paths.length) await removeEventImages(paths).catch(() => undefined);
    setEvents((list) => list.filter((e) => e.id !== id));
  }, []);

  return { events, loading, create, update, remove, reload: load };
}
