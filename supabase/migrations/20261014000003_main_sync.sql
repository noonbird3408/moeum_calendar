-- =====================================================================
-- 012. 메인 화면에서 쓴 개인 일정 동기화
--   · 메인에서 추가한 개인 일정은 내 캘린더 전체에 같은 sync_id 로 복사된다
--   · 새 캘린더를 만들거나 참여하면, 그 사람의 (아직 안 끝난) 동기화 일정이 새 캘린더에도 복사된다
--   · 한 곳에서 고치거나 지우면 (본인이 한 경우) 다른 캘린더의 같은 일정도 함께 바뀐다
--   · 캘린더에서 나가거나 추방될 때 지워지는 일정은 다른 캘린더로 번지지 않는다
-- 여러 번 실행해도 안전합니다(멱등).
-- =====================================================================

alter table public.events add column if not exists sync_id uuid;
create index if not exists events_sync_idx on public.events (sync_id) where sync_id is not null;

-- 이미 메인에서 여러 캘린더에 한 번에 넣었던 일정(같은 사람·같은 시각에 함께 만들어진 같은 일정)에 sync_id 를 붙인다
with g as (
  select author_id, created_at, title, start_date, start_time, gen_random_uuid() as sid
  from public.events
  where not is_group and sync_id is null
  group by author_id, created_at, title, start_date, start_time
  having count(*) > 1 and count(distinct calendar_id) = count(*)
)
update public.events e
set sync_id = g.sid
from g
where e.sync_id is null and not e.is_group
  and e.author_id = g.author_id and e.created_at = g.created_at and e.title = g.title
  and e.start_date = g.start_date and e.start_time is not distinct from g.start_time;

-- 1) 캘린더에 들어오면 (만들기·참여 모두) 내 동기화 일정을 복사
create or replace function public.sync_events_on_join() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into events (calendar_id, author_id, title, memo, is_group, is_recurring, start_date, end_date,
                        start_time, end_time, repeat_weekdays, repeat_until, excluded_dates, link_url, sync_id)
    select new.calendar_id, s.author_id, s.title, s.memo, false, s.is_recurring, s.start_date, s.end_date,
           s.start_time, s.end_time, s.repeat_weekdays, s.repeat_until, s.excluded_dates, s.link_url, s.sync_id
    from (
      select distinct on (sync_id) *
      from events
      where author_id = new.user_id and sync_id is not null and not is_group
        and end_date >= current_date and calendar_id <> new.calendar_id
      order by sync_id, updated_at desc
    ) s
    where not exists (select 1 from events x where x.calendar_id = new.calendar_id and x.sync_id = s.sync_id)
    limit 150;
  exception when others then
    -- 복사가 실패해도 참여 자체는 막지 않는다
    raise warning 'sync_events_on_join: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_sync_events_on_join on public.calendar_members;
create trigger trg_sync_events_on_join after insert on public.calendar_members
  for each row execute function public.sync_events_on_join();

-- 2) 수정 전파: 본인이 직접 고친 경우만
create or replace function public.sync_events_on_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.sync_id is null or new.is_group or auth.uid() is distinct from new.author_id then
    return new;
  end if;
  update events set
    title = new.title, memo = new.memo, is_recurring = new.is_recurring,
    start_date = new.start_date, end_date = new.end_date, start_time = new.start_time, end_time = new.end_time,
    repeat_weekdays = new.repeat_weekdays, repeat_until = new.repeat_until, excluded_dates = new.excluded_dates,
    link_url = new.link_url
  where sync_id = new.sync_id and author_id = new.author_id and id <> new.id;
  return new;
end $$;

drop trigger if exists trg_sync_events_on_update on public.events;
create trigger trg_sync_events_on_update after update on public.events
  for each row execute function public.sync_events_on_update();

-- 3) 삭제 전파: 본인이 직접 지운 경우만 (나가기·추방으로 연쇄 삭제될 때는 번지지 않음)
create or replace function public.sync_events_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or old.sync_id is null or auth.uid() is distinct from old.author_id
     or not exists (select 1 from calendar_members m where m.calendar_id = old.calendar_id and m.user_id = old.author_id) then
    return old;
  end if;
  delete from events where sync_id = old.sync_id and author_id = old.author_id and id <> old.id;
  return old;
end $$;

drop trigger if exists trg_sync_events_on_delete on public.events;
create trigger trg_sync_events_on_delete after delete on public.events
  for each row execute function public.sync_events_on_delete();

revoke execute on function public.sync_events_on_join(), public.sync_events_on_update(), public.sync_events_on_delete() from public, anon, authenticated;
